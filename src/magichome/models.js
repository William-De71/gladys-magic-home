// -----------------------------------------------------------------------------
// The models: the byte 1 of a state answer ("model number") says what the
// device is, its firmware version (byte 10) which protocol it speaks.
//
// Colour modes:
//   DIM     one white channel
//   CCT     warm + cool white
//   RGB     colour channels
//   RGBW    colour + one white, both at once
//   RGBWW   colour + warm + cool, all at once
// A model listing two modes (`DIM, RGB` or `CCT, RGB`) has them one at a time
// (a bulb lights its colour LEDs or its white LEDs, never both).
//
// Data compiled from the flux_led model database (see constants.js); the
// table is facts about devices, written again for this project.
// -----------------------------------------------------------------------------

export const PROTOCOLS = {
  ORIGINAL: 'original',
  ORIGINAL_CCT: 'original_cct',
  BYTE8: '8byte',
  BYTE8_AUTO_ON: '8byte_auto_on',
  BYTE8_DIMMABLE: '8byte_dimmable',
  BYTE9: '9byte',
  BYTE9_AUTO_ON: '9byte_auto_on',
  BYTE9_DIMMABLE: '9byte_dimmable',
  BYTE25: '25byte',
  EXTENDED: 'extended',
  CCT: 'cct',
  CCT_WRAPPED: 'cct_wrapped',
  SOCKET: 'socket',
  ADDRESSABLE_A1: 'addressable_a1',
  ADDRESSABLE_A2: 'addressable_a2',
  ADDRESSABLE_A3: 'addressable_a3',
  CHRISTMAS: 'christmas',
};

const P = PROTOCOLS;

// What each protocol does differently.
//   requiresTurnOn   levels and effects are ignored while off: power on first
//   dimmableEffects  effects take a brightness (0x38 command)
//   push             the device sends its state when changed by its remote
//   wrapped          queries and commands go in the 0xB0 envelope
export const PROTOCOL_TRAITS = {
  [P.ORIGINAL]: { requiresTurnOn: true },
  [P.ORIGINAL_CCT]: { requiresTurnOn: true },
  [P.BYTE8]: { requiresTurnOn: true },
  [P.BYTE8_AUTO_ON]: {},
  [P.BYTE8_DIMMABLE]: { dimmableEffects: true, push: true },
  [P.BYTE9]: { requiresTurnOn: true },
  [P.BYTE9_AUTO_ON]: {},
  [P.BYTE9_DIMMABLE]: { dimmableEffects: true, push: true },
  [P.BYTE25]: { requiresTurnOn: true },
  [P.EXTENDED]: { requiresTurnOn: true },
  [P.CCT]: { requiresTurnOn: true, push: true },
  [P.CCT_WRAPPED]: { push: true, wrapped: true },
  [P.SOCKET]: { requiresTurnOn: true, push: true },
  [P.ADDRESSABLE_A1]: { push: true, addressable: true },
  [P.ADDRESSABLE_A2]: { dimmableEffects: true, addressable: true },
  [P.ADDRESSABLE_A3]: { dimmableEffects: true, push: true, addressable: true, wrapped: true },
  [P.CHRISTMAS]: { push: true, addressable: true, wrapped: true },
};

export const traitsOf = (protocol) => PROTOCOL_TRAITS[protocol] ?? {};

const DIM = ['DIM'];
const CCT = ['CCT'];
const RGB = ['RGB'];
const RGBW = ['RGBW'];
const RGBWW = ['RGBWW'];
const RGB_W = ['DIM', 'RGB'];
const RGB_CCT = ['CCT', 'RGB'];

