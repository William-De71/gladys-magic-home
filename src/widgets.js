// -----------------------------------------------------------------------------
// Dashboard widgets.
//
//   lights   every Magic Home device created in Gladys: on / off / not
//            answering, brightness and what it plays; "All off" button
//   light    one light (setting `device`): state, mode, brightness, and
//            three effect buttons chosen in the settings + a "Steady" button
//
// Pure: the build functions turn a snapshot into a content, so the tests and
// docs/illustrations/gen.mjs use the exact code Gladys gets. Every text is
// multi-language: Gladys caches the content per language.
// -----------------------------------------------------------------------------

import { EFFECTS } from './magichome/constants.js';
import { effectName, LANGUAGES, t, text, truncate, truncateAll } from './i18n.js';

export const WIDGETS = { OVERVIEW: 'lights', LIGHT: 'light' };
export const WIDGET_ACTIONS = {
  REFRESH: 'refresh',
  ALL_OFF: 'all_off',
  POWER_ON: 'power_on',
  POWER_OFF: 'power_off',
  EFFECT_1: 'effect_1',
  EFFECT_2: 'effect_2',
  EFFECT_3: 'effect_3',
  STOP: 'stop_effect',
};
export const EFFECT_SETTINGS = ['effect_1', 'effect_2', 'effect_3'];
export const DEFAULT_EFFECTS = {
  effect_1: 'colorloop',
  effect_2: 'colorjump',
  effect_3: 'purple_fade',
};
export const DEFAULT_SPEED = 50;
export const TTL_SECONDS = 60;

/**
 * @typedef {object} DeviceView
 * @property {string} deviceId - Gladys external id.
 * @property {string} name - Device name in Gladys.
 * @property {boolean} reachable - Answers.
 * @property {boolean} on - Powered.
 * @property {boolean} isSwitch - A socket or a relay.
 * @property {number} brightness - 0-100.
 * @property {string} mode - `static`, `effect`, `custom`, `music`.
 * @property {string|null} effect - Built-in effect key.
 * @property {string} group - `color`, `white`, `mixed`, `none`.
 * @property {boolean} effects - Has built-in effects.
 * @property {string} host - IP address.
 */

const state = (view) => {
  if (!view.reachable) {
    return { key: 'widgetUnreachable', color: 'danger' };
  }
  return view.on ? { key: 'widgetOn', color: 'success' } : { key: 'widgetOff', color: 'neutral' };
};

/** What a light plays, in the four languages. */
export function modeText(view) {
  if (view.mode === 'effect') {
    return view.effect ? effectName(view.effect) : t('widgetEffect');
  }
  if (view.mode === 'custom') {
    return t('widgetCustom');
  }
  if (view.mode === 'music') {
    return t('widgetMusic');
  }
  if (view.group === 'color') {
    return t('widgetColor');
  }
  if (view.group === 'white') {
    return t('widgetWhite');
  }
  return t('widgetStatic');
}

/** The only line besides the title and the badge in the list display. */
function subtitle(view) {
  const mode = modeText(view);
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      // Off, a socket, not answering: the badge says it, the address helps.
      if (!view.reachable || !view.on || view.isSwitch) {
        return [language, view.host || text(state(view).key, language)];
      }
      return [language, truncate(`${view.brightness} % · ${mode[language]}`, 60)];
    }),
  );
}

/**
 * @description The `lights` widget.
 * @param {DeviceView[]} views - The devices created in Gladys.
 * @param {object} [settings] - `{ show: 'all' | 'on' }`.
 * @returns {object} The widget content.
 */
