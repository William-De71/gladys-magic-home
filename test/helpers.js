// Test helpers: fake Magic Home devices behind a fake network (no socket is
// ever opened), a clock, a silent logger.
//
// A FakeBulb answers the frames of the real protocol (test vectors of the
// flux_led documentation and of the Magic Home app) and keeps a raw state;
// `fakeNetwork().connect` replaces `net.createConnection` in the app.

import { EventEmitter } from 'node:events';
import { checksum, withChecksum, wrap } from '../src/magichome/protocol.js';
import { hsvToRgb, scaledWhiteToLevels } from '../src/magichome/color.js';

const ON = 0x23;
const OFF = 0x24;

/**
 * A fake device.
 * @param {object} options - Options.
 * @param {string} options.host - IP address.
 * @param {string} options.mac - 12 hex digits.
 * @param {number} [options.model] - Model number.
 * @param {number} [options.version] - Firmware version.
 * @param {string} [options.levels] - `8`, `9`, `25` or `cct`: levels frame it understands.
 * @param {boolean} [options.original] - Speaks the original protocol only.
 * @param {boolean} [options.wrapped] - Answers in the 0xB0 envelope.
 * @param {boolean} [options.push] - Sends its state after each change.
 * @param {boolean} [options.autoOn] - Levels and effects turn it on.
 */
export class FakeBulb {
  constructor({
    host,
    mac,
    model = 0x35,
    version = 0x09,
    levels = '9',
    original = false,
    wrapped = false,
    push = false,
    autoOn = true,
    moduleModel = 'AK001-ZJ2149',
    state = {},
  }) {
    Object.assign(this, {
      host,
      mac,
      model,
      version,
      levels,
      original,
      wrapped,
      push,
      autoOn,
      moduleModel,
    });
    this.state = {
      on: true,
      pattern: 0x61,
      mode: 0x01,
      speed: 0x10,
      r: 0,
      g: 0,
      b: 0,
      ww: 255,
      cw: 0,
      ...state,
    };
    this.received = [];
    this.unplugged = false;
    this.udp = true;
    this.counter = 0;
  }

  stateFrame() {
    const s = this.state;
    if (this.original) {
      return Buffer.from([
        0x66,
        this.model,
        s.on ? ON : OFF,
        s.pattern,
        s.mode,
        s.speed,
        s.r,
        s.g,
        s.b,
        s.ww,
        0x99,
      ]);
    }
    return withChecksum([
      0x81,
      this.model,
      s.on ? ON : OFF,
      s.pattern,
      s.mode,
      s.speed,
      s.r,
      s.g,
      s.b,
      s.ww,
      this.version,
      s.cw,
      0x00,
    ]);
  }

  out(frame) {
    return this.wrapped ? wrap(frame, (this.counter += 1)) : frame;
  }

  /** Bytes the device answers to a frame (null: nothing). */
  handle(frame) {
    this.received.push(Buffer.from(frame).toString('hex'));
    return this.process(frame);
  }

  process(frame) {
    const bytes = [...frame];
    const s = this.state;
    const sumOk = checksum(bytes.slice(0, -1)) === bytes[bytes.length - 1];
    if (bytes[0] === 0xb0) {
      return this.process(Buffer.from(bytes.slice(10, -1)));
    }
    if (bytes[0] === 0xef && bytes[1] === 0x01 && bytes[2] === 0x77) {
      return this.original ? this.stateFrame() : null;
    }
    if (this.original) {
      if (bytes[0] === 0xcc) {
        s.on = bytes[1] === ON;
        return Buffer.from([0x78, this.model, s.on ? ON : OFF, 0x00]);
      }
      if (bytes[0] === 0x56) {
        [s.r, s.g, s.b] = bytes.slice(1, 4);
        s.pattern = 0x41;
      }
      if (bytes[0] === 0xbb) {
        [s.pattern, s.speed] = bytes.slice(1, 3);
      }
      return null;
    }
    if (bytes[0] === 0x81 && bytes[1] === 0x8a && bytes[2] === 0x8b && sumOk) {
      return this.out(this.stateFrame());
    }
    if (bytes[0] === 0x71 && sumOk) {
      s.on = bytes[1] === ON;
      return this.out(withChecksum([0x0f, 0x71, s.on ? ON : OFF]));
    }
    if (bytes[0] === 0x31 && sumOk) {
      if (this.levels === '8') {
        [s.r, s.g, s.b, s.ww] = bytes.slice(1, 5);
      } else {
        [s.r, s.g, s.b, s.ww, s.cw] = bytes.slice(1, 6);
      }
      s.pattern = 0x61;
      return this.pushed();
    }
    if (bytes[0] === 0x35 && bytes[1] === 0xb1 && sumOk) {
      // CCT bulbs keep temperature and brightness (0-100) in the white slots.
      [s.ww, s.cw] = bytes.slice(2, 4);
      s.pattern = 0x61;
      return this.pushed();
    }
    if (bytes[0] === 0xe0 && bytes[1] === 0x01) {
      const [mode, h, sat, v, temperature, brightness] = bytes.slice(3, 9);
      if (mode === 0xb1) {
        [s.r, s.g, s.b] = [0, 0, 0];
        [s.ww, s.cw] = scaledWhiteToLevels(temperature, brightness);
      } else {
        [s.r, s.g, s.b] = hsvToRgb((h * 2) / 360, sat / 100, v / 100);
        [s.ww, s.cw] = [0, 0];
      }
      s.pattern = 0x61;
      return this.pushed();
    }
    if ((bytes[0] === 0x61 || bytes[0] === 0x38) && sumOk) {
      [s.pattern, s.speed] = bytes.slice(1, 3);
      return this.pushed();
    }
    if (bytes[0] === 0x51 && sumOk) {
      s.pattern = 0x60;
      return this.pushed();
    }
    return null;
  }

