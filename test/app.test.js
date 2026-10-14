// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`) and fake Magic Home devices
// (test/helpers.js): discovery, states, commands, pushed states, scene
// triggers and actions, widgets, address changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp } from '../src/app.js';
import { memoryStorage } from '../src/storage.js';
import { withChecksum } from '../src/magichome/protocol.js';
import {
  FakeBulb,
  FAST_TIMING,
  fakeNetwork,
  flush,
  lastCommand,
  silentLogger,
  sleep,
} from './helpers.js';

const CONFIG = { language: 'fr', hosts: '192.168.1.43' };
const MAC = { bulb: 'B4E842E10588', cct: 'B4E842E10599', socket: 'B4E842E105AA', strip: '' };
const id = (key) => `ext:test-integration:device:${key}`;
const BULB = id('b4e842e10588');
const CCT = id('b4e842e10599');
const SOCKET = id('b4e842e105aa');
const STRIP = id('ip-192-168-1-43');

const bulbs = () => [
  // RGBCW bulb, firmware 9: RGB or warm/cool, 9-byte levels, dimmable effects.
  new FakeBulb({ host: '192.168.1.40', mac: MAC.bulb, model: 0x35, version: 0x09, levels: '9' }),
  // High-voltage CCT bulb: temperature and brightness 0-100 in the white slots.
  new FakeBulb({
    host: '192.168.1.41',
    mac: MAC.cct,
    model: 0x09,
    version: 0x01,
    levels: 'cct',
    state: { ww: 50, cw: 80 },
  }),
  // Socket.
  new FakeBulb({
    host: '192.168.1.42',
    mac: MAC.socket,
    model: 0x97,
    version: 0x01,
    levels: '8',
    push: true,
  }),
];

/**
 * @description An integration wired to the fake Gladys and fake devices.
 * @param {object} [options] - `{ config, create, network }`.
 * @returns {Promise<object>} `{ gladys, fake, app, network }`.
 */
async function setup({
  config = CONFIG,
  create = true,
  network: given,
  storage = memoryStorage(),
} = {}) {
  const network = given ?? fakeNetwork(bulbs());
  if (!given) {
    // An RGB controller that never answers the UDP discovery, typed in the configuration.
    const strip = new FakeBulb({
      host: '192.168.1.43',
      mac: 'B4E842E105BB',
      model: 0x33,
      version: 0x0a,
      levels: '8',
      state: { r: 255, g: 128, b: 0, ww: 0 },
    });
    strip.udp = false;
    network.add(strip);
  }
  const gladys = createFakeGladys({ config: structuredClone(config) });
  gladys.fake.scanResults['udp-active-broadcast'] = network.scanReplies();
  const app = createApp(gladys, {
    storage,
    logger: silentLogger,
    connect: network.connect,
    probe: network.probe,
    timing: FAST_TIMING,
    confirmAfterMs: 5,
    offlineGraceMs: 30,
  });
  await gladys.connect();
  await app.start();
  if (create) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(structuredClone(device));
    }
    await app.flushStates();
  }
  return { gladys, fake: gladys.fake, app, network, storage };
}

const ok = (ack) => {
  assert.equal(ack.success, true, ack.error);
  return ack.data;
};
const deviceOf = (fake, externalId) =>
  structuredClone(fake.discoveredDevices.find((device) => device.external_id === externalId));
