// -----------------------------------------------------------------------------
// Gladys side of a device: the device published in the Discover tab, the
// values of its features, and what a command on a feature does.
//
//   light   power (light/binary), brightness (light/brightness, %), colour
//           (light/color) when it has colour LEDs, colour temperature
//           (light/temperature, MIRED) when it has warm + cool whites
//   switch  power (switch/binary): sockets and relays
//
// The features of a light come from the colour modes the device reports when
// it is discovered (its wiring, for the configurable controllers): they are
// fixed once the user creates the device (the Discover "Update" compares
// them), so the capabilities never shrink afterwards (`entry.featureKeys`).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { intToRgb, kelvinToMired, MAX_MIRED, MIN_MIRED, miredToKelvin } from './magichome/color.js';
import { featureName } from './i18n.js';

export const FEATURE_KEYS = {
  POWER: 'power',
  BRIGHTNESS: 'brightness',
  COLOR: 'color',
  TEMPERATURE: 'temperature',
};

const FEATURES = {
  [FEATURE_KEYS.POWER]: (kind) => ({
    category: kind === 'switch' ? CATEGORIES.SWITCH : CATEGORIES.LIGHT,
    type: kind === 'switch' ? TYPES.SWITCH.BINARY : TYPES.LIGHT.BINARY,
    min: 0,
    max: 1,
  }),
  [FEATURE_KEYS.BRIGHTNESS]: () => ({
    category: CATEGORIES.LIGHT,
    type: TYPES.LIGHT.BRIGHTNESS,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
  }),
  [FEATURE_KEYS.COLOR]: () => ({
    category: CATEGORIES.LIGHT,
    type: TYPES.LIGHT.COLOR,
    min: 0,
    max: 0xffffff,
  }),
  // MIRED, no unit: the scale of the Gladys slider (warm on the right), like
  // the Hue and Tasmota services of the core.
  [FEATURE_KEYS.TEMPERATURE]: () => ({
    category: CATEGORIES.LIGHT,
    type: TYPES.LIGHT.TEMPERATURE,
    min: MIN_MIRED,
    max: MAX_MIRED,
  }),
};

/**
 * @description The platform id of a device: its MAC address, or its address
 * when it was typed in the configuration and never answered the discovery.
 * @param {string} mac - MAC address (any format) or empty.
 * @param {string} host - IP address.
 * @returns {string} `b4e842e10588` or `ip-192-168-1-20`.
 */