// The mode byte (4) of the controllers whose wiring is configurable.
const BASE_MODES = { 1: DIM, 2: CCT, 3: RGB, 4: RGBW, 5: RGBWW, 6: RGB_W, 7: RGB_CCT };
const RGB_WIRINGS = Object.fromEntries([0x13, 0x23, 0x33].map((mode) => [mode, RGB]));
const RGBW_WIRINGS = {
  ...Object.fromEntries([0x14, 0x24, 0x34].map((mode) => [mode, RGBW])),
  ...Object.fromEntries([0x16, 0x26, 0x36].map((mode) => [mode, RGB_W])),
};
const RGBWW_WIRINGS = Object.fromEntries(
  [0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf].flatMap((high) => [
    [(high << 4) | 0x7, RGB_CCT],
    [(high << 4) | 0x5, RGBWW],
  ]),
);
const SPLIT_BULB = { 0x01: RGB_CCT, 0x17: RGB_CCT };

/**
 * @typedef {object} Model
 * @property {number} num - Model number.
 * @property {string} description - English description.
 * @property {Array<[number, string]>} protocols - `[minVersion, protocol]`, highest first.
 * @property {string[]} modes - Colour modes when the mode byte says nothing.
 * @property {object} [modeMap] - Mode byte -> colour modes.
 * @property {string} [channels] - `dim` / `cct`: whites carried in the red (and green) slots.
 * @property {boolean} [allWrites] - Always writes colours and whites together.
 * @property {boolean} [switch] - A socket or a relay, not a light.
 */

