// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake Magic Home devices of the tests, on a made-up evening
// (Thursday 15 October 2026): the living room bulb plays the colour loop, the
// kitchen strip is in warm white, the garden light is unplugged.
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { memoryStorage } = await load('src/storage.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { FakeBulb, FAST_TIMING, fakeNetwork } = await load('test/helpers.js');

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const silent = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };

const DEVICES = [
  {
    bulb: { host: '192.168.1.40', mac: 'B4E842E10588', model: 0x35, version: 0x09 },
    name: { en: 'Living room lamp', fr: 'Lampe salon', de: 'Wohnzimmerlampe', es: 'Lámpara salón' },
  },
  {
    bulb: {
      host: '192.168.1.41',
      mac: 'B4E842E10599',
      model: 0x07,
      version: 0x02,
      state: { mode: 0x17, ww: 153, cw: 20 },
    },
    name: { en: 'Kitchen strip', fr: 'Ruban cuisine', de: 'Küchenstreifen', es: 'Tira cocina' },
  },
  {
    bulb: {
      host: '192.168.1.42',
      mac: 'B4E842E105AA',
      model: 0x09,
      version: 0x01,
      state: { on: false, ww: 30, cw: 60 },
    },
    name: {
      en: 'Bedroom ceiling',
      fr: 'Plafonnier chambre',
      de: 'Schlafzimmerdecke',
      es: 'Techo dormitorio',
    },
  },
  {
    bulb: { host: '192.168.1.43', mac: 'B4E842E105BB', model: 0x97, version: 0x01 },
    name: {
      en: 'Christmas tree',
      fr: 'Sapin de Noël',
      de: 'Weihnachtsbaum',
      es: 'Árbol de Navidad',
    },
  },
  {
    bulb: {
      host: '192.168.1.44',
      mac: 'B4E842E105CC',
      model: 0x33,
      version: 0x0a,
      state: { r: 0, g: 120, b: 255, ww: 0 },
    },
    name: { en: 'Garden light', fr: 'Lumière jardin', de: 'Gartenlicht', es: 'Luz jardín' },
    unplug: true,
  },
];

/**
 * @description One language: five devices, an effect running, one unplugged.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const network = fakeNetwork(DEVICES.map(({ bulb }) => new FakeBulb(bulb)));
  const gladys = createFakeGladys({ config: { language } });
  gladys.fake.scanResults['udp-active-broadcast'] = network.scanReplies();
  const app = createApp(gladys, {
    storage: memoryStorage(),
    logger: silent,
    connect: network.connect,
    probe: network.probe,
    timing: FAST_TIMING,
    confirmAfterMs: 1,
    offlineGraceMs: 1,
  });
  await gladys.connect();
  await app.start();
  for (const device of gladys.fake.discoveredDevices) {
    const known = DEVICES.find(({ bulb }) => device.external_id.endsWith(bulb.mac.toLowerCase()));
    await gladys.fake.deviceCreated({ ...structuredClone(device), name: known.name[language] });
  }
  const lamp = 'ext:test-integration:device:b4e842e10588';
  await gladys.fake.sceneAction('start_effect', {
    device: lamp,
    effect: 'colorloop',
    speed: 60,
    brightness: 80,
  });
  for (const { bulb, unplug } of DEVICES) {
    if (unplug) {
      network.bulbs.get(bulb.host).unplugged = true;
      network.socketOf(bulb.host)?.destroy();
    }
  }
  await app.poll();
  await app.poll();

  const get = async (key, settings) =>
    (await gladys.fake.widgetGet(key, { settings, language })).data.content;
  const result = {
    lights: await get('lights', { show: 'all' }),
    light: await get('light', {
      device: lamp,
      effect_1: 'colorloop',
      effect_2: 'colorjump',
      effect_3: 'purple_fade',
    }),
  };
  await app.stop();
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const cards = Object.fromEntries(
  manifest.widgets.map((widget) => [widget.key, { icon: widget.icon, label: widget.label }]),
);
writeFileSync(out, JSON.stringify({ contents: all, images: {}, cards }));