export function platformId(mac, host) {
  const id = String(mac ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  return id.length === 12 ? id : `ip-${String(host).replace(/\./g, '-')}`;
}

/**
 * @description The feature keys of a device entry.
 * @param {object} entry - `{ kind, caps, featureKeys }`.
 * @returns {string[]} Keys, in display order.
 */
export function featureKeysOf(entry) {
  const keys = new Set(entry.featureKeys ?? []);
  keys.add(FEATURE_KEYS.POWER);
  if (entry.kind === 'light') {
    if (entry.dimmable !== false) {
      keys.add(FEATURE_KEYS.BRIGHTNESS);
    }
    if (entry.caps?.color) {
      keys.add(FEATURE_KEYS.COLOR);
    }
    if (entry.caps?.temperature) {
      keys.add(FEATURE_KEYS.TEMPERATURE);
    }
  }
  return Object.values(FEATURE_KEYS).filter((key) => keys.has(key));
}

/**
 * @description Default name of a device: the model and the end of the MAC
 * address, which tells two identical bulbs apart (the dashboard shows the
 * device name when a feature is alone of its type).
 * @param {object} entry - `{ description, id }`.
 * @returns {string} `Magic Home Bulb RGBCW 0588`.
 */
export const deviceName = (entry) =>
  `Magic Home ${entry.description} ${entry.id.slice(-4).toUpperCase()}`.replace(/\s+/g, ' ').trim();

/**
 * @description Learn what a device is, once identified. Capabilities only
 * grow: a controller rewired in the app keeps the features of its device.
 * @param {object} entry - Device entry (app.js), updated in place.
 * @param {object} device - MagicHomeDevice, identified.
 * @returns {boolean} True when something changed (to save it).
 */
export function learnDevice(entry, device) {
  if (!device.model) {
    return false;
  }
  const caps = device.capabilities;
  const before = JSON.stringify([
    entry.kind,
    entry.caps,
    entry.dimmable,
    entry.description,
    entry.modelHex,
  ]);
  entry.kind = device.isSwitch ? 'switch' : 'light';
  entry.caps = {
    color: Boolean(entry.caps?.color || caps.color),
    temperature: Boolean(entry.caps?.temperature || caps.temperature),
    white: Boolean(entry.caps?.white || caps.white),
  };
  // A light without colour modes (plant grow light) only switches on and off.
  const hasModes = (device.view?.modes ?? device.model.modes).length > 0;
  entry.dimmable = entry.kind === 'light' && Boolean(entry.dimmable || hasModes);
  entry.description = device.model.known
    ? device.model.description
    : entry.moduleModel || device.model.description;
  entry.modelHex = `0x${device.model.num.toString(16).padStart(2, '0').toUpperCase()}`;
  entry.identified = true;
  return (
    JSON.stringify([entry.kind, entry.caps, entry.dimmable, entry.description, entry.modelHex]) !==
    before
  );
}

/**
 * @description The device of the Discover tab.
 * @param {object} gladys - SDK client (externalIds).
 * @param {object} entry - Device entry (app.js).
 * @param {string} language - Language of the feature names.
 * @returns {object} The Gladys device.
 */
export function buildDevice(gladys, entry, language) {
  const ids = gladys.externalIds('device', entry.id);
  const name = deviceName(entry);
  return {
    name,
    external_id: ids.device,
    // The integration reads the devices itself on its own timer (one query
    // over the open connection), and most push their changes.
    should_poll: false,
    features: featureKeysOf(entry).map((key) => ({
      name: `${name} - ${featureName(key, language)}`,
      external_id: ids.feature(key),
      ...FEATURES[key](entry.kind),
      read_only: false,
      has_feedback: true,
      keep_history: true,
    })),
    params: [
      { name: 'MAGICHOME_HOST', value: entry.host },
      { name: 'MAGICHOME_MAC', value: entry.mac || '' },
      { name: 'MAGICHOME_MODEL', value: entry.modelHex || '' },
    ],
  };
}

/**
 * @description The values of the features from a light view.
 * @param {object} entry - Device entry.
 * @param {object} view - device.view (light.js describe()).
 * @returns {Array<[string, number]>} `[featureKey, value]`.
 */
export function featureValues(entry, view) {
  if (!view) {
    return [];
  }
  const keys = new Set(featureKeysOf(entry));
  const values = [[FEATURE_KEYS.POWER, view.on ? 1 : 0]];
  if (keys.has(FEATURE_KEYS.BRIGHTNESS)) {
    values.push([FEATURE_KEYS.BRIGHTNESS, Math.round((view.brightness * 100) / 255)]);
  }
  if (keys.has(FEATURE_KEYS.COLOR) && view.color !== null) {
    values.push([FEATURE_KEYS.COLOR, view.color]);
  }
  if (keys.has(FEATURE_KEYS.TEMPERATURE) && view.kelvin !== null) {
    const mired = kelvinToMired(view.kelvin);
    values.push([FEATURE_KEYS.TEMPERATURE, Math.min(MAX_MIRED, Math.max(MIN_MIRED, mired))]);
  }
  return values;
}

/**
 * @description Run a Gladys command on a device.
 * @param {object} device - MagicHomeDevice.
 * @param {string} key - Feature key.
 * @param {number} value - Gladys value.
 * @returns {Promise<object>} The view after the command.
 */
export function runCommand(device, key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`invalid value ${value}`);
  }
  switch (key) {
    case FEATURE_KEYS.POWER:
      return device.setPower(number >= 1);
    case FEATURE_KEYS.BRIGHTNESS:
      return device.setBrightness(Math.round((Math.min(100, Math.max(0, number)) * 255) / 100));
    case FEATURE_KEYS.COLOR:
      return device.setColor(intToRgb(number));
    case FEATURE_KEYS.TEMPERATURE:
      return device.setKelvin(miredToKelvin(Math.min(MAX_MIRED, Math.max(MIN_MIRED, number))));
    default:
      throw new RangeError(`unknown feature ${key}`);
  }
}