/** @type {Model[]} */
const MODELS = [
  { num: 0x01, description: 'Legacy Controller RGB', protocols: [[0, P.ORIGINAL]], modes: RGB },
  {
    num: 0x02,
    description: 'Legacy Controller Dimmable',
    protocols: [[0, P.ORIGINAL]],
    modes: DIM,
    channels: 'dim',
  },
  {
    num: 0x03,
    description: 'Legacy Controller CCT',
    protocols: [[0, P.ORIGINAL_CCT]],
    modes: CCT,
    channels: 'cct',
  },
  {
    num: 0x04,
    description: 'Controller RGB&W',
    protocols: [
      [6, P.BYTE8_AUTO_ON],
      [0, P.BYTE8],
    ],
    modes: RGBW,
    allWrites: true,
  },
  {
    num: 0x06,
    description: 'Controller RGBW',
    protocols: [
      [2, P.BYTE8_DIMMABLE],
      [1, P.BYTE8_AUTO_ON],
      [0, P.BYTE8],
    ],
    modes: RGBW,
    modeMap: RGBW_WIRINGS,
  },
  {
    num: 0x07,
    description: 'Controller RGBCW',
    protocols: [
      [2, P.BYTE9_DIMMABLE],
      [0, P.BYTE9],
    ],
    modes: RGBWW,
    modeMap: RGBWW_WIRINGS,
  },
  {
    num: 0x08,
    description: 'Controller RGB with MIC',
    protocols: [
      [2, P.BYTE8_DIMMABLE],
      [1, P.BYTE8_AUTO_ON],
      [0, P.BYTE8],
    ],
    modes: RGB,
    modeMap: RGB_WIRINGS,
    allWrites: true,
  },
  { num: 0x09, description: 'High Voltage Bulb CCT', protocols: [[0, P.CCT]], modes: CCT },
  {
    num: 0x0b,
    description: 'Switch 1 Channel',
    protocols: [[0, P.BYTE8]],
    modes: [],
    switch: true,
  },
  {
    num: 0x0e,
    description: 'Floor Lamp RGBCW',
    protocols: [
      [9, P.BYTE9_DIMMABLE],
      [7, P.BYTE9_AUTO_ON],
      [0, P.BYTE9],
    ],
    modes: RGB_CCT,
    modeMap: SPLIT_BULB,
  },
  { num: 0x10, description: 'Christmas Light', protocols: [[0, P.CHRISTMAS]], modes: RGB },
  {
    num: 0x16,
    description: 'Magnetic Light CCT',
    protocols: [[0, P.BYTE8]],
    modes: CCT,
    channels: 'cct',
    allWrites: true,
  },
  {
    num: 0x17,
    description: 'Magnetic Light Dimmable',
    protocols: [[0, P.BYTE8]],
    modes: DIM,
    channels: 'dim',
    allWrites: true,
  },
  { num: 0x18, description: 'Plant Grow Light', protocols: [[0, P.BYTE8]], modes: [] },
  {
    num: 0x19,
    description: 'Socket with 2 USB',
    protocols: [[0, P.SOCKET]],
    modes: [],
    switch: true,
  },
  { num: 0x1a, description: 'String Lights', protocols: [[0, P.CHRISTMAS]], modes: RGB },
  { num: 0x1b, description: 'Aroma Fragrance Light', protocols: [[0, P.BYTE8]], modes: RGB },
  { num: 0x1c, description: 'Table Light CCT', protocols: [[0, P.CCT_WRAPPED]], modes: CCT },
  {
    num: 0x1d,
    description: 'Fill Light',
    protocols: [[0, P.BYTE8_AUTO_ON]],
    modes: DIM,
    channels: 'dim',
    allWrites: true,
  },
  {
    num: 0x1e,
    description: 'Ceiling Light RGBCW',
    protocols: [
      [9, P.BYTE9_DIMMABLE],
      [7, P.BYTE9_AUTO_ON],
      [0, P.BYTE9],
    ],
    modes: RGB_CCT,
    modeMap: SPLIT_BULB,
  },
  {
    num: 0x21,
    description: 'Bulb Dimmable',
    protocols: [
      [2, P.BYTE8_AUTO_ON],
      [0, P.BYTE8],
    ],
    modes: DIM,
    channels: 'dim',
    allWrites: true,
  },
  {
    num: 0x25,
    description: 'Controller RGB/WW/CW',
    protocols: [[0, P.BYTE9]],
    modes: RGBWW,
    modeMap: BASE_MODES,
    allWrites: true,
  },
  {
    num: 0x33,
    description: 'Controller RGB',
    protocols: [
      [9, P.BYTE8_DIMMABLE],
      [6, P.BYTE8_AUTO_ON],
      [0, P.BYTE8],
    ],
    modes: RGB,
    modeMap: RGB_WIRINGS,
    allWrites: true,
  },
  {
    num: 0x35,
    description: 'Bulb RGBCW',
    protocols: [
      [10, P.BYTE25],
      [9, P.BYTE9_DIMMABLE],
      [7, P.BYTE9_AUTO_ON],
      [0, P.BYTE9],
    ],
    modes: RGB_CCT,
    modeMap: SPLIT_BULB,
  },
  {
    num: 0x41,
    description: 'Controller Dimmable',
    protocols: [
      [2, P.BYTE8_AUTO_ON],
      [0, P.BYTE8],
    ],
    modes: DIM,
    channels: 'dim',
  },
  {
    num: 0x44,
    description: 'Bulb RGBW',
    protocols: [
      [9, P.BYTE8_AUTO_ON],
      [0, P.BYTE8],
    ],
    modes: RGB_W,
  },
  { num: 0x45, description: 'Bulb RGBW', protocols: [[0, P.BYTE8]], modes: RGB_W },
  {
    num: 0x52,
    description: 'Bulb CCT',
    protocols: [[0, P.BYTE8]],
    modes: CCT,
    channels: 'cct',
    allWrites: true,
  },
  { num: 0x54, description: 'Downlight RGBW', protocols: [[0, P.BYTE8]], modes: RGB_W },
  {
    num: 0x62,
    description: 'Controller CCT',
    protocols: [[0, P.BYTE8]],
    modes: CCT,
    channels: 'cct',
    allWrites: true,
  },
  {
    num: 0x81,
    description: 'Controller RGBW',
    protocols: [[0, P.BYTE8]],
    modes: RGBW,
    allWrites: true,
  },
  { num: 0x93, description: 'Switch', protocols: [[0, P.SOCKET]], modes: [], switch: true },
  { num: 0x94, description: 'Switch Watt', protocols: [[0, P.SOCKET]], modes: [], switch: true },
  {
    num: 0x95,
    description: 'Switch 2 Channel',
    protocols: [[0, P.SOCKET]],
    modes: [],
    switch: true,
  },
  {
    num: 0x96,
    description: 'Switch 4 Channel',
    protocols: [[0, P.SOCKET]],
    modes: [],
    switch: true,
  },
  { num: 0x97, description: 'Socket', protocols: [[0, P.SOCKET]], modes: [], switch: true },
  { num: 0xa1, description: 'Addressable v1', protocols: [[0, P.ADDRESSABLE_A1]], modes: RGB },
  { num: 0xa2, description: 'Addressable v2', protocols: [[0, P.ADDRESSABLE_A2]], modes: RGB },
  { num: 0xa3, description: 'Addressable v3', protocols: [[0, P.ADDRESSABLE_A3]], modes: RGB },
  { num: 0xa4, description: 'Addressable v4', protocols: [[0, P.ADDRESSABLE_A3]], modes: RGB },
  { num: 0xa6, description: 'Addressable v6', protocols: [[0, P.ADDRESSABLE_A3]], modes: RGB },
  { num: 0xa7, description: 'Addressable v7', protocols: [[0, P.ADDRESSABLE_A3]], modes: RGB },
  {
    num: 0xb6,
    description: 'Surplife Outdoor Permanent Lighting',
    protocols: [[0, P.EXTENDED]],
    modes: RGB_W,
  },
  {
    num: 0xe1,
    description: 'Ceiling Light CCT',
    protocols: [[0, P.BYTE8]],
    modes: CCT,
    channels: 'cct',
    allWrites: true,
  },
  {
    num: 0xe2,
    description: 'Ceiling Light CCT Assist',
    protocols: [[0, P.BYTE8]],
    modes: CCT,
    channels: 'cct',
    allWrites: true,
  },
];

