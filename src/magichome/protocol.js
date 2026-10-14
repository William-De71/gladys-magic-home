// -----------------------------------------------------------------------------
// Frames of the Magic Home TCP protocol (port 5577): builders and parsers.
// Pure: no socket, every function returns or reads a Buffer.
//
// Three generations live side by side:
//   original   no checksum: query EF 01 77, state 66 … (11 bytes)
//   checksum   the last byte is the sum of the others: query 81 8A 8B,
//              state 81 … (14 bytes), power 71 23|24 0F, levels 31 …
//   wrapped    the newest firmwares put the same frames in an envelope:
//              B0 B1 B2 B3 00 01 <version> <counter> <len16> <inner> <sum>
// The 25-byte firmware (bulbs 0x35 v10+) sets colours in HSV, and some
// devices answer an "extended" state (EA 81 …) instead of the 14 bytes.
// -----------------------------------------------------------------------------

import { levelsToScaledWhite, rgbToHsv, hsvToRgb, scaledWhiteToLevels, clamp } from './color.js';
import { POWER_OFF, POWER_ON, TRANSITIONS } from './constants.js';
import { PROTOCOLS as P, traitsOf } from './models.js';

const WRAPPER = [0xb0, 0xb1, 0xb2, 0xb3, 0x00, 0x01];
const WRAPPER_HEADER = 10;
export const EXTENDED_STATE_LENGTH = 27;

export const checksum = (bytes) => bytes.reduce((sum, value) => (sum + value) & 0xff, 0);

/** Append the checksum. */
export const withChecksum = (bytes) => Buffer.from([...bytes, checksum(bytes)]);

/** Is the last byte the sum of the others? */
export const checksumOk = (frame) =>
  frame.length > 1 && checksum([...frame.subarray(0, -1)]) === frame[frame.length - 1];

/**
 * @description Put a frame in the 0xB0 envelope.
 * @param {Buffer|number[]} inner - The inner frame (already complete).
 * @param {number} counter - Sequence number, 0-254.
 * @param {number} [version] - Envelope version (2 for the 25-byte levels).
 * @returns {Buffer} The wrapped frame.
 */
export function wrap(inner, counter, version = 0x01) {
  const length = inner.length;
  return withChecksum([
    ...WRAPPER,
    version,
    counter & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
    ...inner,
  ]);
}

const family = (protocol) => {
  if (protocol === P.ORIGINAL || protocol === P.ORIGINAL_CCT) {
    return 'original';
  }
  if (protocol === P.BYTE25 || protocol === P.EXTENDED) {
    return '25byte';
  }
  if (protocol === P.CCT || protocol === P.CCT_WRAPPED) {
    return 'cct';
  }
  if (protocol === P.ADDRESSABLE_A2 || protocol === P.ADDRESSABLE_A3) {
    return 'a2';
  }
  if (protocol === P.CHRISTMAS) {
    return 'christmas';
  }
  if (
    protocol === P.BYTE9 ||
    protocol === P.BYTE9_AUTO_ON ||
    protocol === P.BYTE9_DIMMABLE ||
    protocol === P.ADDRESSABLE_A1
  ) {
    return '9byte';
  }
  return '8byte';
};

export const isOriginal = (protocol) => family(protocol) === 'original';

/** The write mode byte: colours only, whites only, or both. */
export function writeModeByte(protocol, mode) {
  if (family(protocol) === '25byte') {
    return { all: 0x00, colors: 0xa1, whites: 0xb1 }[mode];
  }
  return { all: 0x00, colors: 0xf0, whites: 0x0f }[mode];
}

// --- Builders ----------------------------------------------------------------

/**
 * @description The state query.
 * @param {string} protocol - Protocol.
 * @param {Function} counter - `() => number`, sequence of wrapped frames.
 * @returns {Buffer} The frame.
 */
export function stateQuery(protocol, counter = () => 0) {
  if (isOriginal(protocol)) {
    return Buffer.from([0xef, 0x01, 0x77]);
  }
  const query = withChecksum([0x81, 0x8a, 0x8b]);
  return traitsOf(protocol).wrapped ? wrap(query, counter()) : query;
}

/**
 * @description Power on or off.
 * @param {string} protocol - Protocol.
 * @param {boolean} on - Wanted state.
 * @param {Function} counter - Sequence of wrapped frames.
 * @returns {Buffer} The frame.
 */
export function powerFrame(protocol, on, counter = () => 0) {
  const state = on ? POWER_ON : POWER_OFF;
  if (isOriginal(protocol)) {
    return Buffer.from([0xcc, state, 0x33]);
  }
  const frame = withChecksum([0x71, state, 0x0f]);
  return traitsOf(protocol).wrapped ? wrap(frame, counter()) : frame;
}

/**
 * @description Set channel levels. Channels left `null` are sent as 0: the
 * caller always passes the full set it wants.
 * @param {string} protocol - Protocol.
 * @param {object} levels - `{ r, g, b, ww, cw }` 0-255 (device slots, after any channel remapping).
 * @param {string} mode - `all`, `colors` or `whites`.
 * @param {Function} counter - Sequence of wrapped frames.
 * @returns {Buffer[]} The frames, in order.
 */
