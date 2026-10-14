// -----------------------------------------------------------------------------
// What a state means, and which levels a command needs. Pure.
//
// The raw state carries device "slots"; some models put their whites in the
// red and green slots, CCT bulbs send a 0-100 temperature and brightness
// instead of levels, the A3 strips use their own white scale. `logical()`
// turns all of that into the same five channels (r, g, b, ww, cw, 0-255), and
// `slots()` does the reverse for a command.
//
// Gladys exposes one colour, one colour temperature and one brightness: the
// colour group (RGB) and the white group (warm/cool or single white) are
// treated as alternatives, like the Magic Home app does on bulbs.
// -----------------------------------------------------------------------------

import {
  atBrightness,
  clamp,
  rgbToHsv,
  rgbToInt,
  scaledWhiteToLevels,
  temperatureToWhiteLevels,
  unscaled,
  whiteLevelsToTemperature,
} from './color.js';
import {
  EFFECT_BY_PATTERN,
  LEGACY_CCT_EFFECTS,
  MAX_KELVIN,
  MIN_KELVIN,
  PATTERN_CUSTOM,
  PATTERN_MUSIC,
  PATTERN_STATIC,
} from './constants.js';
import { capabilitiesOf, colorModesOf, PROTOCOLS as P, traitsOf } from './models.js';

const a3WarmToByte = (value) => Math.round(((clamp(value, 128, 228) - 128) * 255) / 100);

/**
 * @description The five logical channels of a raw state.
 * @param {object} raw - parseState() result.
 * @param {object} model - modelOf() result.
 * @param {string} protocol - Protocol.
 * @returns {{ r: number, g: number, b: number, ww: number, cw: number }} 0-255 each.
 */
export function logical(raw, model, protocol) {
  let { r, g, b, ww, cw } = raw;
  if ((protocol === P.CCT || protocol === P.CCT_WRAPPED) && raw.format === 'standard') {
    // warm white slot = temperature 0-100, cool white slot = brightness 0-100
    [ww, cw] = scaledWhiteToLevels(Math.min(raw.ww, 100), Math.min(raw.cw, 100));
  } else if (model.channels === 'dim') {
    [r, ww] = [raw.ww, raw.r];
  } else if (model.channels === 'cct') {
    [r, g, ww, cw] = [raw.ww, raw.cw, raw.r, raw.g];
  } else if (protocol === P.ADDRESSABLE_A3) {
    ww = a3WarmToByte(raw.ww);
  }
  return { r, g, b, ww, cw };
}

/**
 * @description Logical channels to the device slots of a command.
 * @param {object} levels - `{ r, g, b, ww, cw }`.
 * @param {object} model - modelOf() result.
 * @returns {object} `{ r, g, b, ww, cw }` as the device expects them.
 */
export function slots({ r = 0, g = 0, b = 0, ww = 0, cw = 0 }, model) {
  if (model.channels === 'dim') {
    return { r: ww, g, b, ww: r, cw };
  }
  if (model.channels === 'cct') {
    return { r: ww, g: cw, b, ww: r, cw: g };
  }
  return { r, g, b, ww, cw };
}

/**
 * @description What the device is doing.
 * @param {number} pattern - Pattern byte.
 * @param {string} protocol - Protocol.
 * @returns {{ mode: string, effect: string|null }} `static`, `effect`, `custom` or `music`.
 */
export function playing(pattern, protocol) {
  if (PATTERN_STATIC.has(pattern)) {
    return { mode: 'static', effect: null };
  }
  if (pattern === PATTERN_CUSTOM) {
    return { mode: 'custom', effect: null };
  }
  if (PATTERN_MUSIC.has(pattern)) {
    return { mode: 'music', effect: null };
  }
  if (protocol === P.ORIGINAL_CCT && LEGACY_CCT_EFFECTS.has(pattern)) {
    return { mode: 'effect', effect: null };
  }
  if (EFFECT_BY_PATTERN.has(pattern)) {
    return { mode: 'effect', effect: EFFECT_BY_PATTERN.get(pattern) };
  }
  if (traitsOf(protocol).addressable && pattern !== 0) {
    // Hundreds of strip animations, numbered differently on every generation.
    return { mode: 'effect', effect: null };
  }
  // Timers and unknown patterns: the channels say what is lit.
  return { mode: 'static', effect: null };
}

/**
 * @typedef {object} LightView
 * @property {boolean} on - Powered.
 * @property {string[]} modes - Colour modes of the current wiring.
 * @property {object} caps - capabilitiesOf(modes).
 * @property {object} levels - Logical channels.
 * @property {string} group - Lit channels: `color`, `white`, `mixed` or `none`.
 * @property {string} mode - `static`, `effect`, `custom` or `music`.
 * @property {string|null} effect - Built-in effect key.
 * @property {number} speed - Effect speed byte.
 * @property {number} brightness - 0-255.
 * @property {number|null} color - 0xRRGGBB at full value, when the colour group is lit.
 * @property {number|null} kelvin - When the white group is lit on a CCT device.
 */

