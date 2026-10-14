// Magic Home models -> Gladys devices, model by model. The Discover tab
// pitfalls of the Gladys core are checked here: a single invalid feature makes
// the whole discovery list refused, a missing min / max / read_only /
// has_feedback only fails when the user clicks "Add", and a category/type pair
// the front does not label shows "Device (undefined)".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';

import { normalizeConfig } from '../src/config.js';
import {
  buildDevice,
  deviceName,
  featureValues,
  learnDevice,
  platformId,
  runCommand,
} from '../src/devices.js';
import { MagicHomeDevice } from '../src/magichome/device.js';
import { modelOf, MODEL_NUMS, protocolFor } from '../src/magichome/models.js';
import { createStatePublisher } from '../src/states.js';
import { fakeClock, silentLogger } from './helpers.js';

// Category / type pairs labeled by the Gladys front (deviceFeatureCategory in
// front/src/config/i18n/en.json, checked on v5.1.1 and v5.2.1).
const LABELED_PAIRS = new Set([
  'light/binary',
  'light/brightness',
  'light/color',
  'light/temperature',
  'switch/binary',
]);

// One representative wiring per model (the mode byte of its state).
const MODE_BYTES = { 0x06: 0x14, 0x07: 0x17, 0x08: 0x23, 0x25: 0x05, 0x33: 0x23 };

/** A device of a model, identified without any connection, and its entry. */
function sample(num, version = 0x01) {
  const id = `b4e842${num.toString(16).padStart(6, '0')}`;
  const device = new MagicHomeDevice({ id, host: '192.168.1.40', connect: () => null });
  device.model = modelOf(num);
  device.protocol = protocolFor(device.model, version);
  device.applyState({
    format: 'standard',
    model: num,
    version,
    on: true,
    pattern: 0x61,
    mode: MODE_BYTES[num] ?? 0x01,
    speed: 1,
    r: 0,
    g: 0,
    b: 0,
    ww: 200,
    cw: 0,
  });
  const entry = { id, host: '192.168.1.40', mac: '', featureKeys: new Set() };
  learnDevice(entry, device);
  return { device, entry };
}

const ALL = [...MODEL_NUMS, 0x77];

test('every feature of every model: labeled pair, bounds, read_only, has_feedback, unit', () => {
  const gladys = createFakeGladys();
  const units = new Set(Object.values(DEVICE_FEATURE_UNITS));
  for (const num of ALL) {
    const { entry } = sample(num);
    const device = buildDevice(gladys, entry, 'en');
    assert.equal(device.should_poll, false, 'the integration polls the devices itself');
    assert.equal(device.poll_frequency, undefined);
    assert.ok(device.features.length >= 1);
    for (const feature of device.features) {
      const where = `0x${num.toString(16)} ${feature.external_id}`;
      assert.ok(LABELED_PAIRS.has(`${feature.category}/${feature.type}`), where);
      for (const field of ['min', 'max', 'read_only', 'has_feedback']) {
        assert.notEqual(feature[field], undefined, `${where} ${field}`);
      }
      assert.ok(feature.min < feature.max, where);
      assert.equal(feature.read_only, false, where);
      if (feature.unit !== undefined) {
        assert.ok(units.has(feature.unit), where);
      }
      assert.match(feature.name, /^Magic Home .+ - .+$/);
    }
  }
});

test('features by kind of device', () => {
  const gladys = createFakeGladys();
  const types = (num) =>
    buildDevice(gladys, sample(num).entry, 'en').features.map((feature) =>
      feature.external_id.split(':').pop(),
    );
  assert.deepEqual(types(0x35), ['power', 'brightness', 'color', 'temperature']);
  assert.deepEqual(types(0x33), ['power', 'brightness', 'color']);
  assert.deepEqual(types(0x21), ['power', 'brightness']);
  assert.deepEqual(types(0x09), ['power', 'brightness', 'temperature']);
  assert.deepEqual(types(0x07), ['power', 'brightness', 'color', 'temperature']);
  assert.deepEqual(types(0x44), ['power', 'brightness', 'color']);
  assert.deepEqual(types(0x97), ['power']);
  assert.equal(buildDevice(gladys, sample(0x97).entry, 'en').features[0].category, 'switch');
  assert.deepEqual(types(0x18), ['power'], 'a plant grow light only switches');
});

test('the whole discovery list is accepted by the fake Gladys, in every language', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  for (const language of ['en', 'fr', 'de', 'es']) {
    const devices = ALL.map((num) => buildDevice(gladys, sample(num).entry, language));
    const result = await gladys.publishDiscoveredDevices(devices);
    assert.equal(result.count, devices.length);
  }
});

