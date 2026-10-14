// -----------------------------------------------------------------------------
// Scene triggers and actions (manifest `scene_triggers` / `scene_actions`).
//
// Triggers, on transitions only:
//   light_offline   a device stopped answering (unplugged, cut at the wall
//                   switch, out of Wi-Fi) for longer than the grace delay
//   light_online    it answers again (only after a light_offline)
// A short outage (a router reboot, a bulb switched off and on at once) fires
// nothing: the grace delay absorbs it.
//
// Actions: start_effect, custom_effect, flash, stop_effect. None of them can
// cause a trigger (they never change the reachability of a device), so there
// is no loop to guard against.
// -----------------------------------------------------------------------------

export const TRIGGERS = {
  OFFLINE: 'light_offline',
  ONLINE: 'light_online',
};

export const SCENE_ACTIONS = {
  EFFECT: 'start_effect',
  CUSTOM: 'custom_effect',
  FLASH: 'flash',
  STOP: 'stop_effect',
};

export const OFFLINE_GRACE_MS = 30 * 1000;
// Gladys accepts 300 scene events a minute per integration.
const EVENTS_PER_MINUTE = 250;

/**
 * @description Turn reachability changes into scene events, with a grace
 * delay before `light_offline`.
 * @param {object} deps - Dependencies.
 * @param {Function} deps.publish - `(key, data) => void`.
 * @param {number} [deps.graceMs] - Grace delay.
 * @returns {{ change: Function, stop: Function }} The tracker.
 */
export function createReachabilityEvents({ publish, graceMs = OFFLINE_GRACE_MS }) {
  const pending = new Map(); // id -> timer
  const offline = new Set();
  return {
    /**
     * @param {object} entry - `{ id, deviceId, name, host }`.
     * @param {boolean} reachable - Answers or not.
     * @param {string} name - Device name in Gladys.
     */
    change(entry, reachable, name) {
      const data = () => ({ device: entry.deviceId, device_name: name, ip: entry.host });
      if (reachable) {
        clearTimeout(pending.get(entry.id));
        pending.delete(entry.id);
        if (offline.delete(entry.id)) {
          publish(TRIGGERS.ONLINE, data());
        }
        return;
      }
      if (offline.has(entry.id) || pending.has(entry.id)) {
        return;
      }
      const timer = setTimeout(() => {
        pending.delete(entry.id);
        offline.add(entry.id);
        publish(TRIGGERS.OFFLINE, data());
      }, graceMs);
      timer.unref?.();
      pending.set(entry.id, timer);
    },
    isOffline: (id) => offline.has(id),
    stop() {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    },
  };
}

/**
 * @description A sliding one-minute window counter: the scene events beyond
 * the budget are dropped (and logged once per minute) rather than refused by
 * Gladys.
 * @param {object} deps - `{ now, logger }`.
 * @returns {{ allow: Function }} The limiter.
 */
export function createEventLimiter({ now = Date.now, logger }) {
  const stamps = [];
  let warnedAt = 0;
  return {
    allow() {
      const current = now();
      while (stamps.length > 0 && stamps[0] <= current - 60000) {
        stamps.shift();
      }
      if (stamps.length >= EVENTS_PER_MINUTE) {
        if (current - warnedAt > 60000) {
          warnedAt = current;
          logger?.warn(
            'Magic Home: more than 250 scene events in a minute, the next ones are dropped',
          );
        }
        return false;
      }
      stamps.push(current);
      return true;
    },
  };
}
