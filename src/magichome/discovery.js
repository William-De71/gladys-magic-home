// -----------------------------------------------------------------------------
// Finding the devices on the local network.
//
// The Wi-Fi module of every Magic Home device answers the UDP datagram
// `HF-A11ASSISTHREAD` on port 48899 with `<ip>,<MAC>,<module model>`. The
// integration container sits behind the Docker bridge, where a broadcast
// never reaches the LAN: the scan goes through the `udp-active-broadcast`
// capture of Gladys (the core, on the host network, broadcasts the datagram
// we forge and relays the unicast answers).
//
// The addresses typed in the configuration are asked directly, by unicast
// from the container (that crosses the bridge): devices on another subnet,
// or a network that filters broadcasts. Legacy modules (MAC prefix ACCF23)
// only answer a datagram sent FROM port 48899: the unicast probe tries that
// port first.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import { DISCOVERY_MESSAGE, DISCOVERY_PORT, LEGACY_OUI } from './constants.js';

export const SCAN_SECONDS = 4;
const PROBE_MS = 2000;

export const discoveryPayload = () => Buffer.from(DISCOVERY_MESSAGE, 'ascii');

/**
 * @description Read one answer.
 * @param {Buffer|string} payload - The datagram.
 * @param {string} [sourceIp] - Where it came from (preferred to the announced IP).
 * @returns {{ host: string, id: string, moduleModel: string, legacy: boolean }|null}
 * The device, or null when the datagram is not an answer (our own request
 * echoed, an AT command answer…).
 */
export function parseDiscoveryReply(payload, sourceIp) {
  const text = Buffer.isBuffer(payload) ? payload.toString('latin1') : String(payload ?? '');
  const parts = text.replace(/[\r\n]/g, '').split(',');
  if (parts.length < 3) {
    return null;
  }
  const [ip, mac, moduleModel] = parts;
  const id = mac.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(id)) {
    return null;
  }
  const host = sourceIp || ip.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return null;
  }
  return { host, id, moduleModel: moduleModel.trim(), legacy: id.startsWith(LEGACY_OUI) };
}

/**
 * @description Broadcast the discovery datagram through Gladys.
 * @param {object} gladys - SDK client.
 * @param {object} [options] - `{ logger, timeoutSeconds }`.
 * @returns {Promise<{ devices: object[], error: string|null }>} The devices
 * (deduplicated by MAC) and why the scan failed, if it did.
 */
export async function broadcastScan(gladys, { logger, timeoutSeconds = SCAN_SECONDS } = {}) {
  let replies;
  try {
    replies = await gladys.scanNetwork('udp-active-broadcast', {
      port: DISCOVERY_PORT,
      payload: discoveryPayload(),
      timeoutSeconds,
    });
  } catch (error) {
    if (error?.status === 403) {
      logger?.warn(
        'Magic Home: Gladys refused the network scan (reinstall the integration to accept its network discovery)',
      );
      return { devices: [], error: 'forbidden' };
    }
    if (error?.status === 429 || error?.status === 409) {
      return { devices: [], error: 'busy' };
    }
    logger?.warn(`Magic Home: network scan failed: ${error?.message ?? error}`);
    return { devices: [], error: 'failed' };
  }
  const devices = new Map();
  for (const reply of replies ?? []) {
    const device = parseDiscoveryReply(
      Buffer.from(String(reply?.payload_base64 ?? ''), 'base64'),
      reply?.source_ip,
    );
    if (device) {
      devices.set(device.id, device);
    }
  }
  return { devices: [...devices.values()], error: null };
}

/**
 * @description Ask one address directly.
 * @param {string} host - IP address.
 * @param {object} [deps] - `{ createSocket, timeoutMs }` (tests).
 * @returns {Promise<object|null>} The device, or null when it did not answer.
 */
export async function probeHost(
  host,
  { createSocket = dgram.createSocket, timeoutMs = PROBE_MS } = {},
) {
  for (const bindPort of [DISCOVERY_PORT, 0]) {
    const found = await new Promise((resolve) => {
      const socket = createSocket({ type: 'udp4', reuseAddr: true });
      let timer = null;
      const finish = (value) => {
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // already closed
        }
        resolve(value);
      };
      socket.on('error', () => finish(undefined));
      socket.on('message', (message, remote) => {
        const device = parseDiscoveryReply(message, remote?.address);
        if (device && device.host === host) {
          finish(device);
        }
      });
      socket.bind(bindPort, () => {
        timer = setTimeout(() => finish(null), timeoutMs);
        timer.unref?.();
        socket.send(discoveryPayload(), DISCOVERY_PORT, host, (error) => {
          if (error) {
            finish(null);
          }
        });
      });
    });
    // undefined: the port could not be bound (already used), try the next one.
    if (found !== undefined) {
      return found;
    }
  }
  return null;
}

/**
 * @description Parse the addresses typed in the configuration.
 * @param {string} value - `192.168.1.20, 192.168.1.21`.
 * @returns {string[]} The valid IPv4 addresses, deduplicated.
 */
export function parseHosts(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[\s,;]+/)
        .map((part) => part.trim())
        .filter((part) => /^\d{1,3}(\.\d{1,3}){3}$/.test(part))
        .filter((part) => part.split('.').every((octet) => Number(octet) <= 255)),
    ),
  ];
}
