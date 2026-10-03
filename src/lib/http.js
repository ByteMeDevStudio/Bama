// fetch() wrapper for the upstream sports APIs: JSON only, with a timeout and
// errors that say which service failed.

export class UpstreamError extends Error {
  /**
   * @param {string} service
   * @param {string} message
   * @param {number} [status]
   */
  constructor(service, message, status) {
    super(`${service}: ${message}`);
    this.name = "UpstreamError";
    this.service = service;
    this.status = status;
  }
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} service
 * @param {string} url
 * @param {{ headers?: Record<string, string>, timeoutMs?: number }} [options]
 * @returns {Promise<any>}
 */
export async function fetchJson(fetchImpl, service, url, { headers = {}, timeoutMs = 10_000 } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "bama-hub/0.1", ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const e = /** @type {Error} */ (err);
    const reason = e.name === "TimeoutError" ? "timed out" : e.message;
    throw new UpstreamError(service, `request failed (${reason})`);
  }
  if (!res.ok) {
    throw new UpstreamError(service, `HTTP ${res.status}`, res.status);
  }
  try {
    return await res.json();
  } catch {
    throw new UpstreamError(service, "response was not JSON", res.status);
  }
}