/**
 * @description Interpret a raw state.
 * @param {object} raw - parseState() result.
 * @param {object} model - modelOf() result.
 * @param {string} protocol - Protocol.
 * @param {object} [memory] - `{ effectBrightness }` 1-100, last effect brightness sent.
 * @returns {LightView} The view.
 */
export function describe(raw, model, protocol, { effectBrightness = 100 } = {}) {
  const modes = colorModesOf(model, raw.mode);
  const caps = capabilitiesOf(modes);
  const levels = logical(raw, model, protocol);
  const colorLit = Boolean(levels.r || levels.g || levels.b);
  const whiteLit = Boolean(levels.ww || levels.cw);
  const group = colorLit && whiteLit ? 'mixed' : colorLit ? 'color' : whiteLit ? 'white' : 'none';
  const { mode, effect } = playing(raw.pattern, protocol);

  const colorValue = Math.round(rgbToHsv(levels.r, levels.g, levels.b).v * 255);
  const white = whiteLevelsToTemperature(levels.ww, levels.cw);
  let brightness;
  if (mode === 'effect' || mode === 'music') {
    brightness = traitsOf(protocol).dimmableEffects
      ? Math.round((effectBrightness * 255) / 100)
      : 255;
  } else if (group === 'color') {
    brightness = colorValue;
  } else if (group === 'white') {
    brightness = caps.temperature ? white.brightness : Math.max(levels.ww, levels.cw);
  } else if (group === 'mixed') {
    const parts = [colorValue, levels.ww, ...(caps.temperature ? [levels.cw] : [])];
    brightness = Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length);
  } else {
    brightness = 0;
  }

  return {
    on: raw.on,
    modes,
    caps,
    levels,
    group,
    mode,
    effect,
    speed: raw.speed,
    brightness,
    color: colorLit ? rgbToInt(unscaled([levels.r, levels.g, levels.b])) : null,
    kelvin: whiteLit && caps.temperature && !colorLit ? white.kelvin : null,
  };
}

const writeModeFor = (model, caps, target) => {
  if (model.allWrites || caps.together) {
    return 'all';
  }
  return target === 'color' ? 'colors' : 'whites';
};

const isGrey = ([r, g, b]) => r === g && g === b;

/**
 * @description The levels of a command.
 * @param {LightView} view - Current view.
 * @param {object} model - modelOf() result.
 * @param {object} target - One of
 *   `{ color: [r, g, b] }` (any value: the current brightness is kept),
 *   `{ kelvin }`, `{ brightness }` (0-255).
 * @param {object} [memory] - `{ color, kelvin }` last colour and temperature seen.
 * @returns {{ levels: object, mode: string }|null} Logical levels and write
 * mode, or null when the device cannot do it.
 */
export function plan(view, model, target, memory = {}) {
  const { caps } = view;
  const keep = view.brightness > 0 ? view.brightness : 255;
  const lastColor = memory.color ?? [255, 255, 255];
  const lastKelvin = memory.kelvin ?? MAX_KELVIN;

  const colorLevels = (rgb, brightness) => {
    if (!caps.color || (isGrey(rgb) && caps.white && !caps.temperature)) {
      // A white asked to an RGB+W device lights its white channel.
      if (!caps.white && !caps.temperature) {
        return null;
      }
      return whiteLevels(null, brightness);
    }
    const [r, g, b] = atBrightness(rgb, brightness);
    return { levels: { r, g, b, ww: 0, cw: 0 }, mode: writeModeFor(model, caps, 'color') };
  };

  const whiteLevels = (kelvin, brightness) => {
    if (caps.temperature) {
      const [ww, cw] = temperatureToWhiteLevels(kelvin ?? lastKelvin, brightness);
      return { levels: { r: 0, g: 0, b: 0, ww, cw }, mode: writeModeFor(model, caps, 'white') };
    }
    if (caps.white) {
      return {
        levels: { r: 0, g: 0, b: 0, ww: clamp(Math.round(brightness), 0, 255), cw: 0 },
        mode: writeModeFor(model, caps, 'white'),
      };
    }
    return null;
  };

  if (target.color) {
    return colorLevels(target.color, keep);
  }
  if (target.kelvin !== undefined) {
    return caps.temperature
      ? whiteLevels(clamp(target.kelvin, MIN_KELVIN, MAX_KELVIN), keep)
      : null;
  }
  const brightness = clamp(Math.round(target.brightness), 0, 255);
  switch (view.group) {
    case 'color':
      return colorLevels([view.levels.r, view.levels.g, view.levels.b], brightness);
    case 'white':
      return whiteLevels(view.kelvin ?? lastKelvin, brightness);
    case 'mixed': {
      const factor = view.brightness > 0 ? brightness / view.brightness : 1;
      const scale = (value) => clamp(Math.round(value * factor), 0, 255);
      const { r, g, b, ww, cw } = view.levels;
      return {
        levels: { r: scale(r), g: scale(g), b: scale(b), ww: scale(ww), cw: scale(cw) },
        mode: 'all',
      };
    }
    default:
      // Nothing lit (an effect, or levels at 0): white when possible, else the
      // last colour.
      if (caps.white || caps.temperature) {
        return whiteLevels(lastKelvin, brightness);
      }
      return colorLevels(lastColor, brightness);
  }
}
