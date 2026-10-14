// The Magic Home protocol, frame by frame. The hexadecimal vectors are frames
// captured from real devices and the Magic Home app, as documented by the
// flux_led library (see NOTICE): a builder must produce them byte for byte,
// a parser must read them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  customFrame,
  delayToSpeed,
  expectedLength,
  levelsFrames,
  parsePower,
  parseState,
  powerFrame,
  presetFrame,
  speedToDelay,
  stateQuery,
  unwrap,
  withChecksum,
  wrap,
} from '../src/magichome/protocol.js';
import { MagicHomeClient } from '../src/magichome/client.js';
import { describe as describeState, logical, plan } from '../src/magichome/light.js';
import {
  colorModesOf,
  modelOf,
  MODEL_NUMS,
  protocolFor,
  PROTOCOLS,
} from '../src/magichome/models.js';
import { parseDiscoveryReply, parseHosts, broadcastScan } from '../src/magichome/discovery.js';
import {
  hsvToRgb,
  kelvinToMired,
  parseHexColor,
  rgbToHsv,
  temperatureToWhiteLevels,
  whiteLevelsToTemperature,
} from '../src/magichome/color.js';

const hex = (value) => Buffer.from(value.replace(/\s+/g, ''), 'hex');
const bytes = (buffer) => buffer.toString('hex');

test('state answer (14 bytes, checksum) of a 5-channel controller', () => {
  const state = parseState(hex('81 25 23 61 21 06 38 05 06 f9 01 00 0f 9d'));
  assert.deepEqual(state, {
    format: 'standard',
    model: 0x25,
    on: true,
    pattern: 0x61,
    mode: 0x21,
    speed: 0x06,
    r: 0x38,
    g: 0x05,
    b: 0x06,
    ww: 0xf9,
    version: 0x01,
    cw: 0x00,
  });
  // A wrong checksum is not a state.
  assert.equal(parseState(hex('81 25 23 61 21 06 38 05 06 f9 01 00 0f 9e')), null);
});

test('state answer of the original protocol (11 bytes, no checksum)', () => {
  const state = parseState(hex('66 01 24 39 21 0a ff 00 00 01 99'));
  assert.equal(state.format, 'original');
  assert.equal(state.model, 0x01);
  assert.equal(state.on, false);
  assert.deepEqual([state.r, state.g, state.b, state.ww], [255, 0, 0, 1]);
});

test('extended state: HSV colour or scaled white, as byte 10 says', () => {
  // White lit (0F): the HSV bytes are stale.
  const white = parseState(hex('EA 81 01 10 35 0A 23 61 01 50 0F 3C 64 64 00 64 00 00 00 00'));
  assert.equal(white.model, 0x35);
  assert.equal(white.version, 0x0a);
  assert.deepEqual([white.r, white.g, white.b, white.ww, white.cw], [0, 0, 0, 255, 0]);
  // Colour lit (F0): hue 0x3C * 2 = 120° = green.
  const color = parseState(hex('EA 81 01 10 35 0A 23 61 01 50 F0 3C 64 64 00 64 00 00 00 00'));
  assert.deepEqual([color.r, color.g, color.b, color.ww, color.cw], [0, 255, 0, 0, 0]);
});

test('power answers', () => {
  assert.equal(parsePower(withChecksum([0x0f, 0x71, 0x23])), true);
  assert.equal(parsePower(withChecksum([0xf0, 0x71, 0x24])), false);
  assert.equal(parsePower(hex('78 01 23 00')), true);
  assert.equal(parsePower(hex('81 8a 8b 96')), null);
});

test('queries and power commands of every generation', () => {
  assert.equal(bytes(stateQuery(PROTOCOLS.BYTE8)), '818a8b96');
  assert.equal(bytes(stateQuery(PROTOCOLS.ORIGINAL)), 'ef0177');
  // Addressable v3: the query in the envelope (captured: counter 0x0c).
  assert.equal(
    bytes(stateQuery(PROTOCOLS.ADDRESSABLE_A3, () => 0x0c)),
    'b0b1b2b30001010c0004818a8b9604',
  );
  assert.equal(bytes(powerFrame(PROTOCOLS.BYTE9, true)), '71230fa3');
  assert.equal(bytes(powerFrame(PROTOCOLS.BYTE9, false)), '71240fa4');
  assert.equal(bytes(powerFrame(PROTOCOLS.ORIGINAL, true)), 'cc2333');
});

