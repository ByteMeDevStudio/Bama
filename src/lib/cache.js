// Small TTL cache that also collapses concurrent requests for the same key, so
// ten browser tabs polling a live game cost one upstream call.

export class TtlCache {
  /** @param {{ maxEntries?: number, now?: () => number }} [options] */
  constructor({ maxEntries = 500, now = Date.now } = {}) {
    /** @type {Map<string, { value: unknown, expires: number }>} */
    this.entries = new Map();
    /** @type {Map<string, Promise<unknown>>} */
    this.inflight = new Map();
    this.maxEntries = maxEntries;
    this.now = now;
  }

  /**
   * @template T
   * @param {string} key
   * @param {number} ttlMs
   * @param {() => Promise<T>} load
   * @returns {Promise<T>}
   */
  async get(key, ttlMs, load) {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return /** @type {T} */ (hit.value);

    const pending = this.inflight.get(key);
    if (pending) return /** @type {Promise<T>} */ (pending);

    const promise = load()
      .then((value) => {
        this.entries.delete(key);
        this.entries.set(key, { value, expires: this.now() + ttlMs });
        while (this.entries.size > this.maxEntries) {
          const oldest = this.entries.keys().next().value;
          if (oldest === undefined) break;
          this.entries.delete(oldest);
        }
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  clear() {
    this.entries.clear();
  }
}
