// -----------------------------------------------------------------------------
// One TCP connection to one device (port 5577), kept open.
//
// The devices accept few simultaneous connections (the Magic Home app holds
// one too), so a single connection carries the queries, the commands and the
// states the device pushes on its own when its remote is used. TCP delivers
// bytes, not frames: `expectedLength` cuts the stream, and a frame still
// incomplete after a short silence is delivered as it is (some extended
// states are shorter than documented).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { CONTROL_PORT } from './constants.js';
import { expectedLength, unwrap } from './protocol.js';

const PARTIAL_FLUSH_MS = 300;

export class ConnectionError extends Error {}

/**
 * @description A TCP connection to a device. Emits `frame` (unwrapped
 * Buffer) and `close`.
 */
export class MagicHomeClient extends EventEmitter {
  /**
   * @param {object} options - Options.
   * @param {string} options.host - IP address.
   * @param {number} [options.port] - TCP port.
   * @param {Function} [options.connect] - `(port, host) => socket` (tests).
   * @param {number} [options.connectTimeoutMs] - Connection deadline.
   * @param {number} [options.spacingMs] - Minimum delay between two frames.
   */
  constructor({
    host,
    port = CONTROL_PORT,
    connect = net.createConnection,
    connectTimeoutMs = 5000,
    spacingMs = 150,
  }) {
    super();
    this.connectTimeoutMs = connectTimeoutMs;
    this.spacingMs = spacingMs;
    this.lastWriteAt = 0;
    this.host = host;
    this.port = port;
    this.connectImpl = connect;
    this.socket = null;
    this.opening = null;
    this.buffer = Buffer.alloc(0);
    this.flushTimer = null;
    this.waiters = new Set();
    this.counter = -1;
  }

  /** Sequence number of the wrapped frames, 0-254. */
  nextCounter() {
    this.counter = (this.counter + 1) % 255;
    return this.counter;
  }

  get connected() {
    return Boolean(this.socket);
  }

  /** @returns {Promise<void>} Resolves once connected. */
  open() {
    if (this.socket) {
      return Promise.resolve();
    }
    if (this.opening) {
      return this.opening;
    }
    this.opening = new Promise((resolve, reject) => {
      const socket = this.connectImpl(this.port, this.host);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new ConnectionError(`no answer from ${this.host}:${this.port}`));
      }, this.connectTimeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        socket.setNoDelay?.(true);
        socket.setKeepAlive?.(true, 30000);
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(new ConnectionError(`${this.host}:${this.port}: ${error.message}`));
      });
      socket.on('data', (data) => this.receive(data));
      socket.once('close', () => {
        clearTimeout(timer);
        if (this.socket === socket) {
          this.socket = null;
          this.emit('close');
        }
        this.waiters.forEach((waiter) => waiter.fail(new ConnectionError('connection closed')));
      });
      // An error after the connection only closes it: the 'close' handler reports it.
      socket.on('error', () => {});
    }).finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  /** @param {Buffer} data - Received bytes. */
  receive(data) {
    clearTimeout(this.flushTimer);
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length > 0) {
      const length = expectedLength(this.buffer);
      if (this.buffer.length < length) {
        this.flushTimer = setTimeout(() => this.flushPartial(), PARTIAL_FLUSH_MS);
        this.flushTimer.unref?.();
        return;
      }
      const frame = this.buffer.subarray(0, length);
      this.buffer = this.buffer.subarray(length);
      this.deliver(frame);
    }
  }

  flushPartial() {
    if (this.buffer.length > 0) {
      const frame = this.buffer;
      this.buffer = Buffer.alloc(0);
      this.deliver(frame);
    }
  }

  deliver(frame) {
    const inner = unwrap(Buffer.from(frame));
    this.waiters.forEach((waiter) => waiter.check(inner));
    this.emit('frame', inner);
  }

  /**
   * @description Send a frame, connecting first when needed.
   * @param {Buffer} frame - The bytes.
   * @returns {Promise<void>} Resolves once written.
   */
  async send(frame) {
    await this.open();
    // Two frames written back to back can reach the device in one TCP
    // segment, which some firmwares read as a single (invalid) frame.
    const wait = this.lastWriteAt + this.spacingMs - Date.now();
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastWriteAt = Date.now();
    await new Promise((resolve, reject) => {
      this.socket.write(frame, (error) =>
        error ? reject(new ConnectionError(error.message)) : resolve(),
      );
    });
  }

  /**
   * @description Wait for a frame.
   * @param {Function} parse - `(frame) => value | null`: the first non-null value resolves.
   * @param {number} timeoutMs - Deadline.
   * @returns {Promise<*>} The value, or null at the deadline.
   */
  waitFor(parse, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = {
        check: (frame) => {
          const value = parse(frame);
          if (value !== null && value !== undefined) {
            done();
            resolve(value);
          }
        },
        fail: (error) => {
          done();
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        done();
        resolve(null);
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(waiter);
      };
      this.waiters.add(waiter);
    });
  }

  /**
   * @description Send a frame and wait for an answer.
   * @param {Buffer} frame - The request.
   * @param {Function} parse - Answer parser (see waitFor).
   * @param {number} timeoutMs - Deadline.
   * @returns {Promise<*>} The parsed answer, or null at the deadline.
   */
  async request(frame, parse, timeoutMs) {
    await this.open();
    const answer = this.waitFor(parse, timeoutMs);
    // A send that fails leaves the waiter to its deadline or to the close.
    answer.catch(() => {});
    await this.send(frame);
    return answer;
  }

  close() {
    clearTimeout(this.flushTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.destroy();
  }
}
