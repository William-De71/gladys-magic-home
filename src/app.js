// -----------------------------------------------------------------------------
// The integration: every Gladys handler, registered before connect().
//
//   discovery   UDP "HF-A11ASSISTHREAD" broadcast through Gladys (port
//               48899) + the addresses of the configuration, then one TCP
//               connection per device (port 5577) to learn its model
//   states      queried every 10 to 60 s over that connection; most devices
//               also push their changes (remote, Magic Home app)
//   commands    Gladys features, scene actions, widget buttons -> device.js
//
// A device is identified by its MAC address: when its address changes (DHCP),
// the next scan finds it again. The devices seen are kept in /data so a
// restart reconnects at once, without waiting for a scan.
//
// The tests drive it with the fake Gladys of the SDK and fake devices
// (test/app.test.js).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, logger as sdkLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  buildDevice,
  deviceName,
  featureValues,
  learnDevice,
  platformId,
  runCommand,
} from './devices.js';
import { effectName, t, text, truncateAll } from './i18n.js';
import { parseHexColor } from './magichome/color.js';
import { EFFECTS, TRANSITIONS } from './magichome/constants.js';
import { MagicHomeDevice, UnsupportedError } from './magichome/device.js';
import { broadcastScan, probeHost } from './magichome/discovery.js';
import { createEventLimiter, createReachabilityEvents, SCENE_ACTIONS } from './scenes.js';
import { createStatePublisher } from './states.js';
import { createStorage } from './storage.js';
import {
  buildLightWidget,
  buildOverviewWidget,
  DEFAULT_SPEED,
  WIDGET_ACTIONS,
  WIDGETS,
} from './widgets.js';

export const ACTIONS = { TEST: 'test_connection' };

const MINUTE = 60 * 1000;
const FAILURES_BEFORE_UNREACHABLE = 2;
const RESCAN_SPACING_MS = 5 * MINUTE;
const CONFIRM_AFTER_MS = 2500;
const MANUAL_REFRESH_SPACING_MS = 10 * 1000;
const WIDGET_REFRESH_SPACING_MS = 11 * 1000;
const FLASH_SPEED = 90;
const MAX_MESSAGE = 1800;

const formatMac = (id) => id.match(/../g).join(':');

/**
 * @description Wire the integration.
 * @param {object} gladys - SDK client (or the fake one of the tests).
 * @param {object} [deps] - Dependencies.
 * @param {object} [deps.storage] - src/storage.js storage.
 * @param {object} [deps.logger] - Logger.
 * @param {Function} [deps.now] - Clock (ms).
 * @param {Function} [deps.connect] - TCP socket factory of the devices (tests).
 * @param {Function} [deps.probe] - `(host) => Promise<device|null>`, unicast discovery (tests).
 * @param {number} [deps.confirmAfterMs] - Delay of the state read after a command.
 * @param {object} [deps.timing] - Protocol timeouts (device.js TIMING, tests).
 * @param {number} [deps.offlineGraceMs] - Delay before `light_offline` (tests).
 * @returns {object} `{ start, stop, poll, scan, … }`.
 */