test('discovery baseline (0.1.0): external ids and compared fields never change', () => {
  // Changing a feature key, category, type, unit, min, max or step forces
  // users to delete and recreate their devices: update the baseline only on
  // purpose (UPDATE_BASELINE=1 npm test), with a migration note in the docs.
  const file = new URL('./fixtures/discovery.baseline.json', import.meta.url);
  const gladys = createFakeGladys();
  const current = Object.fromEntries(
    ALL.map((num) => [
      `0x${num.toString(16).padStart(2, '0')}`,
      buildDevice(gladys, sample(num).entry, 'en').features.map((feature) => ({
        external_id: feature.external_id,
        category: feature.category,
        type: feature.type,
        unit: feature.unit ?? null,
        min: feature.min,
        max: feature.max,
        step: feature.step ?? null,
        read_only: feature.read_only,
      })),
    ]),
  );
  if (process.env.UPDATE_BASELINE) {
    writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  }
  assert.deepEqual(current, JSON.parse(readFileSync(file, 'utf8')));
});

test('capabilities only grow: a rewired controller keeps its features', () => {
  const { device, entry } = sample(0x25);
  assert.deepEqual(entry.caps, { color: true, temperature: true, white: false });
  // Rewired to a single white channel in the app.
  device.applyState({ ...device.raw, mode: 0x01 });
  learnDevice(entry, device);
  assert.deepEqual(entry.caps, { color: true, temperature: true, white: true });
});

test('ids and names', () => {
  assert.equal(platformId('B4:E8:42:E1:05:88', '192.168.1.40'), 'b4e842e10588');
  assert.equal(platformId('', '192.168.100.200'), 'ip-192-168-100-200');
  assert.equal(
    deviceName({ description: 'Bulb RGBCW', id: 'b4e842e10588' }),
    'Magic Home Bulb RGBCW 0588',
  );
  const gladys = createFakeGladys();
  const { entry } = sample(0x33);
  assert.equal(
    buildDevice(gladys, entry, 'de').features[1].name,
    'Magic Home Controller RGB 0033 - Helligkeit',
  );
  // An unknown model is named after its Wi-Fi module.
  const unknown = sample(0x77).entry;
  assert.equal(unknown.description, 'Unknown Model');
});

test('values: percent, colour at full value, mired', () => {
  const { device, entry } = sample(0x35);
  device.applyState({ ...device.raw, r: 128, g: 0, b: 0, ww: 0 });
  assert.deepEqual(featureValues(entry, device.view), [
    ['power', 1],
    ['brightness', 50],
    ['color', 0xff0000],
  ]);
  device.applyState({ ...device.raw, r: 0, ww: 0, cw: 255 });
  assert.deepEqual(featureValues(entry, device.view), [
    ['power', 1],
    ['brightness', 100],
    ['temperature', 154],
  ]);
});

test('commands: invalid values are refused before reaching the device', () => {
  const { device } = sample(0x35);
  assert.throws(() => runCommand(device, 'color', 'red'), RangeError);
  assert.throws(() => runCommand(device, 'speed', 1), RangeError);
});

test('configuration: defaults and bounds', () => {
  assert.deepEqual(normalizeConfig({}), {
    hosts: [],
    pollMs: 30000,
    rescanMs: 3600000,
    language: 'en',
  });
  const config = normalizeConfig({
    hosts: '192.168.1.40, 192.168.1.41',
    poll_interval: '10',
    rescan_interval: '0',
    language: 'es',
  });
  assert.deepEqual(config.hosts, ['192.168.1.40', '192.168.1.41']);
  assert.equal(config.pollMs, 10000);
  assert.equal(config.rescanMs, 0);
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollMs, 30000);
});

test('state publication: coalesced, only created devices, paused on a 429', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const clock = fakeClock();
  const device = 'ext:test-integration:device:a1';
  const created = new Set([device]);
  const states = createStatePublisher(gladys, {
    logger: silentLogger,
    now: clock.now,
    isCreated: (id) => created.has(id),
  });
  states.push(`${device}:brightness`, 20);
  states.push(`${device}:brightness`, 19);
  states.push(`${device}:power`, 1);
  states.push('ext:test-integration:device:a2:power', 1);
  assert.equal(states.pendingCount(), 2, 'newest value only, created devices only');
  assert.equal(await states.flush(), 2);
  assert.equal(gladys.fake.lastState(`${device}:brightness`), 19);

  const original = gladys.publishChangedStates.bind(gladys);
  gladys.publishChangedStates = async () => {
    const error = new Error('Too many requests');
    error.status = 429;
    throw error;
  };
  states.push(`${device}:brightness`, 18);
  assert.equal(await states.flush(), 0);
  gladys.publishChangedStates = original;
  assert.equal(await states.flush(), 0, 'paused');
  clock.advance(31000);
  assert.equal(await states.flush(), 1, 'sent after the pause');

  created.add('ext:test-integration:device:a2');
  states.republish('ext:test-integration:device:a2');
  assert.equal(await states.flush(), 1, 'the value known before the creation');
  states.stop();
});
