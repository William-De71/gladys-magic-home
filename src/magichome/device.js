// -----------------------------------------------------------------------------
// One Magic Home device: protocol detection, state, commands.
//
// The protocol is not announced: a state query in the checksum format is sent
// first (the original format first for the legacy MAC prefix), and the answer
// gives the model number and the firmware version, hence the protocol
// (models.js). Every state, answered or pushed, goes through `applyState`,
// which emits `state` with the interpreted view (light.js).
//
// The devices fade to a new level: a state read during the fade shows a
// value in between, so after a levels command the channels of the incoming
// states are ignored for a moment (power and pattern are still taken).
// Commands are serialized per device.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { levelsToScaledWhite } from './color.js';
import { DIMMABLE_ONLY_EFFECTS, EFFECTS, PATTERN_CUSTOM } from './constants.js';
import { ConnectionError, MagicHomeClient } from './client.js';
import { describe, plan, slots } from './light.js';
import { capabilitiesOf, modelOf, PROTOCOLS as P, protocolFor, traitsOf } from './models.js';
import {
  customFrame,
  delayToSpeed,
  levelsFrames,
  parsePower,
  parseState,
  powerFrame,
  presetFrame,
  speedToDelay,
  stateQuery,
} from './protocol.js';

export class UnsupportedError extends Error {
  constructor(what) {
    super(`not supported by this device: ${what}`);
    this.what = what;
  }
}

export const TIMING = {
  connect: 5000, // TCP connection
  probe: 3000, // answer to the first state query
  state: 4000, // answer to a state query
  power: 1500, // answer to a power command, before asking the state
  spacing: 150, // between two frames written to a device
  fade: 2000, // channels of the states ignored after a levels command
};
const POWER_ATTEMPTS = 3;

const stateOrPower = (frame) => {
  const state = parseState(frame);
  if (state) {
    return { state };
  }
  const power = parsePower(frame);
  return power === null ? null : { power };
};

export class MagicHomeDevice extends EventEmitter {
  /**
   * @param {object} options - Options.
   * @param {string} options.id - Stable id (MAC address, 12 hex digits).
   * @param {string} options.host - IP address.
   * @param {boolean} [options.legacy] - Legacy MAC prefix: original protocol first.
   * @param {Function} [options.connect] - Socket factory (tests).
   * @param {Function} [options.now] - Clock (ms).
   * @param {object} [options.timing] - TIMING overrides (tests).
   */
  constructor({ id, host, legacy = false, connect, now = Date.now, timing = {} }) {
    super();
    this.timing = { ...TIMING, ...timing };
    this.id = id;
    this.legacy = legacy;
    this.now = now;
    this.connect = connect;
    this.protocol = null;
    this.model = null;
    this.raw = null;
    this.view = null;
    this.memory = { color: null, kelvin: null, effectBrightness: 100, lastStatic: null };
    this.fadeUntil = 0;
    this.queue = Promise.resolve();
    this.setHost(host);
  }

  setHost(host) {
    if (this.host === host && this.client) {
      return;
    }
    this.host = host;
    this.client?.close();
    this.client = new MagicHomeClient({
      host,
      connectTimeoutMs: this.timing.connect,
      spacingMs: this.timing.spacing,
      ...(this.connect ? { connect: this.connect } : {}),
    });
    this.client.on('frame', (frame) => this.onFrame(frame));
    this.client.on('close', () => this.emit('disconnected'));
  }

  get identified() {
    return Boolean(this.protocol);
  }

  get isSwitch() {
    return Boolean(this.model?.switch);
  }

  get traits() {
    return traitsOf(this.protocol);
  }

  /** What Gladys can do with it (fixed once the device is created there). */
  get capabilities() {
    if (!this.model || this.isSwitch) {
      return { color: false, temperature: false, white: false, together: false };
    }
    return capabilitiesOf(this.view?.modes ?? this.model.modes);
  }

  get supportsEffects() {
    return Boolean(
      this.model && !this.isSwitch && this.capabilities.color && !this.traits.addressable,
    );
  }

