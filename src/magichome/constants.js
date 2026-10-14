// -----------------------------------------------------------------------------
// Protocol constants of the Magic Home (Zengge "LEDENET") devices.
//
// Sources: the open-source flux_led library (lightinglibs/flux_led, used by
// the Home Assistant "Magic Home" integration) was the protocol reference;
// no code was copied, the byte layouts are re-implemented in this folder.
// -----------------------------------------------------------------------------

// Discovery: the Wi-Fi module (HF-LPB100 and successors) answers this UDP
// datagram on port 48899 with `ip,MAC,model`.
export const DISCOVERY_PORT = 48899;
export const DISCOVERY_MESSAGE = 'HF-A11ASSISTHREAD';

// Control: one TCP connection on port 5577, binary frames.
export const CONTROL_PORT = 5577;

export const POWER_ON = 0x23;
export const POWER_OFF = 0x24;

// White range assumed by the Magic Home app for CCT devices.
export const MIN_KELVIN = 2700;
export const MAX_KELVIN = 6500;

// Devices of this MAC prefix only answer the original (no checksum) protocol
// first and need their discovery sent from port 48899.
export const LEGACY_OUI = 'ACCF23';

// Pattern byte of a state: what the device is doing.
export const PATTERN_STATIC = new Set([0x41, 0x61]);
export const PATTERN_CUSTOM = 0x60;
export const PATTERN_MUSIC = new Set([0x62, 0x5d]);

// Transition byte of a custom effect.
export const TRANSITIONS = { gradual: 0x3a, jump: 0x3b, strobe: 0x3c };

// The built-in effects of the RGB controllers and bulbs. Keys are stored in
// scenes and widget settings: they are forever.
export const EFFECTS = {
  rgb_cross_fade: 0x24,
  colorloop: 0x25,
  red_fade: 0x26,
  green_fade: 0x27,
  blue_fade: 0x28,
  yellow_fade: 0x29,
  cyan_fade: 0x2a,
  purple_fade: 0x2b,
  white_fade: 0x2c,
  rg_cross_fade: 0x2d,
  rb_cross_fade: 0x2e,
  gb_cross_fade: 0x2f,
  colorstrobe: 0x30,
  red_strobe: 0x31,
  green_strobe: 0x32,
  blue_strobe: 0x33,
  yellow_strobe: 0x34,
  cyan_strobe: 0x35,
  purple_strobe: 0x36,
  white_strobe: 0x37,
  colorjump: 0x38,
  cycle_rgb: 0x39,
  cycle_seven_colors: 0x3a,
};

// Effects only the "dimmable effects" firmwares know (0x38 command).
export const DIMMABLE_ONLY_EFFECTS = new Set(['rgb_cross_fade', 'cycle_rgb', 'cycle_seven_colors']);

export const EFFECT_BY_PATTERN = new Map(Object.entries(EFFECTS).map(([key, code]) => [code, key]));

// The four white effects of the original CCT controllers (0x03).
export const LEGACY_CCT_EFFECTS = new Set([0x3a, 0x3c, 0x4a, 0x4c]);
