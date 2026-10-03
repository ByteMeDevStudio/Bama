// Only lets allowlisted machines (by default: this machine, plus juno once it is
// configured) reach the app. Everything else gets a 403 before any route runs.

import net from "node:net";
import dns from "node:dns/promises";

/**
 * Strips the IPv4-mapped IPv6 prefix and any zone id so "::ffff:192.168.1.20"
 * and "fe80::1%eth0" compare like their plain forms.
 * @param {string | undefined} address
 */
export function normalizeIp(address) {
  if (!address) return "";
  let ip = address.trim();
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  return ip;
}

/**
 * Builds a BlockList (used here as an allowlist) from "1.2.3.4",
 * "192.168.1.0/24", "2001:db8::/32" style entries. Throws on a bad entry so a
 * typo in ALLOWED_IPS fails loudly at startup instead of silently locking out.
 * @param {string[]} entries
 */
export function buildStaticList(entries) {
  const list = new net.BlockList();
  for (const raw of ["127.0.0.1", "::1", ...entries]) {
    const [addr, prefix] = raw.split("/");
    const ip = normalizeIp(addr);
    const family = net.isIP(ip);
    if (!family) throw new Error(`ALLOWED_IPS: "${raw}" is not an IP address or CIDR range`);
    const type = family === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) {
      list.addAddress(ip, type);
    } else {
      const bits = Number(prefix);
      const max = family === 4 ? 32 : 128;
      if (!/^\d+$/.test(prefix) || bits > max) {
        throw new Error(`ALLOWED_IPS: "${raw}" has an invalid prefix length`);
      }
      list.addSubnet(ip, bits, type);
    }
  }
  return list;
}

/**
 * @param {{
 *   allowedIps: string[],
 *   allowedHostnames: string[],
 *   hostnameRefreshSeconds: number,
 *   lookup?: (hostname: string) => Promise<string[]>,
 *   log?: (msg: string) => void,
 * }} options
 */
export function createAllowlist({
  allowedIps,
  allowedHostnames,
  hostnameRefreshSeconds,
  lookup = defaultLookup,
  log = (msg) => console.log(msg),
}) {
  const staticList = buildStaticList(allowedIps);
  /** @type {Set<string>} */
  let resolved = new Set();
  let lastRefresh = 0;
  /** @type {Promise<void> | null} */
  let refreshing = null;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;

  async function refresh() {
    if (allowedHostnames.length === 0) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      /** @type {Set<string>} */
      const next = new Set();
      for (const host of allowedHostnames) {
        try {
          for (const ip of await lookup(host)) next.add(normalizeIp(ip));
        } catch (err) {
          log(`[allowlist] could not resolve ${host}: ${/** @type {Error} */ (err).message}`);
        }
      }
      const before = [...resolved].sort().join(",");
      const after = [...next].sort().join(",");
      // Keep the previous answer if DNS is down, rather than locking juno out.
      if (next.size > 0) resolved = next;
      if (before !== after && next.size > 0) {
        log(`[allowlist] ${allowedHostnames.join(", ")} -> ${after}`);
      }
      lastRefresh = Date.now();
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  /** @param {string | undefined} address */
  function isAllowed(address) {
    const ip = normalizeIp(address);
    const family = net.isIP(ip);
    if (!family) return false;
    if (staticList.check(ip, family === 4 ? "ipv4" : "ipv6")) return true;
    return resolved.has(ip);
  }

  /**
   * Like isAllowed, but on a miss re-resolves the hostnames (at most every 30s)
   * in case juno just picked up a new address.
   * @param {string | undefined} address
   */
  async function check(address) {
    if (isAllowed(address)) return true;
    if (allowedHostnames.length > 0 && Date.now() - lastRefresh > 30_000) {
      await refresh();
      return isAllowed(address);
    }
    return false;
  }

  function start() {
    if (allowedHostnames.length === 0 || timer) return Promise.resolve();
    timer = setInterval(() => void refresh(), hostnameRefreshSeconds * 1000);
    timer.unref();
    return refresh();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { isAllowed, check, refresh, start, stop, resolvedAddresses: () => [...resolved] };
}

/** @param {string} hostname */
async function defaultLookup(hostname) {
  const results = await dns.lookup(hostname, { all: true });
  return results.map((r) => r.address);
}

/**
 * Express middleware. Uses the TCP peer address unless TRUST_PROXY is set, in
 * which case Express derives req.ip from X-Forwarded-For for trusted hops only.
 * @param {ReturnType<typeof createAllowlist>} allowlist
 * @param {{ trustProxy: unknown, log?: (msg: string) => void }} options
 * @returns {import("express").RequestHandler}
 */
export function allowlistMiddleware(allowlist, { trustProxy, log = (msg) => console.warn(msg) }) {
  /** @type {Map<string, number>} */
  const lastLogged = new Map();
  return (req, res, next) => {
    const address = trustProxy ? req.ip : req.socket.remoteAddress;
    allowlist.check(address).then(
      (ok) => {
        if (ok) return next();
        const ip = normalizeIp(address) || "unknown";
        const now = Date.now();
        if ((lastLogged.get(ip) ?? 0) < now - 60_000) {
          lastLogged.set(ip, now);
          log(`[allowlist] blocked ${ip} ${req.method} ${req.originalUrl}`);
        }
        res.status(403).type("text/plain").send("Forbidden");
      },
      (err) => next(err),
    );
  };
}