  pushed() {
    if (this.autoOn) {
      this.state.on = true;
    }
    return this.push ? this.out(this.stateFrame()) : null;
  }

  /** The UDP answer to the discovery datagram. */
  discoveryReply() {
    return {
      source_ip: this.host,
      source_port: 48899,
      payload_base64: Buffer.from(`${this.host},${this.mac},${this.moduleModel}`).toString(
        'base64',
      ),
    };
  }
}

class FakeSocket extends EventEmitter {
  constructor(network, host) {
    super();
    this.network = network;
    this.bulb = network.bulbs.get(host);
    this.destroyed = false;
    setImmediate(() => {
      if (!this.bulb || this.bulb.unplugged) {
        // An unplugged device: the connection attempt times out (no event).
        if (!this.bulb) {
          this.emit(
            'error',
            Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
          );
          this.destroy();
        }
        return;
      }
      network.open.add(this);
      this.emit('connect');
    });
  }

  setNoDelay() {}

  setKeepAlive() {}

  write(frame, callback) {
    callback?.();
    const bulb = this.bulb;
    if (!bulb || bulb.unplugged || this.destroyed) {
      return true;
    }
    // Handled at once (a test reads the device right after the command), answered later.
    const answer = bulb.handle(frame);
    if (answer) {
      setImmediate(() => {
        if (!this.destroyed) {
          this.emit('data', answer);
        }
      });
    }
    return true;
  }

  /** The device sends something on its own (remote control used). */
  push(frame) {
    this.emit('data', frame);
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.network.open.delete(this);
    setImmediate(() => this.emit('close'));
  }
}

/**
 * @description A network of fake devices.
 * @param {FakeBulb[]} bulbs - The devices.
 * @returns {object} `{ bulbs, connect, probe, scanReplies, open, socketOf }`.
 */
export function fakeNetwork(bulbs = []) {
  const network = {
    bulbs: new Map(bulbs.map((bulb) => [bulb.host, bulb])),
    open: new Set(),
    add(bulb) {
      network.bulbs.set(bulb.host, bulb);
    },
    connect: (port, host) => new FakeSocket(network, host),
    /** Unicast discovery (deps.probe of the app). */
    probe: async (host) => {
      const bulb = network.bulbs.get(host);
      if (!bulb || !bulb.udp || bulb.unplugged) {
        return null;
      }
      return { host, id: bulb.mac.toUpperCase(), moduleModel: bulb.moduleModel, legacy: false };
    },
    scanReplies: () =>
      [...network.bulbs.values()]
        .filter((bulb) => bulb.udp && !bulb.unplugged)
        .map((bulb) => bulb.discoveryReply()),
    socketOf: (host) => [...network.open].find((socket) => socket.bulb?.host === host),
  };
  return network;
}

export function fakeClock(start = Date.parse('2026-10-15T18:00:00Z')) {
  let current = start;
  return {
    now: () => current,
    advance(ms) {
      current += ms;
    },
  };
}

export const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export const flush = () => new Promise((resolve) => setImmediate(resolve));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Short protocol timeouts: an unplugged device fails in a few milliseconds. */
export const FAST_TIMING = { connect: 40, probe: 40, state: 40, power: 40, spacing: 1, fade: 0 };

const QUERIES = new Set(['ef0177']);

/** The last frame a fake device received that is not a state query. */
export const lastCommand = (bulb) =>
  bulb.received.filter((frame) => !QUERIES.has(frame) && !frame.includes('818a8b96')).at(-1);
