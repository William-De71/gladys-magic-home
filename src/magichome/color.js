// -----------------------------------------------------------------------------
// Colour arithmetic shared by the protocol and the Gladys mapping. Pure.
//
// Magic Home devices speak raw channel levels (red, green, blue, warm white,
// cool white, 0-255) or, on the newest firmwares, HSV and a "scaled" white
// (temperature 0-100 from warm to cool, brightness 0-100). Gladys speaks a
// 0xRRGGBB colour, a 0-100 brightness and a colour temperature in MIRED (the
// scale its slider gradient assumes: it grows towards warm, like Hue 153-500).
// -----------------------------------------------------------------------------

import { MAX_KELVIN, MIN_KELVIN } from './constants.js';

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const byte = (value) => clamp(Math.round(value), 0, 255);

/**
 * @description RGB (0-255) to HSV (0-1 each).
 * @param {number} r - Red.
 * @param {number} g - Green.
 * @param {number} b - Blue.
 * @returns {{ h: number, s: number, v: number }} Hue, saturation, value.
 */
export function rgbToHsv(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === red) {
      h = ((green - blue) / delta) % 6;
    } else if (max === green) {
      h = (blue - red) / delta + 2;
    } else {
      h = (red - green) / delta + 4;
    }
    h /= 6;
    if (h < 0) {
      h += 1;
    }
  }
  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

/**
 * @description HSV (0-1 each) to RGB (0-255).
 * @param {number} h - Hue.
 * @param {number} s - Saturation.
 * @param {number} v - Value.
 * @returns {number[]} `[r, g, b]`.
 */
export function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6];
  return [byte(r * 255), byte(g * 255), byte(b * 255)];
}

/**
 * @description The colour at full value (what a colour picker shows), the
 * brightness being a separate feature.
 * @param {number[]} rgb - `[r, g, b]`.
 * @returns {number[]} `[r, g, b]` with the same hue and saturation, value 1.
 */
export function unscaled([r, g, b]) {
  const { h, s, v } = rgbToHsv(r, g, b);
  return v === 0 ? [255, 255, 255] : hsvToRgb(h, s, 1);
}

/**
 * @description A colour at a given brightness.
 * @param {number[]} rgb - `[r, g, b]`, any value.
 * @param {number} brightness - 0-255.
 * @returns {number[]} `[r, g, b]`.
 */
export function atBrightness([r, g, b], brightness) {
  const { h, s } = rgbToHsv(r, g, b);
  return hsvToRgb(h, s, clamp(brightness, 0, 255) / 255);
}

export const rgbToInt = ([r, g, b]) => (byte(r) << 16) | (byte(g) << 8) | byte(b);
export const intToRgb = (value) => {
  const number = clamp(Math.round(Number(value) || 0), 0, 0xffffff);
  return [(number >> 16) & 0xff, (number >> 8) & 0xff, number & 0xff];
};

export const kelvinToMired = (kelvin) => Math.round(1e6 / kelvin);
export const miredToKelvin = (mired) => Math.round(1e6 / mired);
export const MIN_MIRED = kelvinToMired(MAX_KELVIN);
export const MAX_MIRED = kelvinToMired(MIN_KELVIN);

/**
 * @description Warm and cool white levels to a temperature and a brightness.
 * @param {number} warm - Warm white, 0-255.
 * @param {number} cool - Cool white, 0-255.
 * @returns {{ kelvin: number, brightness: number }} Kelvin, brightness 0-255.
 */
export function whiteLevelsToTemperature(warm, cool) {
  const total = warm / 255 + cool / 255;
  const kelvin =
    total === 0 ? MIN_KELVIN : (cool / 255 / total) * (MAX_KELVIN - MIN_KELVIN) + MIN_KELVIN;
  return { kelvin: Math.round(kelvin), brightness: Math.min(255, Math.round(total * 255)) };
}

/**
 * @description A temperature and a brightness to warm and cool levels.
 * @param {number} kelvin - Colour temperature.
 * @param {number} brightness - 0-255.
 * @returns {number[]} `[warm, cool]`, 0-255.
 */
export function temperatureToWhiteLevels(kelvin, brightness) {
  const temperature = clamp(kelvin, MIN_KELVIN, MAX_KELVIN);
  const level = Math.round((clamp(brightness, 0, 255) / 255) * 100) / 100;
  const warm = ((MAX_KELVIN - temperature) / (MAX_KELVIN - MIN_KELVIN)) * level;
  return [byte(warm * 255), byte((level - warm) * 255)];
}

/**
 * @description The "scaled" white of CCT bulbs and new firmwares (temperature
 * 0 warm - 100 cool, brightness 0-100) to warm and cool levels.
 * @param {number} temperature - 0-100.
 * @param {number} brightness - 0-100.
 * @returns {number[]} `[warm, cool]`, 0-255.
 */
export function scaledWhiteToLevels(temperature, brightness) {
  const level = Math.round(clamp(brightness, 0, 100)) / 100;
  const warm = ((100 - clamp(temperature, 0, 100)) / 100) * level;
  return [byte(warm * 255), byte((level - warm) * 255)];
}

/**
 * @description Warm and cool levels to the "scaled" white.
 * @param {number} warm - 0-255.
 * @param {number} cool - 0-255.
 * @returns {{ temperature: number, brightness: number }} Both 0-100.
 */
export function levelsToScaledWhite(warm, cool) {
  const total = warm / 255 + cool / 255;
  return {
    temperature: total === 0 ? 0 : Math.round((cool / 255 / total) * 100),
    brightness: Math.min(100, Math.round(total * 100)),
  };
}

/**
 * @description Parse `#RRGGBB`, `RRGGBB` or `#RGB` (scene fields).
 * @param {string} value - The text.
 * @returns {number[]|null} `[r, g, b]`, or null when not a colour.
 */
export function parseHexColor(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(text)) {
    return [...text].map((digit) => parseInt(digit + digit, 16));
  }
  if (/^[0-9a-f]{6}$/i.test(text)) {
    return [0, 2, 4].map((index) => parseInt(text.slice(index, index + 2), 16));
  }
  return null;
}

export const toHex = (rgb) => `#${rgbToInt(rgb).toString(16).padStart(6, '0').toUpperCase()}`;
