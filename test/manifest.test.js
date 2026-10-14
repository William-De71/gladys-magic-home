// The manifest and the code agree: every declared action, trigger, widget and
// configuration key has its code, every version says the same thing, and the
// manifest respects what the store and the Gladys core expect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ACTIONS } from '../src/app.js';
import { DEFAULTS, LANGUAGES, POLL_INTERVALS, RESCAN_INTERVALS } from '../src/config.js';
import { DISCOVERY_PORT, EFFECTS, TRANSITIONS } from '../src/magichome/constants.js';
import { SCENE_ACTIONS, TRIGGERS } from '../src/scenes.js';
import { DEFAULT_EFFECTS, EFFECT_SETTINGS, WIDGETS } from '../src/widgets.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const byKey = (list) => Object.fromEntries(list.map((item) => [item.key, item]));

test('one version everywhere, image of this repository', () => {
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-magic-home:${pkg.version}`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/William-De71\/gladys-magic-home\/main\/cover\.jpg$/,
  );
});

test('store rules: type, Gladys version, transports, categories, permissions', () => {
  assert.equal(manifest.type, 'device');
  // widgets and scene_* need 5.1.0; 5.1.1 fixes the widget card dates.
  assert.equal(manifest.gladys_version, '>=5.1.1');
  // Everything stays on the local network: no cloud channel.
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['lighting']);
  assert.equal(manifest.name, 'Magic Home');
  // Only the mediated discovery, on the port of the protocol.
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-active-broadcast', ports: [DISCOVERY_PORT] },
  ]);
  for (const key of ['location', 'network_wake', 'containers', 'webhooks']) {
    assert.equal(manifest[key], undefined, key);
  }
});

test('configuration: keys, defaults and choices of the code', () => {
  const fields = byKey(manifest.config_schema);
  const values = (field) => field.options.map((option) => option.value);
  assert.deepEqual(values(fields.language), LANGUAGES);
  assert.deepEqual(values(fields.poll_interval), POLL_INTERVALS.map(String));
  assert.deepEqual(values(fields.rescan_interval), RESCAN_INTERVALS.map(String));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  // `text` / `password` are refused by the store; no secret is needed.
  for (const field of manifest.config_schema) {
    assert.ok(['string', 'select', 'section'].includes(field.type), field.key);
  }
  assert.equal(fields.GLADYS_PREFER_LOCAL, undefined, 'one transport: no local preference');
});

test('configuration buttons: the keys of the code', () => {
  assert.deepEqual(
    manifest.actions.map((action) => action.key).sort(),
    Object.values(ACTIONS).sort(),
  );
});

test('scene triggers: the keys the code fires, their filters in the event data', () => {
  const triggers = byKey(manifest.scene_triggers);
  assert.deepEqual(Object.keys(triggers).sort(), Object.values(TRIGGERS).sort());
  for (const trigger of manifest.scene_triggers) {
    assert.deepEqual(
      trigger.variables.map((variable) => variable.key),
      ['device_name', 'ip'],
    );
    // The device filter compares with the `device` key of the event data.
    assert.deepEqual(
      trigger.fields.map((field) => [field.key, field.source, field.required]),
      [['device', 'devices', undefined]],
    );
  }
});

test('scene actions: keys, fields and options of the code', () => {
  const actions = byKey(manifest.scene_actions);
  assert.deepEqual(Object.keys(actions).sort(), Object.values(SCENE_ACTIONS).sort());
  const effectOptions = (field) => field.options.map((option) => option.value).sort();
  const effectField = actions.start_effect.fields.find((field) => field.key === 'effect');
  assert.deepEqual(effectOptions(effectField), Object.keys(EFFECTS).sort());
  assert.deepEqual(
    actions.custom_effect.fields
      .find((field) => field.key === 'transition')
      .options.map((o) => o.value),
    Object.keys(TRANSITIONS),
  );
  for (const action of manifest.scene_actions) {
    const device = action.fields.find((field) => field.key === 'device');
    assert.equal(device.source, 'devices');
    assert.equal(device.required, true);
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
    assert.equal(action.outputs, undefined, 'no output: nothing to give the next actions');
  }
});

test('widgets: the keys of the code, settings without secrets', () => {
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  const widgets = byKey(manifest.widgets);
  const light = byKey(widgets.light.settings);
  assert.equal(light.device.source, 'devices');
  for (const key of EFFECT_SETTINGS) {
    assert.equal(light[key].default, DEFAULT_EFFECTS[key]);
    assert.deepEqual(
      light[key].options.map((option) => option.value).sort(),
      Object.keys(EFFECTS).sort(),
    );
  }
  assert.deepEqual(
    widgets.lights.settings[0].options.map((option) => option.value),
    ['all', 'on'],
  );
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
});

test('effect labels: the same words in the manifest and at runtime', async () => {
  const { effectName } = await import('../src/i18n.js');
  const effectField = byKey(manifest.scene_actions).start_effect.fields.find(
    (field) => field.key === 'effect',
  );
  for (const option of effectField.options) {
    assert.deepEqual(option.label, effectName(option.value), option.value);
  }
});