test('levels of the 8- and 9-byte protocols', () => {
  assert.equal(
    bytes(levelsFrames(PROTOCOLS.BYTE8, { r: 0x90, g: 0xfa, b: 0x77 }, 'colors')[0]),
    bytes(withChecksum([0x31, 0x90, 0xfa, 0x77, 0, 0xf0, 0x0f])),
  );
  assert.equal(
    bytes(levelsFrames(PROTOCOLS.BYTE9_DIMMABLE, { r: 0xbc, g: 0xc1, b: 0xff }, 'colors')[0]),
    bytes(withChecksum([0x31, 0xbc, 0xc1, 0xff, 0, 0, 0xf0, 0x0f])),
  );
  assert.equal(
    bytes(levelsFrames(PROTOCOLS.BYTE9, { ww: 10, cw: 20 }, 'all')[0]),
    bytes(withChecksum([0x31, 0, 0, 0, 10, 20, 0x00, 0x0f])),
  );
  assert.equal(
    bytes(levelsFrames(PROTOCOLS.ORIGINAL, { r: 0x90, g: 0xfa, b: 0x77 }, 'all')[0]),
    '5690fa77aa',
  );
});

test('levels of the 25-byte firmware: HSV in a version 2 envelope (captured frame)', () => {
  // b0 b1 b2 b3 00 01 02 79 00 0e e0 01 00 a1 78 64 64 00 00 00 00 14 00 00 = blue
  const [frame] = levelsFrames(PROTOCOLS.BYTE25, { r: 0, g: 0, b: 255 }, 'colors', () => 0x79);
  assert.equal(
    bytes(frame).slice(0, -2),
    'b0b1b2b300010279000e' + 'e00100a1786464' + '00000000' + '140000',
  );
  const [white] = levelsFrames(PROTOCOLS.BYTE25, { ww: 0, cw: 255 }, 'whites', () => 1);
  // write mode b1, temperature 100 (cool), brightness 100
  assert.deepEqual([...white.subarray(13, 19)], [0xb1, 0, 0, 0, 100, 100]);
});

test('levels of the CCT bulbs: temperature and brightness 0-100 (captured frames)', () => {
  // b0 b1 b2 b3 00 01 01 52 00 09 35 b1 00 64 00 00 00 03 4d bd = 100 % warm
  assert.equal(
    bytes(levelsFrames(PROTOCOLS.CCT_WRAPPED, { ww: 255, cw: 0 }, 'whites', () => 0x52)[0]),
    'b0b1b2b30001015200093' + '5b1006400000003' + '4dbd',
  );
  // b0 b1 b2 b3 00 01 01 72 00 09 35 b1 64 64 00 00 00 03 b1 a5 = 100 % cool
  assert.equal(
    bytes(levelsFrames(PROTOCOLS.CCT_WRAPPED, { ww: 0, cw: 255 }, 'whites', () => 0x72)[0]),
    'b0b1b2b3000101720009' + '35b16464000000' + '03b1a5',
  );
  // Never under 2 % (the bulbs flip from cool to warm).
  assert.equal(levelsFrames(PROTOCOLS.CCT, { ww: 0, cw: 1 }, 'whites')[0][3], 2);
});

test('levels of the strips (addressable, Christmas)', () => {
  assert.equal(
    bytes(levelsFrames(PROTOCOLS.ADDRESSABLE_A2, { r: 255, g: 255, b: 255 }, 'colors')[0]),
    bytes(withChecksum([0x41, 0x01, 255, 255, 255, 0, 0, 0, 0x60, 0xff, 0, 0])),
  );
  // Christmas lights: 3b a1 <hue * 180> <sat %> <val %> … (green = 3c 64 64).
  const [christmas] = levelsFrames(PROTOCOLS.CHRISTMAS, { r: 0, g: 255, b: 0 }, 'colors', () => 1);
  assert.equal(bytes(unwrap(christmas)), '3ba13c6464000000000000' + '00e0');
});