const featureOf = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`));
const last = (fake, externalId, key) => fake.lastState(`${externalId}:${key}`);

test('discovery: devices found by broadcast and by address, with their features', async () => {
  const { fake, app } = await setup({ create: false });
  const scans = fake.scans.filter((scan) => scan.type === 'udp-active-broadcast');
  assert.ok(scans.length >= 1);
  assert.equal(scans[0].port, 48899);
  assert.equal(Buffer.from(scans[0].payload_base64, 'base64').toString(), 'HF-A11ASSISTHREAD');

  const ids = fake.discoveredDevices.map((device) => device.external_id).sort();
  assert.deepEqual(ids, [BULB, CCT, SOCKET, STRIP].sort());

  const bulb = deviceOf(fake, BULB);
  assert.equal(bulb.name, 'Magic Home Bulb RGBCW 0588');
  assert.equal(bulb.should_poll, false);
  assert.deepEqual(
    bulb.features.map((feature) => [feature.category, feature.type]),
    [
      ['light', 'binary'],
      ['light', 'brightness'],
      ['light', 'color'],
      ['light', 'temperature'],
    ],
  );
  assert.equal(featureOf(bulb, 'power').name, 'Magic Home Bulb RGBCW 0588 - Marche/arrêt');
  assert.deepEqual(
    [featureOf(bulb, 'temperature').min, featureOf(bulb, 'temperature').max],
    [154, 370],
  );
  assert.deepEqual(
    bulb.params.find((param) => param.name === 'MAGICHOME_MAC'),
    { name: 'MAGICHOME_MAC', value: 'B4:E8:42:E1:05:88' },
  );

  const cct = deviceOf(fake, CCT);
  assert.deepEqual(
    cct.features.map((feature) => feature.type),
    ['binary', 'brightness', 'temperature'],
  );
  const socket = deviceOf(fake, SOCKET);
  assert.deepEqual(
    socket.features.map((feature) => [feature.category, feature.type]),
    [['switch', 'binary']],
  );
  const strip = deviceOf(fake, STRIP);
  assert.deepEqual(
    strip.features.map((feature) => feature.type),
    ['binary', 'brightness', 'color'],
  );
  assert.equal(fake.connectionStatus.connected, true);
  await app.stop();
});

test('states: published once the device is created, mired and percent', async () => {
  const { fake, app } = await setup();
  assert.equal(last(fake, BULB, 'power'), 1);
  // Warm white only at 255: 2700 K = 370 mired, 100 %.
  assert.equal(last(fake, BULB, 'temperature'), 370);
  assert.equal(last(fake, BULB, 'brightness'), 100);
  assert.equal(last(fake, BULB, 'color'), undefined);
  // CCT bulb: temperature 50 %, brightness 80 %.
  assert.equal(last(fake, CCT, 'brightness'), 80);
  assert.equal(last(fake, CCT, 'temperature'), Math.round(1e6 / 4600));
  // RGB controller: orange at full value.
  assert.equal(last(fake, STRIP, 'color'), 0xff8000);
  assert.equal(last(fake, STRIP, 'brightness'), 100);
  assert.equal(last(fake, SOCKET, 'power'), 1);
  assert.ok(
    fake.transports.some(
      (entry) => entry.device_external_id === BULB && entry.transport === 'local',
    ),
  );
  await app.stop();
});

test('devices not created: no state published, no connection kept', async () => {
  const { fake, app, network } = await setup({ create: false });
  await app.flushStates();
  assert.equal(fake.states.length, 0);
  // A device has few connection slots: they are freed after the search.
  assert.equal(network.open.size, 0);
  await app.poll();
  assert.equal(network.open.size, 0, 'never polled');
  await app.stop();
});

test('commands: power, colour, temperature, brightness reach the device', async () => {
  const { fake, app, network } = await setup();
  const bulb = deviceOf(fake, BULB);
  const device = network.bulbs.get('192.168.1.40');

  ok(await fake.setValue(bulb, featureOf(bulb, 'power'), 0));
  assert.equal(device.state.on, false);
  assert.ok(device.received.includes(withChecksum([0x71, 0x24, 0x0f]).toString('hex')));

  // A colour on a bulb that is off: powered on first (9-byte protocol needs it).
  ok(await fake.setValue(bulb, featureOf(bulb, 'color'), 0xff0000));
  assert.equal(device.state.on, true);
  assert.deepEqual([device.state.r, device.state.g, device.state.b], [255, 0, 0]);
  assert.ok(
    device.received.includes(withChecksum([0x31, 0xff, 0, 0, 0, 0, 0xf0, 0x0f]).toString('hex')),
  );

  ok(await fake.setValue(bulb, featureOf(bulb, 'brightness'), 50));
  assert.deepEqual([device.state.r, device.state.g, device.state.b], [128, 0, 0]);

  // 250 mired = 4000 K, at the current brightness: whites only (0x0f).
  ok(await fake.setValue(bulb, featureOf(bulb, 'temperature'), 250));
  assert.deepEqual([device.state.r, device.state.g, device.state.b], [0, 0, 0]);
  assert.ok(device.state.ww > 0 && device.state.cw > 0);
  assert.equal(lastCommand(device).slice(-4, -2), '0f');

  await app.flushStates();
  assert.equal(last(fake, BULB, 'power'), 1);
  assert.equal(last(fake, BULB, 'temperature'), 250);

  const cct = deviceOf(fake, CCT);
  ok(await fake.setValue(cct, featureOf(cct, 'temperature'), 154));
  const cctDevice = network.bulbs.get('192.168.1.41');
  // 6500 K: temperature 100 (cool), brightness kept at 80.
  assert.deepEqual([cctDevice.state.ww, cctDevice.state.cw], [100, 80]);

  ok(await fake.setValue(bulb, featureOf(bulb, 'brightness'), 0));
  assert.equal(device.state.on, false);
  await app.stop();
});

test('commands: an error says why, in the configured language', async () => {
  const { fake, app, network } = await setup();
  network.bulbs.get('192.168.1.40').unplugged = true;
  network.socketOf('192.168.1.40')?.destroy();
  await flush();
  const bulb = deviceOf(fake, BULB);
  const ack = await fake.setValue(bulb, featureOf(bulb, 'power'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /ne répond pas/);
  await app.stop();
});

test('a state pushed by the device (remote control) reaches Gladys', async () => {
  const { fake, app, network } = await setup();
  const device = network.bulbs.get('192.168.1.42');
  device.state.on = false;
  network.socketOf('192.168.1.42').push(device.stateFrame());
  await flush();
  await app.flushStates();
  assert.equal(last(fake, SOCKET, 'power'), 0);
  await app.stop();
});

test('scene actions: effect, custom colours, flash then restore, stop', async () => {
  const { fake, app, network } = await setup();
  const device = network.bulbs.get('192.168.1.40');

  ok(
    await fake.sceneAction('start_effect', {
      device: BULB,
      effect: 'colorloop',
      speed: 100,
      brightness: 60,
    }),
  );
  // Dimmable effects firmware: 38 <pattern> <delay> <brightness>.
  assert.equal(lastCommand(device), withChecksum([0x38, 0x25, 0x01, 60]).toString('hex'));
  assert.equal(device.state.pattern, 0x25);

  const custom = ok(
    await fake.sceneAction('custom_effect', {
      device: BULB,
      colors: '#FF0000, 00ff00',
      transition: 'strobe',
      speed: 50,
    }),
  );
  assert.equal(custom, undefined);
  const frame = Buffer.from(lastCommand(device), 'hex');
  assert.equal(frame[0], 0x51);
  assert.deepEqual([...frame.subarray(1, 4)], [255, 0, 0]);
  assert.deepEqual([...frame.subarray(5, 8)], [0, 255, 0]);
  assert.equal(frame[frame.length - 4], 0x3c);

  const bad = await fake.sceneAction('custom_effect', { device: BULB, colors: '#FF0000, blue' });
  assert.equal(bad.success, false);
  assert.match(bad.error, /blue/);

  ok(await fake.sceneAction('stop_effect', { device: BULB }));
  assert.equal(device.state.pattern, 0x61);
  // Back to the warm white seen at the start.
  assert.equal(device.state.ww, 255);

  ok(await fake.sceneAction('flash', { device: BULB, color: '#0000FF', duration_seconds: 1 }));
  assert.equal(device.state.pattern, 0x60);
  await sleep(1100);
  await sleep(20);
  assert.equal(device.state.pattern, 0x61);
  assert.equal(device.state.ww, 255);

  const socket = await fake.sceneAction('start_effect', { device: SOCKET, effect: 'colorloop' });
  assert.equal(socket.success, false);
  assert.match(socket.error, /ne sait pas faire/);
  const unknown = await fake.sceneAction('start_effect', { device: BULB, effect: 'disco' });
  assert.equal(unknown.success, false);
  await app.stop();
});

test('scene triggers: offline after the grace delay, online when it answers again', async () => {
  const { fake, app, network } = await setup();
  const device = network.bulbs.get('192.168.1.40');
  device.unplugged = true;
  network.socketOf('192.168.1.40')?.destroy();
  await app.poll();
  await app.poll();
  await sleep(50);
  const offline = fake.sceneEvents.filter((event) => event.key === 'light_offline');
  assert.equal(offline.length, 1);
  assert.deepEqual(offline[0].data, {
    device: BULB,
    device_name: 'Magic Home Bulb RGBCW 0588',
    ip: '192.168.1.40',
  });
  assert.ok(
    fake.transports.some(
      (entry) => entry.device_external_id === BULB && entry.transport === 'unreachable',
    ),
  );
  assert.match(fake.connectionStatus.message.fr, /ne répondent pas/);

  device.unplugged = false;
  await app.poll();
  const online = fake.sceneEvents.filter((event) => event.key === 'light_online');
  assert.equal(online.length, 1);
  assert.equal(fake.sceneEvents.filter((event) => event.key === 'light_offline').length, 1);
  await app.stop();
});

test('a device already silent at start fires nothing', async () => {
  const network = fakeNetwork(bulbs());
  network.bulbs.get('192.168.1.40').unplugged = true;
  const storage = memoryStorage();
  const first = await setup({ storage });
  await first.app.stop();
  const gladys = createFakeGladys({
    config: CONFIG,
    devices: structuredClone(first.fake.discoveredDevices),
  });
  gladys.fake.scanResults['udp-active-broadcast'] = network.scanReplies();
  const app = createApp(gladys, {
    storage,
    logger: silentLogger,
    connect: network.connect,
    probe: network.probe,
    timing: FAST_TIMING,
    offlineGraceMs: 10,
  });
  await gladys.connect();
  await app.start();
  await app.poll();
  await sleep(30);
  assert.equal(gladys.fake.sceneEvents.length, 0);
  assert.ok(
    gladys.fake.transports.some(
      (entry) => entry.device_external_id === BULB && entry.transport === 'unreachable',
    ),
  );
  await app.stop();
});

test('a short outage fires nothing', async () => {
  const { fake, app, network } = await setup();
  const device = network.bulbs.get('192.168.1.40');
  device.unplugged = true;
  network.socketOf('192.168.1.40')?.destroy();
  await app.poll();
  await app.poll();
  device.unplugged = false;
  await app.poll();
  await sleep(50);
  assert.equal(fake.sceneEvents.length, 0);
  await app.stop();
});

test('a device whose address changed is found again by its MAC', async () => {
  const { fake, app, network } = await setup();
  const device = network.bulbs.get('192.168.1.40');
  network.bulbs.delete('192.168.1.40');
  device.host = '192.168.1.60';
  network.add(device);
  fake.scanResults['udp-active-broadcast'] = network.scanReplies();
  await fake.scanRequest();
  const ids = fake.discoveredDevices.map((entry) => entry.external_id);
  assert.equal(ids.filter((value) => value === BULB).length, 1);
  assert.equal(
    deviceOf(fake, BULB).params.find((param) => param.name === 'MAGICHOME_HOST').value,
    '192.168.1.60',
  );
  const bulb = deviceOf(fake, BULB);
  ok(await fake.setValue(bulb, featureOf(bulb, 'power'), 0));
  assert.equal(device.state.on, false);
  await app.stop();
});

test('a restart reconnects the known devices before any scan answers', async () => {
  const storage = memoryStorage();
  const first = await setup({ storage });
  await first.app.stop();
  assert.ok(storage.files['devices.json'][MAC.bulb.toLowerCase()]);

  const network = fakeNetwork(bulbs());
  const gladys = createFakeGladys({
    config: CONFIG,
    devices: structuredClone(first.fake.discoveredDevices),
  });
  // The broadcast finds nothing this time.
  gladys.fake.scanResults['udp-active-broadcast'] = [];
  const app = createApp(gladys, {
    storage,
    logger: silentLogger,
    connect: network.connect,
    probe: async () => null,
    timing: FAST_TIMING,
  });
  await gladys.connect();
  await app.start();
  await app.flushStates();
  assert.equal(gladys.fake.lastState(`${BULB}:power`), 1);
  assert.ok(gladys.fake.discoveredDevices.some((device) => device.external_id === BULB));
  await app.stop();
});

test('configuration button: lists the devices found', async () => {
  const { fake, app } = await setup();
  const message = ok(await fake.action('test_connection')).message;
  assert.match(message.fr, /^4 appareil\(s\) trouvé\(s\)/);
  assert.match(message.en, /192\.168\.1\.40, 0x35/);
  await app.stop();
});

test('widgets: valid contents, all off, effect buttons', async () => {
  const { fake, app, network } = await setup();
  const overview = ok(await fake.widgetGet('lights', { settings: {}, language: 'fr' })).content;
  assert.deepEqual(validateWidgetContent(overview), []);
  const list = overview.components.find((component) => component.type === 'card-list');
  assert.equal(list.items.length, 4);
  assert.match(
    list.items.find((item) => item.title.includes('0588')).subtitle.fr,
    /^100 % · Blanc$/,
  );

  const light = ok(
    await fake.widgetGet('light', {
      settings: { device: BULB, effect_1: 'red_strobe' },
      language: 'fr',
    }),
  ).content;
  assert.deepEqual(validateWidgetContent(light), []);
  const buttons = light.components.filter((component) => component.type === 'button');
  assert.deepEqual(
    buttons.map((button) => button.action.key),
    ['power_off', 'effect_1', 'effect_2', 'effect_3'],
  );
  assert.equal(buttons[1].label.fr, 'Stroboscope rouge');

  const toast = ok(
    await fake.widgetAction('light', 'effect_1', buttons[1].action.params, {
      settings: { device: BULB, speed: 0 },
    }),
  );
  assert.equal(toast.message.fr, 'Stroboscope rouge lancé.');
  assert.equal(network.bulbs.get('192.168.1.40').state.pattern, 0x31);

  const playing = ok(
    await fake.widgetGet('light', { settings: { device: BULB }, language: 'fr' }),
  ).content;
  assert.equal(
    playing.components.filter((component) => component.type === 'button').at(-1).action.key,
    'stop_effect',
  );

  const socketWidget = ok(
    await fake.widgetGet('light', { settings: { device: SOCKET }, language: 'fr' }),
  ).content;
  assert.deepEqual(validateWidgetContent(socketWidget), []);

  const off = ok(await fake.widgetAction('lights', 'all_off', {}, { settings: {} }));
  assert.equal(off.message.fr, '4 appareil(s) éteint(s).');
  assert.ok([...network.bulbs.values()].every((bulb) => !bulb.state.on));

  const none = ok(await fake.widgetGet('light', { settings: {}, language: 'fr' })).content;
  assert.deepEqual(validateWidgetContent(none), []);
  await app.stop();
});

test('legacy controller (original protocol, no checksum)', async () => {
  const network = fakeNetwork([
    new FakeBulb({
      host: '192.168.1.50',
      mac: 'ACCF23000001',
      model: 0x01,
      original: true,
      state: { r: 0, g: 0, b: 255, ww: 0 },
    }),
  ]);
  const { fake, app } = await setup({ network, config: { language: 'en' } });
  const legacy = id('accf23000001');
  assert.equal(last(fake, legacy, 'color'), 0x0000ff);
  const device = deviceOf(fake, legacy);
  ok(await fake.setValue(device, featureOf(device, 'color'), 0x00ff00));
  const bulb = network.bulbs.get('192.168.1.50');
  assert.equal(lastCommand(bulb), '5600ff00aa');
  ok(await fake.setValue(device, featureOf(device, 'power'), 0));
  assert.equal(bulb.state.on, false);
  await app.stop();
});

test('25-byte firmware: HSV levels in the version 2 envelope', async () => {
  const network = fakeNetwork([
    new FakeBulb({
      host: '192.168.1.51',
      mac: 'B4E842000025',
      model: 0x35,
      version: 0x0a,
      levels: '25',
    }),
  ]);
  const { fake, app } = await setup({ network, config: { language: 'en' } });
  const device = deviceOf(fake, id('b4e842000025'));
  ok(await fake.setValue(device, featureOf(device, 'color'), 0x0000ff));
  const bulb = network.bulbs.get('192.168.1.51');
  const frame = Buffer.from(lastCommand(bulb), 'hex');
  assert.deepEqual([...frame.subarray(0, 7)], [0xb0, 0xb1, 0xb2, 0xb3, 0x00, 0x01, 0x02]);
  // e0 01 00 a1 <hue/2=120> <sat 100> <val 100>
  assert.deepEqual([...frame.subarray(10, 17)], [0xe0, 0x01, 0x00, 0xa1, 120, 100, 100]);
  assert.deepEqual([bulb.state.r, bulb.state.g, bulb.state.b], [0, 0, 255]);
  await app.stop();
});