export function levelsFrames(
  protocol,
  { r = 0, g = 0, b = 0, ww = 0, cw = 0 },
  mode,
  counter = () => 0,
) {
  const writeMode = writeModeByte(protocol, mode);
  switch (family(protocol)) {
    case 'original':
      return protocol === P.ORIGINAL_CCT
        ? [Buffer.from([0x56, r, g, 0xaa])]
        : [Buffer.from([0x56, r, g, b, 0xaa])];
    case '9byte':
      return [withChecksum([0x31, r, g, b, ww, cw, writeMode, 0x0f])];
    case '25byte': {
      const { h, s, v } = rgbToHsv(r, g, b);
      const white = levelsToScaledWhite(ww, cw);
      const colors = mode !== 'whites';
      const inner = [
        0xe0,
        0x01,
        0x00,
        writeMode,
        colors ? Math.floor((h * 360) / 2) : 0,
        colors ? Math.floor(s * 100) : 0,
        colors ? Math.floor(v * 100) : 0,
        mode !== 'colors' ? white.temperature : 0,
        mode !== 'colors' ? white.brightness : 0,
        0x00,
        0x00,
        0x14,
        0x00,
        0x00,
      ];
      // The 25-byte envelope carries the inner bytes WITHOUT their own checksum.
      return [wrap(inner, counter(), 0x02)];
    }
    case 'cct': {
      const white = levelsToScaledWhite(ww, cw);
      // Below 2 % these bulbs flip from cool to warm.
      const frame = withChecksum([
        0x35,
        0xb1,
        white.temperature,
        Math.max(2, white.brightness),
        0x00,
        0x00,
        0x00,
        0x03,
      ]);
      return [protocol === P.CCT_WRAPPED ? wrap(frame, counter()) : frame];
    }
    case 'a2': {
      const frame = withChecksum([0x41, 0x01, r, g, b, 0x00, 0x00, 0x00, 0x60, 0xff, 0x00, 0x00]);
      return [protocol === P.ADDRESSABLE_A3 ? wrap(frame, counter()) : frame];
    }
    case 'christmas': {
      const { h, s, v } = rgbToHsv(r, g, b);
      const inner = withChecksum([
        0x3b,
        0xa1,
        Math.floor(h * 180),
        Math.floor(s * 100),
        Math.floor(v * 100),
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]);
      return [wrap(inner, counter())];
    }
    default:
      return [withChecksum([0x31, r, g, b, ww, writeMode, 0x0f])];
  }
}

/** Effect speed 0-100 (fast) to the device delay 1-31 (slow). */
export const speedToDelay = (speed) => Math.floor(((100 - clamp(speed, 0, 100)) * 30) / 100) + 1;
export const delayToSpeed = (delay) => 100 - Math.floor((clamp(delay - 1, 0, 30) * 100) / 30);

/**
 * @description Start a built-in effect.
 * @param {string} protocol - Protocol.
 * @param {number} pattern - Pattern code (EFFECTS).
 * @param {number} speed - 0-100.
 * @param {number} brightness - 1-100 (dimmable effects only).
 * @returns {Buffer|null} The frame, or null when this protocol has no such effects.
 */
export function presetFrame(protocol, pattern, speed, brightness) {
  const traits = traitsOf(protocol);
  if (traits.addressable) {
    return null;
  }
  const delay = speedToDelay(speed);
  if (isOriginal(protocol)) {
    return Buffer.from([0xbb, pattern, delay, 0x44]);
  }
  if (traits.dimmableEffects) {
    return withChecksum([0x38, pattern, delay, clamp(Math.round(brightness), 1, 100)]);
  }
  return withChecksum([0x61, pattern, delay, 0x0f]);
}

/**
 * @description A custom effect: up to 16 colours played in a loop.
 * @param {string} protocol - Protocol.
 * @param {number[][]} colors - `[r, g, b]` list (1 to 16).
 * @param {number} speed - 0-100.
 * @param {string} transition - `gradual`, `jump` or `strobe`.
 * @returns {Buffer|null} The frame, or null when not supported.
 */
export function customFrame(protocol, colors, speed, transition) {
  if (traitsOf(protocol).addressable || colors.length === 0) {
    return null;
  }
  const bytes = [];
  colors.slice(0, 16).forEach(([r, g, b], index) => bytes.push(index === 0 ? 0x51 : 0, r, g, b));
  for (let index = colors.length; index < 16; index += 1) {
    bytes.push(0, 1, 2, 3);
  }
  bytes.push(0x00, speedToDelay(speed), TRANSITIONS[transition] ?? TRANSITIONS.gradual, 0xff, 0x0f);
  return isOriginal(protocol) ? Buffer.from(bytes) : withChecksum(bytes);
}

// --- Parsers -----------------------------------------------------------------