export function createApp(
  gladys,
  {
    storage = createStorage(),
    logger = sdkLogger,
    now = Date.now,
    connect,
    probe = (host) => probeHost(host),
    confirmAfterMs = CONFIRM_AFTER_MS,
    timing,
    offlineGraceMs,
  } = {},
) {
  let config = normalizeConfig(gladys.config ?? {});
  let pollTimer = null;
  let rescanTimer = null;
  let stopped = false;
  let polling = null;
  let scanning = null;
  let lastScanAt = 0;
  let scanError = null;
  let manualRefreshAt = 0;
  let statusKey = '';
  const entries = new Map(); // platform id -> entry
  const created = new Set(); // device external ids
  const transports = new Map();
  const widgetRefresh = new Map();
  const timers = new Set();
  const flashes = new Map(); // platform id -> { timer, snapshot }

  const limiter = createEventLimiter({ now, logger });
  const states = createStatePublisher(gladys, {
    logger,
    now,
    isCreated: (externalId) => created.has(externalId),
  });

  const safely = (task, what) =>
    Promise.resolve()
      .then(task)
      .catch((error) => logger.warn(`Magic Home: ${what} failed: ${error?.message ?? error}`));

  const later = (delay, task) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      task();
    }, delay);
    timer.unref?.();
    timers.add(timer);
  };

  // --- Widgets, transports, status ---------------------------------------------------

  const refreshWidget = (key) => {
    const slot = widgetRefresh.get(key) ?? { at: 0, timer: null };
    widgetRefresh.set(key, slot);
    const wait = slot.at + WIDGET_REFRESH_SPACING_MS - now();
    if (wait <= 0) {
      slot.at = now();
      safely(() => gladys.requestWidgetRefresh(key), 'widget refresh');
    } else if (!slot.timer) {
      slot.timer = setTimeout(() => {
        slot.timer = null;
        refreshWidget(key);
      }, wait);
      slot.timer.unref?.();
    }
  };
  const refreshWidgets = () => Object.values(WIDGETS).forEach(refreshWidget);

  const publishTransport = (entry, force = false) => {
    if (!created.has(entry.deviceId)) {
      return;
    }
    const transport = entry.reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    if (!force && transports.get(entry.deviceId) === transport) {
      return;
    }
    transports.set(entry.deviceId, transport);
    safely(
      () => gladys.publishTransports([{ external_id: entry.deviceId, transport }]),
      'transport badge',
    );
  };

  const nameOf = (entry) => entry.gladysName || deviceName(entry);

  const publishStatus = () => {
    // The created devices once there are some (the others are only read at
    // each search), every identified device before.
    const identified = [...entries.values()].filter((entry) => entry.identified);
    const mine = identified.filter((entry) => created.has(entry.deviceId));
    const known = mine.length > 0 ? mine : identified;
    const answering = known.filter((entry) => entry.reachable);
    const missing = known.filter((entry) => !entry.reachable);
    let key;
    let connected;
    let message;
    if (scanError === 'forbidden' && known.length === 0) {
      [key, connected, message] = ['forbidden', false, t('statusScanForbidden')];
    } else if (answering.length === 0) {
      [key, connected, message] = ['none', false, t('statusNoDevice')];
    } else if (missing.length > 0) {
      const names = missing.map(nameOf).slice(0, 5).join(', ');
      key = `partial:${answering.length}:${names}`;
      connected = true;
      message = truncateAll(
        t('statusPartial', { count: answering.length, missing: missing.length, names }),
        500,
      );
    } else {
      key = `ok:${answering.length}`;
      [connected, message] = [true, t('statusConnected', { count: answering.length })];
    }
    if (key !== statusKey) {
      statusKey = key;
      safely(() => gladys.setConnectionStatus(connected, message), 'status');
    }
  };

  // --- Entries -------------------------------------------------------------------------

  const persist = () =>
    safely(
      () =>
        storage.write(
          'devices.json',
          Object.fromEntries(
            [...entries.values()]
              .filter((entry) => entry.identified)
              .map((entry) => [
                entry.id,
                {
                  host: entry.host,
                  mac: entry.mac,
                  legacy: entry.legacy,
                  description: entry.description,
                  modelHex: entry.modelHex,
                  kind: entry.kind,
                  caps: entry.caps,
                  dimmable: entry.dimmable,
                },
              ]),
          ),
        ),
      'saving the devices',
    );

  const pushStates = (entry) => {
    const ids = gladys.externalIds('device', entry.id);
    for (const [key, value] of featureValues(entry, entry.device.view)) {
      states.push(ids.feature(key), value);
    }
  };

  const viewChanged = (before, after) =>
    !before ||
    before.on !== after.on ||
    before.brightness !== after.brightness ||
    before.mode !== after.mode ||
    before.effect !== after.effect ||
    before.group !== after.group;

  const learn = (entry) => learnDevice(entry, entry.device);

  const reachability = createReachabilityEvents({
    graceMs: offlineGraceMs,
    publish: (key, data) => {
      if (limiter.allow()) {
        safely(() => gladys.publishSceneEvent(key, data), 'scene event');
      }
    },
  });

  const setReachable = (entry, reachable) => {
    if (entry.reachable === reachable) {
      return;
    }
    const previous = entry.reachable;
    entry.reachable = reachable;
    publishTransport(entry);
    // A transition only: a device already silent when the integration
    // starts is not a device that "stops answering".
    if (created.has(entry.deviceId) && previous !== null) {
      reachability.change(entry, reachable, nameOf(entry));
    }
    publishStatus();
    refreshWidgets();
  };

  const entryOf = ({ id, host, mac = '', legacy = false, moduleModel = '' }) => {
    let entry = entries.get(id);
    if (!entry) {
      const device = new MagicHomeDevice({ id, host, legacy, connect, now, timing });
      entry = {
        id,
        deviceId: gladys.externalIds('device', id).device,
        host,
        mac,
        legacy,
        moduleModel,
        device,
        kind: null,
        caps: null,
        dimmable: false,
        description: '',
        modelHex: '',
        identified: false,
        reachable: null,
        failures: 0,
        featureKeys: new Set(),
        gladysName: '',
      };
      device.on('state', (view) => {
        const before = entry.lastView;
        entry.lastView = view;
        entry.failures = 0;
        setReachable(entry, true);
        pushStates(entry);
        if (viewChanged(before, view)) {
          refreshWidgets();
        }
      });
      entries.set(id, entry);
    } else {
      if (host && entry.host !== host) {
        logger.info(`Magic Home: ${id} moved from ${entry.host} to ${host}`);
        entry.host = host;
        entry.device.setHost(host);
      }
      entry.mac ||= mac;
      entry.moduleModel ||= moduleModel;
    }
    return entry;
  };

  const markFailure = (entry, error) => {
    if (stopped) {
      return;
    }
    entry.failures += 1;
    logger.debug?.(
      `Magic Home: ${entry.host} failed (${entry.failures}): ${error?.message ?? error}`,
    );
    if (entry.failures >= FAILURES_BEFORE_UNREACHABLE || entry.reachable === null) {
      setReachable(entry, false);
      requestRescan();
    }
  };

  const readEntry = async (entry) => {
    try {
      await entry.device.refresh();
      if (learn(entry)) {
        persist();
      }
      return true;
    } catch (error) {
      markFailure(entry, error);
      return false;
    }
  };

  // --- Discovery -------------------------------------------------------------------------

  const discovered = () =>
    [...entries.values()]
      .filter((entry) => entry.identified)
      .map((entry) => buildDevice(gladys, entry, config.language));

  const publishDiscovered = () =>
    safely(() => gladys.publishDiscoveredDevices(discovered()), 'discovery');

  const scanOnce = async () => {
    lastScanAt = now();
    const { devices, error } = await broadcastScan(gladys, { logger });
    scanError = error;
    const found = new Map(devices.map((device) => [device.id, device]));
    // Addresses of the configuration that did not answer the broadcast.
    const answered = new Set(devices.map((device) => device.host));
    for (const host of config.hosts.filter((candidate) => !answered.has(candidate))) {
      const device = await probe(host).catch(() => null);
      if (device) {
        found.set(device.id, device);
      } else {
        // Silent on UDP: maybe it still answers on TCP (identified by address).
        const id = platformId('', host);
        if (!found.has(id)) {
          found.set(id, { id, host, mac: '', legacy: false });
        }
      }
    }
    const touched = [];
    for (const device of found.values()) {
      if (device.mac === '') {
        touched.push(entryOf(device));
        continue;
      }
      // The same device was known by its address only (its discovery answer
      // got lost once): keep the address identity if the user created it,
      // drop it otherwise, never both (two connections to one device).
      const byAddress = entries.get(platformId('', device.host));
      if (byAddress && created.has(byAddress.deviceId)) {
        touched.push(byAddress);
        continue;
      }
      if (byAddress) {
        byAddress.device.close();
        entries.delete(byAddress.id);
      }
      touched.push(
        entryOf({
          id: platformId(device.id, device.host),
          host: device.host,
          mac: formatMac(device.id),
          legacy: device.legacy,
          moduleModel: device.moduleModel,
        }),
      );
    }
    await Promise.all(touched.map((entry) => readEntry(entry)));
    // A device has few connection slots (the Magic Home app needs one): free
    // the ones of the devices the user did not create.
    touched
      .filter((entry) => !created.has(entry.deviceId))
      .forEach((entry) => entry.device.close());
    persist();
    await publishDiscovered();
    publishStatus();
    return touched;
  };

  /** Run a scan, or join the one running. */
  const scan = () => {
    if (!scanning) {
      scanning = scanOnce().finally(() => {
        scanning = null;
      });
    }
    return scanning;
  };

  function requestRescan() {
    if (stopped || scanning || now() - lastScanAt < RESCAN_SPACING_MS) {
      return;
    }
    safely(() => scan(), 'scan');
  }

  // --- Polling ---------------------------------------------------------------------------

  const pollOnce = async () => {
    // Only the devices the user created: the others (a neighbour's bulb…) are
    // read at each search, never kept connected.
    const targets = [...entries.values()].filter((entry) => created.has(entry.deviceId));
    await Promise.all(targets.map((entry) => readEntry(entry)));
    publishStatus();
  };

  const poll = () => {
    if (!polling) {
      polling = pollOnce().finally(() => {
        polling = null;
      });
    }
    return polling;
  };

  const schedule = () => {
    clearInterval(pollTimer);
    clearInterval(rescanTimer);
    pollTimer = null;
    rescanTimer = null;
    if (stopped) {
      return;
    }
    pollTimer = setInterval(() => safely(() => poll(), 'poll'), config.pollMs);
    pollTimer.unref?.();
    if (config.rescanMs > 0) {
      rescanTimer = setInterval(() => safely(() => scan(), 'scan'), config.rescanMs);
      rescanTimer.unref?.();
    }
  };

  // --- Commands ----------------------------------------------------------------------------

  const asUserError = (error, entry) => {
    let message;
    if (error instanceof UnsupportedError) {
      message = text('errorUnsupported', config.language, {
        name: nameOf(entry),
        model: entry.modelHex || entry.description,
      });
    } else if (error instanceof RangeError) {
      message = error.message;
    } else {
      message = text('errorUnreachable', config.language, {
        name: nameOf(entry),
        error: String(error?.message ?? error).slice(0, 200),
      });
    }
    return new Error(message, { cause: error });
  };

  const entryFor = (externalId) => {
    const deviceId = String(externalId ?? '');
    const entry = [...entries.values()].find(
      (candidate) =>
        candidate.deviceId === deviceId || deviceId.startsWith(`${candidate.deviceId}:`),
    );
    if (!entry) {
      throw new Error(text('errorUnknownDevice', config.language));
    }
    return entry;
  };

  /** Read the device again once its fade is over. */
  const confirmSoon = (entry) =>
    later(confirmAfterMs, () => safely(() => readEntry(entry), 'confirm'));

  /** Run a device command, mapping errors to user texts. */
  const command = async (entry, task) => {
    cancelFlash(entry);
    try {
      const view = await task(entry.device);
      confirmSoon(entry);
      return view;
    } catch (error) {
      if (!(error instanceof UnsupportedError) && !(error instanceof RangeError)) {
        markFailure(entry, error);
      }
      throw asUserError(error, entry);
    }
  };

  gladys.onSetValue(async (device, feature, value) => {
    const entry = entryFor(device.external_id);
    const key = String(feature.external_id).split(':').pop();
    await command(entry, (target) => runCommand(target, key, value));
  });

  // --- Device events ---------------------------------------------------------------------------

  const trackCreated = (device) => {
    if (!device?.external_id) {
      return null;
    }
    created.add(device.external_id);
    const id = String(device.external_id).split(':').pop();
    const host =
      device.params?.find?.((param) => param.name === 'MAGICHOME_HOST')?.value ??
      entries.get(id)?.host;
    if (!host) {
      return null;
    }
    const entry = entryOf({ id, host });
    entry.gladysName = device.name ?? entry.gladysName;
    for (const feature of device.features ?? []) {
      const key = String(feature.external_id ?? '')
        .split(':')
        .pop();
      if (key) {
        entry.featureKeys.add(key);
      }
    }
    return entry;
  };

  gladys.onDeviceCreated(async (device) => {
    const entry = trackCreated(device);
    if (entry) {
      states.republish(entry.deviceId);
      if (entry.device.view) {
        pushStates(entry);
      }
      // Connect now: a device not created was disconnected after the search,
      // and its pushed states (remote control) only come over a connection.
      await readEntry(entry);
      publishTransport(entry, true);
    }
    refreshWidgets();
  });

  gladys.onDeviceUpdated(async (device) => {
    const entry = trackCreated(device);
    if (entry) {
      states.republish(entry.deviceId);
    }
  });

  gladys.onDeviceDeleted(async (device) => {
    if (device?.external_id) {
      created.delete(device.external_id);
      transports.delete(device.external_id);
      states.forget(device.external_id);
    }
    refreshWidgets();
  });

  gladys.onScanRequest(async () => {
    await scan();
  });

  gladys.onConfigUpdated(async (raw) => {
    const previous = config;
    config = normalizeConfig(raw ?? {});
    if (previous.language !== config.language) {
      await publishDiscovered();
    }
    if (previous.pollMs !== config.pollMs || previous.rescanMs !== config.rescanMs) {
      schedule();
    }
    if (previous.hosts.join(',') !== config.hosts.join(',')) {
      await scan();
    }
  });

  // --- Configuration button ------------------------------------------------------------------------

  gladys.onAction(ACTIONS.TEST, async () => {
    const touched = await scan();
    const known = [...new Set([...touched, ...entries.values()])].filter(
      (entry) => entry.identified,
    );
    if (known.length === 0) {
      return scanError === 'forbidden' ? t('statusScanForbidden') : t('statusNoDevice');
    }
    const message = {};
    for (const language of ['en', 'fr', 'de', 'es']) {
      const list = known
        .map((entry) => {
          const status = entry.reachable ? '' : `, ${text('testUnreachable', language)}`;
          return `${nameOf(entry)} (${entry.host}, ${entry.modelHex}${status})`;
        })
        .join(' ; ');
      message[language] = text('testOk', language, { count: known.length, list });
    }
    return truncateAll(message, MAX_MESSAGE);
  });

  // --- Scene actions -----------------------------------------------------------------------------------

  const sceneEntry = (fields) => entryFor(fields?.device);

  const effectKey = (value) => {
    const key = String(value ?? '');
    if (EFFECTS[key] === undefined) {
      throw new Error(text('errorUnknownEffect', config.language, { value: key }));
    }
    return key;
  };

  const percent = (value, fallback, min = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(100, Math.max(min, Math.round(number))) : fallback;
  };

  function cancelFlash(entry) {
    const flash = flashes.get(entry.id);
    if (flash) {
      clearTimeout(flash.timer);
      flashes.delete(entry.id);
    }
  }

  gladys.onSceneAction(SCENE_ACTIONS.EFFECT, async (fields = {}) => {
    const entry = sceneEntry(fields);
    const effect = effectKey(fields.effect);
    await command(entry, (device) =>
      device.startEffect(
        effect,
        percent(fields.speed, DEFAULT_SPEED),
        percent(fields.brightness, 100, 1),
      ),
    );
  });

  gladys.onSceneAction(SCENE_ACTIONS.CUSTOM, async (fields = {}) => {
    const entry = sceneEntry(fields);
    const parts = String(fields.colors ?? '')
      .split(/[\s,;]+/)
      .filter(Boolean);
    const colors = parts.map(parseHexColor);
    const invalid = parts.find((part, index) => colors[index] === null);
    if (invalid !== undefined || colors.length === 0) {
      throw new Error(text('errorInvalidColor', config.language, { value: invalid ?? '' }));
    }
    const transition = TRANSITIONS[fields.transition] === undefined ? 'gradual' : fields.transition;
    await command(entry, (device) =>
      device.startCustom(colors.slice(0, 16), percent(fields.speed, DEFAULT_SPEED), transition),
    );
  });

  gladys.onSceneAction(SCENE_ACTIONS.FLASH, async (fields = {}) => {
    const entry = sceneEntry(fields);
    const color = parseHexColor(fields.color ?? '#FF0000');
    if (!color) {
      throw new Error(text('errorInvalidColor', config.language, { value: fields.color }));
    }
    const seconds = Math.min(
      60,
      Math.max(1, Math.round(Number(fields.duration_seconds ?? 5)) || 5),
    );
    // A flash during a flash keeps the state from before the first one.
    const snapshot = flashes.get(entry.id)?.snapshot ?? entry.device.snapshot();
    await command(entry, (device) => device.startCustom([color, [0, 0, 0]], FLASH_SPEED, 'jump'));
    const timer = setTimeout(() => {
      flashes.delete(entry.id);
      safely(async () => {
        await entry.device.restore(snapshot);
        confirmSoon(entry);
      }, 'restoring after a flash');
    }, seconds * 1000);
    timer.unref?.();
    flashes.set(entry.id, { timer, snapshot });
  });

  gladys.onSceneAction(SCENE_ACTIONS.STOP, async (fields = {}) => {
    const entry = sceneEntry(fields);
    await command(entry, (device) => device.stopEffect());
  });

  // --- Widgets ---------------------------------------------------------------------------------------

  const viewOf = (entry) => {
    const view = entry.device.view;
    return {
      deviceId: entry.deviceId,
      name: nameOf(entry),
      reachable: Boolean(entry.reachable && view),
      on: Boolean(view?.on),
      isSwitch: entry.kind === 'switch',
      brightness: view ? Math.round((view.brightness * 100) / 255) : 0,
      mode: view?.mode ?? 'static',
      effect: view?.effect ?? null,
      group: view?.group ?? 'none',
      effects: entry.device.supportsEffects,
      host: entry.host,
    };
  };

  const createdEntries = () => [...entries.values()].filter((entry) => created.has(entry.deviceId));

  gladys.onWidgetGet(WIDGETS.OVERVIEW, async ({ settings } = {}) =>
    buildOverviewWidget(createdEntries().map(viewOf), settings ?? {}),
  );

  gladys.onWidgetGet(WIDGETS.LIGHT, async ({ settings } = {}) => {
    const entry = createdEntries().find((candidate) => candidate.deviceId === settings?.device);
    return buildLightWidget(entry ? viewOf(entry) : null, settings ?? {});
  });

  const toast = (error) =>
    truncateAll(
      { en: error.message, fr: error.message, de: error.message, es: error.message },
      200,
    );

  gladys.onWidgetAction(WIDGETS.OVERVIEW, async (actionKey) => {
    if (actionKey === WIDGET_ACTIONS.REFRESH) {
      if (now() - manualRefreshAt < MANUAL_REFRESH_SPACING_MS) {
        return t('widgetTooSoon');
      }
      manualRefreshAt = now();
      await poll();
      refreshWidgets();
      return t('widgetRefreshed');
    }
    if (actionKey === WIDGET_ACTIONS.ALL_OFF) {
      const targets = createdEntries().filter((entry) => entry.reachable && entry.device.view?.on);
      const results = await Promise.allSettled(
        targets.map((entry) => command(entry, (device) => device.setPower(false))),
      );
      refreshWidgets();
      return t('widgetAllOffDone', {
        count: results.filter((result) => result.status === 'fulfilled').length,
      });
    }
    return undefined;
  });

  gladys.onWidgetAction(WIDGETS.LIGHT, async (actionKey, params = {}, { settings } = {}) => {
    let entry;
    try {
      entry = entryFor(settings?.device ?? params.device);
    } catch (error) {
      return toast(error);
    }
    const speed = percent(settings?.speed, DEFAULT_SPEED);
    const tasks = {
      [WIDGET_ACTIONS.POWER_ON]: (device) => device.setPower(true),
      [WIDGET_ACTIONS.POWER_OFF]: (device) => device.setPower(false),
      [WIDGET_ACTIONS.STOP]: (device) => device.stopEffect(),
    };
    let done = t('widgetDone');
    if (
      [WIDGET_ACTIONS.EFFECT_1, WIDGET_ACTIONS.EFFECT_2, WIDGET_ACTIONS.EFFECT_3].includes(
        actionKey,
      )
    ) {
      const effect = String(params.effect ?? '');
      if (EFFECTS[effect] === undefined) {
        return t('errorUnknownEffect', { value: effect });
      }
      tasks[actionKey] = (device) => device.startEffect(effect, speed, 100);
      done = t('widgetEffectStarted', { effect: effectName(effect) });
    }
    if (!tasks[actionKey]) {
      return undefined;
    }
    try {
      await command(entry, tasks[actionKey]);
    } catch (error) {
      return toast(error);
    }
    refreshWidgets();
    return truncateAll(done, 200);
  });

  // --- Lifecycle -------------------------------------------------------------------------------------

  return {
    /** Restore the known devices, read them, then scan. */
    async start() {
      stopped = false;
      config = normalizeConfig(gladys.config ?? {});
      created.clear();
      const saved = (await storage.read('devices.json')) ?? {};
      for (const [id, info] of Object.entries(saved)) {
        if (typeof info?.host === 'string') {
          const entry = entryOf({ id, host: info.host, mac: info.mac, legacy: info.legacy });
          Object.assign(entry, {
            kind: info.kind ?? null,
            caps: info.caps ?? null,
            dimmable: Boolean(info.dimmable),
            description: info.description ?? '',
            modelHex: info.modelHex ?? '',
            identified: Boolean(info.kind),
          });
        }
      }
      (gladys.devices ?? []).forEach((device) => trackCreated(device));
      await poll();
      schedule();
      await scan();
    },

    async stop() {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(rescanTimer);
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      flashes.forEach((flash) => clearTimeout(flash.timer));
      flashes.clear();
      widgetRefresh.forEach((slot) => clearTimeout(slot.timer));
      reachability.stop();
      states.stop();
      await Promise.allSettled([polling, scanning]);
      entries.forEach((entry) => entry.device.close());
    },

    poll,
    scan,
    flushStates: () => states.flush(),
    entries,
  };
}