const BY_NUM = new Map(MODELS.map((model) => [model.num, model]));

export const MODEL_NUMS = [...BY_NUM.keys()];

/**
 * @description The model of a model number; an unknown number gives a
 * generic model (its colour modes come from the mode byte) speaking the
 * protocol that answered the probe.
 * @param {number} num - Model number.
 * @param {string} [fallbackProtocol] - Protocol of the probe that answered.
 * @returns {Model & { known: boolean }} The model.
 */
export function modelOf(num, fallbackProtocol = P.BYTE8) {
  const model = BY_NUM.get(num);
  if (model) {
    return { ...model, known: true };
  }
  return {
    num,
    description: 'Unknown Model',
    protocols: [[0, fallbackProtocol]],
    modes: RGB,
    modeMap: BASE_MODES,
    unknownModes: true,
    known: false,
  };
}

/**
 * @description The protocol of a model for a firmware version.
 * @param {Model} model - The model.
 * @param {number} version - Firmware version (byte 10 of the state).
 * @returns {string} The protocol.
 */
export function protocolFor(model, version) {
  const match = model.protocols.find(([minVersion]) => version >= minVersion);
  return (match ?? model.protocols[model.protocols.length - 1])[1];
}

/**
 * @description The colour modes of a device in its current wiring.
 * @param {Model} model - The model.
 * @param {number} modeByte - Byte 4 of the state.
 * @returns {string[]} The colour modes (empty for a switch).
 */
export function colorModesOf(model, modeByte) {
  if (model.unknownModes) {
    return model.modeMap[modeByte & 0x0f] ?? RGB;
  }
  return model.modeMap?.[modeByte] ?? model.modes;
}

/**
 * @description What a set of colour modes can do.
 * @param {string[]} modes - Colour modes.
 * @returns {{ color: boolean, temperature: boolean, white: boolean, together: boolean }}
 * `color` RGB channels, `temperature` warm + cool whites, `white` a single
 * white channel, `together` colours and whites lit at the same time.
 */
export function capabilitiesOf(modes) {
  const has = (mode) => modes.includes(mode);
  return {
    color: has('RGB') || has('RGBW') || has('RGBWW'),
    temperature: has('CCT') || has('RGBWW'),
    white: has('DIM') || has('RGBW'),
    together: has('RGBW') || has('RGBWW'),
  };
}