const POWER_PREFIXES = new Set([0x00, 0x01, 0x0f, 0xf0]);

/**
 * @description How many bytes the frame starting this buffer has. An unknown
 * start consumes the whole buffer (nothing better can be done).
 * @param {Buffer} buffer - Received bytes.
 * @returns {number} Expected length.
 */
export function expectedLength(buffer) {
  if (buffer[0] === 0xb0) {
    if (buffer.length < WRAPPER_HEADER) {
      return WRAPPER_HEADER;
    }
    return WRAPPER_HEADER + ((buffer[8] << 8) | buffer[9]) + 1;
  }
  const [first, second] = buffer;
  if (POWER_PREFIXES.has(first) && buffer.length > 1) {
    const byType = { 0x71: 4, 0x11: 12, 0x32: 7, 0x63: 11 };
    if (byType[second]) {
      return byType[second];
    }
  }
  const single = { 0x81: 14, 0x66: 11, 0x78: 4, 0x63: 12, 0x72: 13, 0x2b: 14 };
  if (first === 0xea && second === 0x81) {
    // Extended state: no length field, 27 bytes on the devices documented so
    // far. A shorter one is flushed by the client after a short silence.
    return EXTENDED_STATE_LENGTH;
  }
  return single[first] ?? buffer.length;
}

/**
 * @description Take the inner frame out of an envelope.
 * @param {Buffer} frame - A received frame.
 * @returns {Buffer} The inner frame, or the frame itself when not wrapped.
 */
export function unwrap(frame) {
  if (frame[0] === 0xb0 && frame.length > WRAPPER_HEADER + 1 && checksumOk(frame)) {
    return frame.subarray(WRAPPER_HEADER, frame.length - 1);
  }
  return frame;
}

/**
 * @typedef {object} RawState
 * @property {number} model - Model number.
 * @property {number} version - Firmware version.
 * @property {boolean} on - Powered.
 * @property {number} pattern - What it plays (0x61 static, effect code…).
 * @property {number} mode - Wiring / mode byte.
 * @property {number} speed - Effect delay byte.
 * @property {number} r - Red.
 * @property {number} g - Green.
 * @property {number} b - Blue.
 * @property {number} ww - Warm white.
 * @property {number} cw - Cool white.
 * @property {string} format - `standard`, `original` or `extended`.
 */

/**
 * @description Read a state answer (or a pushed state).
 * @param {Buffer} frame - An unwrapped frame.
 * @returns {RawState|null} The state, or null when the frame is not one.
 */
export function parseState(frame) {
  if (frame.length === 14 && frame[0] === 0x81 && checksumOk(frame)) {
    return {
      format: 'standard',
      model: frame[1],
      on: frame[2] === POWER_ON,
      pattern: frame[3],
      mode: frame[4],
      speed: frame[5],
      r: frame[6],
      g: frame[7],
      b: frame[8],
      ww: frame[9],
      version: frame[10],
      cw: frame[11],
    };
  }
  if (frame.length === 11 && frame[0] === 0x66) {
    return {
      format: 'original',
      model: frame[1],
      on: frame[2] === POWER_ON,
      pattern: frame[3],
      mode: frame[4],
      speed: frame[5],
      r: frame[6],
      g: frame[7],
      b: frame[8],
      ww: frame[9],
      version: 0,
      cw: 0,
    };
  }
  if (frame.length >= 20 && frame[0] === 0xea && frame[1] === 0x81) {
    // HSV colour (hue / 2, saturation %, value %) and a scaled white. Byte 10
    // says which one is lit (F0 colour, 0F white): the other keeps stale values.
    const lit = frame[10];
    const [r, g, b] =
      lit === 0x0f ? [0, 0, 0] : hsvToRgb((frame[11] * 2) / 360, frame[12] / 100, frame[13] / 100);
    const temperature = frame[14];
    const brightness = frame[15];
    const [ww, cw] =
      lit !== 0xf0 && temperature <= 100 && brightness > 0 && brightness <= 100
        ? scaledWhiteToLevels(temperature, brightness)
        : [0, 0];
    return {
      format: 'extended',
      model: frame[4],
      version: frame[5],
      on: frame[6] === POWER_ON,
      pattern: frame[7],
      mode: 0,
      speed: frame[9],
      r,
      g,
      b,
      ww,
      cw,
    };
  }
  return null;
}

/**
 * @description Read a power answer (`?? 71 23|24 ??` or `78 ?? 23|24 ??`).
 * @param {Buffer} frame - An unwrapped frame.
 * @returns {boolean|null} On, off, or null when not a power answer.
 */
export function parsePower(frame) {
  if (frame.length !== 4) {
    return null;
  }
  const power = frame[2];
  if (power !== POWER_ON && power !== POWER_OFF) {
    return null;
  }
  if ((POWER_PREFIXES.has(frame[0]) && frame[1] === 0x71) || frame[0] === 0x78) {
    return power === POWER_ON;
  }
  return null;
}