test('effects and custom effects', () => {
  assert.equal(speedToDelay(100), 1);
  assert.equal(speedToDelay(0), 31);
  assert.equal(delayToSpeed(1), 100);
  assert.equal(delayToSpeed(31), 0);
  assert.equal(
    bytes(presetFrame(PROTOCOLS.BYTE8, 0x25, 100, 50)),
    bytes(withChecksum([0x61, 0x25, 1, 0x0f])),
  );
  assert.equal(
    bytes(presetFrame(PROTOCOLS.BYTE9_DIMMABLE, 0x38, 0, 40)),
    bytes(withChecksum([0x38, 0x38, 31, 40])),
  );
  assert.equal(bytes(presetFrame(PROTOCOLS.ORIGINAL, 0x25, 100, 100)), 'bb250144');
  assert.equal(presetFrame(PROTOCOLS.ADDRESSABLE_A3, 0x25, 50, 50), null);

  const custom = customFrame(
    PROTOCOLS.BYTE8,
    [
      [255, 0, 0],
      [0, 0, 255],
    ],
    100,
    'jump',
  );
  assert.equal(custom.length, 16 * 4 + 5 + 1);
  assert.deepEqual([...custom.subarray(0, 8)], [0x51, 255, 0, 0, 0, 0, 0, 255]);
  // Empty slots: 00 01 02 03.
  assert.deepEqual([...custom.subarray(8, 12)], [0, 1, 2, 3]);
  assert.deepEqual([...custom.subarray(64, 69)], [0, 1, 0x3b, 0xff, 0x0f]);
  assert.equal(customFrame(PROTOCOLS.ADDRESSABLE_A2, [[1, 2, 3]], 50, 'jump'), null);
});

test('frame lengths and envelopes', () => {
  assert.equal(expectedLength(hex('81')), 14);
  assert.equal(expectedLength(hex('66')), 11);
  assert.equal(expectedLength(hex('0f 71')), 4);
  assert.equal(expectedLength(hex('b0 b1 b2 b3 00 01 01 0c 00 04')), 15);
  assert.equal(expectedLength(hex('b0 b1')), 10);
  assert.equal(expectedLength(hex('ea 81 01')), 27);
  assert.equal(expectedLength(hex('aa bb cc')), 3);
  const wrapped = wrap(withChecksum([0x81, 0x8a, 0x8b]), 7);
  assert.equal(bytes(unwrap(wrapped)), '818a8b96');
  assert.equal(bytes(unwrap(hex('81 8a 8b 96'))), '818a8b96');
});

test('client: frames split and glued by TCP are cut right', async () => {
  const socket = new EventEmitter();
  socket.setNoDelay = () => {};
  socket.setKeepAlive = () => {};
  socket.destroy = () => socket.emit('close');
  const client = new MagicHomeClient({
    host: '192.168.1.40',
    connect: () => {
      setImmediate(() => socket.emit('connect'));
      return socket;
    },
  });
  await client.open();
  const frames = [];
  client.on('frame', (frame) => frames.push(bytes(frame)));
  const state = '8125236121063805' + '06f90100' + '0f9d';
  const power = bytes(withChecksum([0x0f, 0x71, 0x23]));
  const wrapped = bytes(wrap(hex(state), 3));
  const stream = hex(state + power + wrapped);
  socket.emit('data', stream.subarray(0, 5));
  socket.emit('data', stream.subarray(5, 20));
  socket.emit('data', stream.subarray(20));
  assert.deepEqual(frames, [state, power, state]);
  client.close();
});

test('models: protocol by firmware version, colour modes by wiring', () => {
  const bulb = modelOf(0x35);
  assert.equal(protocolFor(bulb, 0x0b), PROTOCOLS.BYTE25);
  assert.equal(protocolFor(bulb, 0x09), PROTOCOLS.BYTE9_DIMMABLE);
  assert.equal(protocolFor(bulb, 0x08), PROTOCOLS.BYTE9_AUTO_ON);
  assert.equal(protocolFor(bulb, 0x02), PROTOCOLS.BYTE9);
  const controller = modelOf(0x25);
  assert.deepEqual(colorModesOf(controller, 0x01), ['DIM']);
  assert.deepEqual(colorModesOf(controller, 0x07), ['CCT', 'RGB']);
  assert.deepEqual(colorModesOf(modelOf(0x06), 0x16), ['DIM', 'RGB']);
  assert.deepEqual(colorModesOf(modelOf(0x06), 0x14), ['RGBW']);
  assert.deepEqual(colorModesOf(modelOf(0x07), 0x37), ['CCT', 'RGB']);
  assert.deepEqual(colorModesOf(modelOf(0x07), 0x95), ['RGBWW']);
  const unknown = modelOf(0x77, PROTOCOLS.BYTE8);
  assert.equal(unknown.known, false);
  assert.deepEqual(colorModesOf(unknown, 0x23), ['RGB']);
  assert.deepEqual(colorModesOf(unknown, 0x02), ['CCT']);
  assert.ok(MODEL_NUMS.length >= 40);
  assert.ok(modelOf(0x97).switch);
});