export function buildOverviewWidget(views, settings = {}) {
  const onlyOn = settings.show === 'on';
  const on = views.filter((view) => view.reachable && view.on).length;
  const unreachable = views.filter((view) => !view.reachable).length;
  const items = [
    {
      label: t('widgetOnCount'),
      value: `${on} / ${views.length}`,
      color: on > 0 ? 'success' : 'neutral',
    },
  ];
  if (unreachable > 0) {
    items.push({ label: t('widgetUnreachable'), value: String(unreachable), color: 'danger' });
  }
  const components = [{ type: 'status', items }];
  const shown = views.filter((view) => !onlyOn || (view.reachable && view.on));
  if (shown.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: shown.slice(0, 8).map((view) => ({
        title: truncate(view.name, 60),
        subtitle: subtitle(view),
        badge: {
          text: truncateAll(t(state(view).key), 16),
          color: state(view).color,
        },
      })),
    });
  } else {
    components.push({
      type: 'text',
      text: views.length === 0 ? t('widgetNoDevice') : t('widgetOff'),
      variant: 'caption',
    });
  }
  if (on > 0) {
    components.push({
      type: 'button',
      label: t('widgetAllOff'),
      icon: 'power',
      style: 'danger',
      action: { key: WIDGET_ACTIONS.ALL_OFF, confirm: true },
    });
  }
  components.push({
    type: 'button',
    label: t('widgetRefresh'),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  return { version: 1, ttl_seconds: TTL_SECONDS, components };
}

/**
 * @description The effects of the three buttons, from the settings.
 * @param {object} settings - Widget settings.
 * @returns {string[]} Three EFFECTS keys.
 */
export function chosenEffects(settings = {}) {
  return EFFECT_SETTINGS.map((key) =>
    EFFECTS[settings[key]] !== undefined ? settings[key] : DEFAULT_EFFECTS[key],
  );
}

/**
 * @description The `light` widget.
 * @param {DeviceView|null} view - The light, null when the setting points nowhere.
 * @param {object} [settings] - `{ device, effect_1, effect_2, effect_3 }`.
 * @returns {object} The widget content.
 */
export function buildLightWidget(view, settings = {}) {
  if (!view) {
    return {
      version: 1,
      ttl_seconds: TTL_SECONDS,
      components: [{ type: 'text', text: t('widgetChooseDevice'), variant: 'caption' }],
    };
  }
  const current = state(view);
  const items = [{ label: t('widgetState'), value: t(current.key), color: current.color }];
  if (view.reachable && view.on && !view.isSwitch) {
    items.push({
      label: t('widgetMode'),
      value: truncateAll(modeText(view), 40),
      color: view.mode === 'static' ? 'neutral' : 'primary',
    });
  }
  const components = [
    { type: 'text', text: truncate(view.name, 40), variant: 'heading' },
    { type: 'status', items },
  ];
  if (!view.isSwitch && view.reachable) {
    components.push({
      type: 'gauge',
      value: view.on ? view.brightness : 0,
      min: 0,
      max: 100,
      unit: '%',
      label: t('widgetBrightness'),
      color: view.on ? 'warning' : 'neutral',
    });
  }
  const device = { device: view.deviceId };
  if (view.reachable) {
    components.push({
      type: 'button',
      label: view.on ? t('widgetPowerOff') : t('widgetPowerOn'),
      icon: 'power',
      style: view.on ? 'secondary' : 'primary',
      action: { key: view.on ? WIDGET_ACTIONS.POWER_OFF : WIDGET_ACTIONS.POWER_ON, params: device },
    });
    if (view.effects) {
      // Four buttons at most: on/off, two effects, and the third effect, or
      // "Steady" while an effect plays.
      const playing = view.on && view.mode !== 'static';
      chosenEffects(settings).forEach((effect, index) => {
        if (index === 2 && playing) {
          components.push({
            type: 'button',
            label: t('widgetStop'),
            icon: 'square',
            style: 'secondary',
            action: { key: WIDGET_ACTIONS.STOP, params: device },
          });
          return;
        }
        components.push({
          type: 'button',
          label: truncateAll(effectName(effect), 24),
          icon: 'play',
          style: view.mode === 'effect' && view.effect === effect ? 'primary' : 'secondary',
          action: { key: WIDGET_ACTIONS[`EFFECT_${index + 1}`], params: { ...device, effect } },
        });
      });
    } else if (!view.isSwitch) {
      components.push({ type: 'text', text: t('widgetNoEffects'), variant: 'caption' });
    }
  }
  return { version: 1, ttl_seconds: TTL_SECONDS, components: components.slice(0, 8) };
}