  /** Run a task after the previous one of this device. */
  serial(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  onFrame(frame) {
    if (!this.protocol) {
      return;
    }
    const state = parseState(frame);
    if (state) {
      this.applyState(state);
      return;
    }
    const power = parsePower(frame);
    if (power !== null && this.raw) {
      this.applyState({ ...this.raw, on: power });
    }
  }

  /**
   * @description Take a state.
   * @param {object} raw - parseState() result.
   */
  applyState(raw) {
    let next = raw;
    if (this.raw && this.now() < this.fadeUntil) {
      const { r, g, b, ww, cw } = this.raw;
      next = { ...raw, r, g, b, ww, cw };
    }
    this.raw = next;
    this.view = describe(next, this.model, this.protocol, this.memory);
    if (this.view.color !== null) {
      this.memory.color = [
        (this.view.color >> 16) & 0xff,
        (this.view.color >> 8) & 0xff,
        this.view.color & 0xff,
      ];
    }
    if (this.view.kelvin !== null) {
      this.memory.kelvin = this.view.kelvin;
    }
    if (this.view.mode === 'static' && this.view.group !== 'none') {
      this.memory.lastStatic = { ...this.view.levels };
    }
    this.emit('state', this.view);
  }

  /**
   * @description Find the protocol and read the first state.
   * @returns {Promise<object>} The view.
   */
  async identify() {
    const probes = this.legacy ? [P.ORIGINAL, P.BYTE8] : [P.BYTE8, P.ORIGINAL];
    for (const probe of probes) {
      // An unreachable device throws here (ConnectionError): no point in a second probe.
      const answer = await this.client.request(stateQuery(probe), parseState, this.timing.probe);
      if (answer) {
        this.model = modelOf(answer.model, probe === P.ORIGINAL ? P.ORIGINAL : P.BYTE8);
        this.protocol = protocolFor(this.model, answer.version);
        this.applyState(answer);
        return this.view;
      }
      // A device that does not understand a probe may close the connection.
      this.client.close();
    }
    throw new ConnectionError(`${this.host} does not answer the Magic Home protocol`);
  }

  /**
   * @description Read the state.
   * @returns {Promise<object>} The view.
   */
  refresh() {
    return this.serial(async () => {
      if (!this.protocol) {
        return this.identify();
      }
      const answer = await this.client.request(
        stateQuery(this.protocol, () => this.client.nextCounter()),
        parseState,
        this.timing.state,
      );
      if (!answer) {
        // A silent connection may be half-open (device unplugged): start over next time.
        this.client.close();
        throw new ConnectionError(`${this.host} did not answer the state query`);
      }
      this.applyState(answer);
      return this.view;
    });
  }

  async ensureIdentified() {
    if (!this.protocol) {
      await this.identify();
    }
  }

  async powerLocked(on) {
    await this.ensureIdentified();
    for (let attempt = 0; attempt < POWER_ATTEMPTS; attempt += 1) {
      const answer = await this.client.request(
        powerFrame(this.protocol, on, () => this.client.nextCounter()),
        stateOrPower,
        this.timing.power,
      );
      if (answer?.state) {
        this.applyState(answer.state);
      } else if (answer && this.raw) {
        this.applyState({ ...this.raw, on: answer.power });
      }
      if (this.view?.on === on) {
        return this.view;
      }
      const state = await this.client.request(
        stateQuery(this.protocol, () => this.client.nextCounter()),
        parseState,
        this.timing.state,
      );
      if (!state) {
        // Silent twice in a row: a dead connection, not a slow device. Stop
        // here rather than outlive the deadline of the Gladys command.
        this.client.close();
        throw new ConnectionError(`${this.host} did not answer`);
      }
      this.applyState(state);
      if (this.view.on === on) {
        return this.view;
      }
    }
    throw new ConnectionError(`${this.host} did not confirm the power ${on ? 'on' : 'off'}`);
  }

  /**
   * @description Power on or off.
   * @param {boolean} on - Wanted state.
   * @returns {Promise<object>} The view.
   */
  setPower(on) {
    return this.serial(() => this.powerLocked(on));
  }

  /** The raw state a levels command leads to (shown before the fade ends). */
  rawAfter(levels) {
    const deviceSlots = slots(levels, this.model);
    if (this.protocol === P.CCT || this.protocol === P.CCT_WRAPPED) {
      const white = levelsToScaledWhite(levels.ww, levels.cw);
      return { ...this.raw, ...deviceSlots, ww: white.temperature, cw: white.brightness };
    }
    return { ...this.raw, ...deviceSlots };
  }

  async levelsLocked(planned) {
    if (!planned) {
      throw new UnsupportedError('levels');
    }
    if (!this.view.on && this.traits.requiresTurnOn) {
      await this.powerLocked(true);
    }
    const frames = levelsFrames(
      this.protocol,
      slots(planned.levels, this.model),
      planned.mode,
      () => this.client.nextCounter(),
    );
    for (const frame of frames) {
      await this.client.send(frame);
    }
    this.fadeUntil = 0;
    this.applyState({ ...this.rawAfter(planned.levels), on: true, pattern: 0x61 });
    this.fadeUntil = this.now() + this.timing.fade;
    return this.view;
  }

  /**
   * @description Set a colour, keeping the brightness.
   * @param {number[]} rgb - `[r, g, b]`.
   * @returns {Promise<object>} The view.
   */
  setColor(rgb) {
    return this.serial(async () => {
      await this.ensureIdentified();
      return this.levelsLocked(plan(this.view, this.model, { color: rgb }, this.memory));
    });
  }

  /**
   * @description Set a white temperature, keeping the brightness.
   * @param {number} kelvin - Colour temperature.
   * @returns {Promise<object>} The view.
   */
  setKelvin(kelvin) {
    return this.serial(async () => {
      await this.ensureIdentified();
      return this.levelsLocked(plan(this.view, this.model, { kelvin }, this.memory));
    });
  }

  /**
   * @description Set the brightness; 0 powers off.
   * @param {number} brightness - 0-255.
   * @returns {Promise<object>} The view.
   */
  setBrightness(brightness) {
    return this.serial(async () => {
      await this.ensureIdentified();
      if (brightness <= 0) {
        return this.powerLocked(false);
      }
      const { mode, effect, speed } = this.view;
      if (mode === 'effect' && effect && this.traits.dimmableEffects) {
        return this.effectLocked(effect, null, Math.round((brightness * 100) / 255), speed);
      }
      return this.levelsLocked(plan(this.view, this.model, { brightness }, this.memory));
    });
  }

  async effectLocked(effect, speed, brightness, delayByte) {
    const pattern = EFFECTS[effect];
    if (pattern === undefined || !this.supportsEffects) {
      throw new UnsupportedError(`effect ${effect}`);
    }
    if (DIMMABLE_ONLY_EFFECTS.has(effect) && !this.traits.dimmableEffects) {
      throw new UnsupportedError(`effect ${effect}`);
    }
    // Keep the running speed when only the brightness changes.
    const effectiveSpeed = speed ?? (delayByte ? delayToSpeed(delayByte) : 50);
    const frame = presetFrame(this.protocol, pattern, effectiveSpeed, brightness);
    if (!frame) {
      throw new UnsupportedError(`effect ${effect}`);
    }
    if (!this.view.on && this.traits.requiresTurnOn) {
      await this.powerLocked(true);
    }
    await this.client.send(frame);
    this.memory.effectBrightness = Math.max(1, Math.min(100, Math.round(brightness)));
    this.applyState({ ...this.raw, on: true, pattern, speed: speedToDelay(effectiveSpeed) });
    return this.view;
  }

  /**
   * @description Start a built-in effect.
   * @param {string} effect - EFFECTS key.
   * @param {number} speed - 0-100.
   * @param {number} brightness - 1-100 (firmwares with dimmable effects).
   * @returns {Promise<object>} The view.
   */
  startEffect(effect, speed, brightness) {
    return this.serial(async () => {
      await this.ensureIdentified();
      return this.effectLocked(effect, speed, brightness);
    });
  }

  /**
   * @description Play colours in a loop.
   * @param {number[][]} colors - 1 to 16 `[r, g, b]`.
   * @param {number} speed - 0-100.
   * @param {string} transition - `gradual`, `jump` or `strobe`.
   * @returns {Promise<object>} The view.
   */
  startCustom(colors, speed, transition) {
    return this.serial(async () => {
      await this.ensureIdentified();
      if (!this.supportsEffects) {
        throw new UnsupportedError('custom effect');
      }
      const frame = customFrame(this.protocol, colors, speed, transition);
      if (!frame) {
        throw new UnsupportedError('custom effect');
      }
      if (!this.view.on && this.traits.requiresTurnOn) {
        await this.powerLocked(true);
      }
      await this.client.send(frame);
      this.applyState({
        ...this.raw,
        on: true,
        pattern: PATTERN_CUSTOM,
        speed: speedToDelay(speed),
      });
      return this.view;
    });
  }

  /**
   * @description Back to a steady light: the last static levels seen.
   * @returns {Promise<object>} The view.
   */
  stopEffect() {
    return this.serial(async () => {
      await this.ensureIdentified();
      const levels = this.memory.lastStatic;
      if (!levels) {
        return this.levelsLocked(
          plan({ ...this.view, group: 'none' }, this.model, { brightness: 255 }, this.memory),
        );
      }
      const { caps } = this.view;
      const colorLit = levels.r || levels.g || levels.b;
      const mode = this.model.allWrites || caps.together ? 'all' : colorLit ? 'colors' : 'whites';
      return this.levelsLocked({ levels, mode });
    });
  }

  /** What `restore` needs to come back to the current state. */
  snapshot() {
    return this.view ? { view: { ...this.view }, levels: { ...this.view.levels } } : null;
  }

  /**
   * @description Come back to a snapshot (after a flash).
   * @param {object} snapshot - snapshot() result.
   * @returns {Promise<object>} The view.
   */
  restore(snapshot) {
    return this.serial(async () => {
      if (!snapshot) {
        return this.view;
      }
      const { view, levels } = snapshot;
      if (view.mode === 'effect' && view.effect) {
        await this.effectLocked(view.effect, null, this.memory.effectBrightness, view.speed);
      } else if (view.group !== 'none') {
        const colorLit = levels.r || levels.g || levels.b;
        const mode =
          this.model.allWrites || view.caps.together ? 'all' : colorLit ? 'colors' : 'whites';
        await this.levelsLocked({ levels, mode });
      }
      if (!view.on) {
        await this.powerLocked(false);
      }
      return this.view;
    });
  }

  close() {
    this.client.close();
  }
}