test('light: whites in the colour slots of the single-white and CCT models', () => {
  const raw = {
    format: 'standard',
    r: 200,
    g: 0,
    b: 0,
    ww: 0,
    cw: 0,
    mode: 0,
    pattern: 0x61,
    on: true,
    speed: 1,
  };
  assert.deepEqual(logical(raw, modelOf(0x21), PROTOCOLS.BYTE8), {
    r: 0,
    g: 0,
    b: 0,
    ww: 200,
    cw: 0,
  });
  const cct = { ...raw, r: 100, g: 50 };
  assert.deepEqual(logical(cct, modelOf(0x52), PROTOCOLS.BYTE8), {
    r: 0,
    g: 0,
    b: 0,
    ww: 100,
    cw: 50,
  });
  // CCT bulb: temperature 100 (cool), brightness 50.
  const bulb = { ...raw, r: 0, ww: 100, cw: 50 };
  assert.deepEqual(logical(bulb, modelOf(0x09), PROTOCOLS.CCT), {
    r: 0,
    g: 0,
    b: 0,
    ww: 0,
    cw: 128,
  });
  const view = describeState(raw, modelOf(0x21), PROTOCOLS.BYTE8);
  assert.equal(view.group, 'white');
  assert.equal(view.brightness, 200);
  assert.equal(view.kelvin, null);
});

test('light: what each command writes', () => {
  const raw = {
    format: 'standard',
    r: 0,
    g: 0,
    b: 0,
    ww: 255,
    cw: 0,
    mode: 0x01,
    pattern: 0x61,
    on: true,
    speed: 1,
  };
  const bulb = modelOf(0x35);
  const view = describeState(raw, bulb, PROTOCOLS.BYTE9);
  assert.equal(view.kelvin, 2700);
  // A colour keeps the brightness, writes the colours only.
  assert.deepEqual(plan(view, bulb, { color: [0, 0, 255] }), {
    levels: { r: 0, g: 0, b: 255, ww: 0, cw: 0 },
    mode: 'colors',
  });
  // A grey on an RGB/W bulb lights its white LEDs.
  const rgbw = modelOf(0x44);
  const rgbwView = describeState({ ...raw, ww: 0, r: 255 }, rgbw, PROTOCOLS.BYTE8);
  assert.deepEqual(plan(rgbwView, rgbw, { color: [255, 255, 255] }), {
    levels: { r: 0, g: 0, b: 0, ww: 255, cw: 0 },
    mode: 'whites',
  });
  // Temperature on a colour-only controller: impossible.
  const strip = modelOf(0x33);
  assert.equal(
    plan(describeState({ ...raw, r: 255, ww: 0 }, strip, PROTOCOLS.BYTE8), strip, { kelvin: 4000 }),
    null,
  );
  // Brightness of a white: same temperature.
  const half = plan(view, bulb, { brightness: 128 });
  assert.equal(whiteLevelsToTemperature(half.levels.ww, half.levels.cw).kelvin, 2700);
  // Both groups lit together (RGB&CCT controller): scaled together.
  const together = modelOf(0x07);
  const mixed = describeState({ ...raw, mode: 0x15, r: 200, ww: 100 }, together, PROTOCOLS.BYTE9);
  assert.equal(mixed.group, 'mixed');
  const scaled = plan(mixed, together, { brightness: mixed.brightness / 2 });
  assert.equal(scaled.mode, 'all');
  assert.deepEqual([scaled.levels.r, scaled.levels.ww], [100, 50]);
});

