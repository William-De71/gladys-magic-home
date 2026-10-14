// Every user-facing text exists in English, French, German and Spanish: the
// manifest (every multi-language object, widgets, triggers, actions, fields,
// variables and outputs included), the runtime messages, the four docs and the
// four READMEs, with their images.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { LANGUAGES, MESSAGES_FOR_TESTS } from '../src/i18n.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const RAW = 'https://raw.githubusercontent.com/William-De71/gladys-magic-home/main/';
const README = { en: 'README.md', fr: 'README.fr.md', de: 'README.de.md', es: 'README.es.md' };

/**
 * @description Every multi-language object of a value, with its path.
 * @param {*} value - Manifest node.
 * @param {string} path - Its path.
 * @param {object[]} found - Accumulator.
 * @returns {object[]} `[{ path, value }]`.
 */
function multiLanguage(value, path = '', found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => multiLanguage(item, `${path}[${index}]`, found));
  } else if (value && typeof value === 'object') {
    if (typeof value.en === 'string') {
      found.push({ path, value });
    } else {
      for (const [key, child] of Object.entries(value)) {
        multiLanguage(child, path ? `${path}.${key}` : key, found);
      }
    }
  }
  return found;
}

test('manifest: every text in the four languages', () => {
  const texts = multiLanguage(manifest);
  assert.ok(texts.length > 100, `${texts.length} texts`);
  for (const { path, value } of texts) {
    for (const language of LANGUAGES) {
      assert.equal(typeof value[language], 'string', `${path}.${language}`);
      assert.ok(value[language].trim().length > 0, `${path}.${language}`);
    }
  }
});

test('manifest: widget labels of 3 to 30 characters, descriptions of 10 to 100', () => {
  for (const widget of manifest.widgets) {
    for (const language of LANGUAGES) {
      const label = widget.label[language];
      assert.ok(label.length >= 3 && label.length <= 30, `${widget.key} ${language}`);
      assert.ok(widget.description[language].length <= 100);
    }
  }
  for (const language of LANGUAGES) {
    const length = manifest.description[language].length;
    assert.ok(length >= 10 && length <= 100, `description ${language}: ${length}`);
  }
});

test('runtime messages: four languages, the same placeholders', () => {
  for (const [key, message] of Object.entries(MESSAGES_FOR_TESTS)) {
    const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const language of LANGUAGES) {
      assert.equal(typeof message[language], 'string', `${key}.${language}`);
      assert.deepEqual(
        placeholders(message[language]),
        placeholders(message.en),
        `${key}.${language}`,
      );
    }
  }
});

const headings = (text) =>
  text
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('docs: four languages, same structure, long enough, the widget image of their language', () => {
  const structure = headings(read('docs/en.md'));
  for (const language of LANGUAGES) {
    const text = read(`docs/${language}.md`);
    assert.ok(text.length > 300, `docs/${language}.md`);
    assert.deepEqual(headings(text), structure, `docs/${language}.md headings`);
    assert.ok(
      text.includes(`(${RAW}docs/assets/widgets.${language}.png)`),
      `docs/${language}.md shows its widget image by absolute URL`,
    );
    assert.doesNotMatch(
      text,
      /\]\((?!https?:\/\/)[^)#]+\)/,
      'no relative link in docs (re-hosted)',
    );
    assert.doesNotMatch(text, /cover\.jpg/, 'the store already shows the cover');
  }
});

test('READMEs: four languages, navigation, badges, cover, same structure, images', () => {
  const structure = headings(read('README.md'));
  for (const language of LANGUAGES) {
    const text = read(README[language]);
    for (const other of Object.values(README)) {
      if (other !== README[language]) {
        assert.ok(text.includes(`](${other})`), `${README[language]} links ${other}`);
      }
    }
    assert.match(text, /img\.shields\.io\/badge\/(license|licence|Lizenz|licencia)-Apache--2\.0/);
    assert.match(text, /img\.shields\.io\/github\/v\/release\/William-De71\/gladys-magic-home/);
    assert.match(text, /actions\/workflow\/status\/William-De71\/gladys-magic-home\/release\.yml/);
    assert.match(text, /Gladys-%E2%89%A5%205\.1\.1/);
    assert.match(text, /!\[[^\]]+\]\(cover\.jpg\)/, `${README[language]} shows the cover`);
    assert.ok(
      text.includes(`(docs/assets/widgets.${language}.png)`),
      `${README[language]} widget image`,
    );
    assert.ok(text.includes('(docs/assets/architecture.svg)'));
    assert.equal((text.match(/```mermaid/g) ?? []).length, 3, 'architecture, sequence, release');
    assert.deepEqual(headings(text), structure, `${README[language]} headings`);
  }
});

test('images: the cover and every referenced image exist', () => {
  assert.ok(exists('cover.jpg'));
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024);
  // JPEG SOF0/SOF2 frame: height then width.
  const frame = cover.findIndex(
    (byte, index) => byte === 0xff && [0xc0, 0xc2].includes(cover[index + 1]),
  );
  assert.equal(cover.readUInt16BE(frame + 5), 534);
  assert.equal(cover.readUInt16BE(frame + 7), 800);
  for (const language of LANGUAGES) {
    assert.ok(exists(`docs/assets/widgets.${language}.png`), language);
  }
  assert.ok(exists('docs/assets/architecture.svg'));
});

test('effect names fit a widget button (24 characters) in every language', () => {
  for (const [key, message] of Object.entries(MESSAGES_FOR_TESTS)) {
    if (key.startsWith('effect_')) {
      for (const language of LANGUAGES) {
        assert.ok(message[language].length <= 24, `${key}.${language}: ${message[language]}`);
      }
    }
  }
});