test('light: effects and what plays', () => {
  const raw = {
    format: 'standard',
    r: 0,
    g: 0,
    b: 0,
    ww: 0,
    cw: 0,
    mode: 0x01,
    pattern: 0x25,
    on: true,
    speed: 1,
  };
  const view = describeState(raw, modelOf(0x35), PROTOCOLS.BYTE9_DIMMABLE, {
    effectBrightness: 40,
  });
  assert.equal(view.mode, 'effect');
  assert.equal(view.effect, 'colorloop');
  assert.equal(view.brightness, 102);
  assert.equal(
    describeState({ ...raw, pattern: 0x60 }, modelOf(0x35), PROTOCOLS.BYTE9).mode,
    'custom',
  );
  assert.equal(
    describeState({ ...raw, pattern: 0x62 }, modelOf(0x35), PROTOCOLS.BYTE9).mode,
    'music',
  );
});

test('discovery answers and configured addresses', () => {
  assert.deepEqual(parseDiscoveryReply(Buffer.from('192.168.214.252,B4E842E10588,AK001-ZJ2145')), {
    host: '192.168.214.252',
    id: 'B4E842E10588',
    moduleModel: 'AK001-ZJ2145',
    legacy: false,
  });
  // The source address wins over the announced one.
  assert.equal(parseDiscoveryReply('10.0.0.5,ACCF23123456,HF-LPB100', '10.0.0.9').host, '10.0.0.9');
  assert.equal(parseDiscoveryReply('10.0.0.5,ACCF23123456,HF-LPB100').legacy, true);
  assert.equal(parseDiscoveryReply('HF-A11ASSISTHREAD'), null);
  assert.equal(parseDiscoveryReply('+ok=07_06_20210106_ZG-BL\r'), null);
  assert.deepEqual(parseHosts(' 192.168.1.40,192.168.1.41;192.168.1.40 300.1.1.1 host '), [
    '192.168.1.40',
    '192.168.1.41',
  ]);
});

test('discovery: refused or busy scans never throw', async () => {
  const refused = {
    scanNetwork: async () => Promise.reject(Object.assign(new Error('no'), { status: 403 })),
  };
  assert.deepEqual(await broadcastScan(refused), { devices: [], error: 'forbidden' });
  const busy = {
    scanNetwork: async () => Promise.reject(Object.assign(new Error('no'), { status: 429 })),
  };
  assert.deepEqual(await broadcastScan(busy), { devices: [], error: 'busy' });
  const twice = {
    scanNetwork: async () => [
      {
        source_ip: '192.168.1.40',
        payload_base64: Buffer.from('192.168.1.40,B4E842E10588,X').toString('base64'),
      },
      {
        source_ip: '192.168.1.40',
        payload_base64: Buffer.from('192.168.1.40,B4E842E10588,X').toString('base64'),
      },
      { source_ip: '192.168.1.41', payload_base64: Buffer.from('garbage').toString('base64') },
    ],
  };
  assert.equal((await broadcastScan(twice)).devices.length, 1);
});

test('colour arithmetic', () => {
  assert.deepEqual(hsvToRgb(2 / 3, 1, 1), [0, 0, 255]);
  const { h, s, v } = rgbToHsv(255, 128, 0);
  assert.deepEqual([Math.round(h * 360), s, v], [30, 1, 1]);
  assert.equal(kelvinToMired(6500), 154);
  assert.equal(kelvinToMired(2700), 370);
  assert.deepEqual(temperatureToWhiteLevels(2700, 255), [255, 0]);
  assert.deepEqual(temperatureToWhiteLevels(6500, 255), [0, 255]);
  assert.deepEqual(parseHexColor('#f00'), [255, 0, 0]);
  assert.deepEqual(parseHexColor('00FF7f'), [0, 255, 127]);
  assert.equal(parseHexColor('red'), null);
});

test('client: two frames are never written back to back', async () => {
  const socket = new EventEmitter();
  const writes = [];
  socket.setNoDelay = () => {};
  socket.setKeepAlive = () => {};
  socket.destroy = () => socket.emit('close');
  socket.write = (frame, callback) => {
    writes.push(Date.now());
    callback();
  };
  const client = new MagicHomeClient({
    host: '192.168.1.40',
    spacingMs: 40,
    connect: () => {
      setImmediate(() => socket.emit('connect'));
      return socket;
    },
  });
  await client.send(hex('71 23 0f a3'));
  await client.send(hex('71 24 0f a4'));
  assert.ok(writes[1] - writes[0] >= 35, `${writes[1] - writes[0]} ms`);
  client.close();
});
