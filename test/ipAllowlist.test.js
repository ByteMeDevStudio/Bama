import test from "node:test";
import assert from "node:assert/strict";
import { allowlistMiddleware, buildStaticList, createAllowlist, normalizeIp } from "../src/security/ipAllowlist.js";

const quiet = () => {};

test("normalizeIp strips IPv4-mapped prefixes and zone ids", () => {
  assert.equal(normalizeIp("::ffff:192.168.1.20"), "192.168.1.20");
  assert.equal(normalizeIp("fe80::1%eth0"), "fe80::1");
  assert.equal(normalizeIp(undefined), "");
});

test("loopback is always allowed, everything else is denied by default", () => {
  const list = createAllowlist({ allowedIps: [], allowedHostnames: [], hostnameRefreshSeconds: 60, log: quiet });
  assert.equal(list.isAllowed("127.0.0.1"), true);
  assert.equal(list.isAllowed("::1"), true);
  assert.equal(list.isAllowed("::ffff:127.0.0.1"), true);
  assert.equal(list.isAllowed("192.168.1.20"), false);
  assert.equal(list.isAllowed("garbage"), false);
  assert.equal(list.isAllowed(undefined), false);
});

test("single addresses and CIDR ranges", () => {
  const list = createAllowlist({
    allowedIps: ["192.168.1.20", "10.0.0.0/24", "2001:db8::/32"],
    allowedHostnames: [],
    hostnameRefreshSeconds: 60,
    log: quiet,
  });
  assert.equal(list.isAllowed("192.168.1.20"), true);
  assert.equal(list.isAllowed("::ffff:192.168.1.20"), true);
  assert.equal(list.isAllowed("192.168.1.21"), false);
  assert.equal(list.isAllowed("10.0.0.255"), true);
  assert.equal(list.isAllowed("10.0.1.1"), false);
  assert.equal(list.isAllowed("2001:db8:1::5"), true);
  assert.equal(list.isAllowed("2001:db9::5"), false);
});

test("bad entries fail loudly at startup", () => {
  assert.throws(() => buildStaticList(["juno"]), /not an IP address/);
  assert.throws(() => buildStaticList(["10.0.0.0/33"]), /invalid prefix/);
  assert.throws(() => buildStaticList(["10.0.0.0/abc"]), /invalid prefix/);
});

test("hostnames follow juno to a new address", async () => {
  let current = ["192.168.1.50"];
  const list = createAllowlist({
    allowedIps: [],
    allowedHostnames: ["juno.local"],
    hostnameRefreshSeconds: 60,
    lookup: async () => current,
    log: quiet,
  });
  await list.refresh();
  assert.equal(list.isAllowed("192.168.1.50"), true);
  assert.equal(list.isAllowed("192.168.1.77"), false);

  current = ["192.168.1.77"];
  await list.refresh();
  assert.equal(list.isAllowed("192.168.1.77"), true);
  assert.equal(list.isAllowed("192.168.1.50"), false);
});

test("a DNS failure keeps the last known address instead of locking juno out", async () => {
  let fail = false;
  const list = createAllowlist({
    allowedIps: [],
    allowedHostnames: ["juno.local"],
    hostnameRefreshSeconds: 60,
    lookup: async () => {
      if (fail) throw new Error("ENOTFOUND");
      return ["192.168.1.50"];
    },
    log: quiet,
  });
  await list.refresh();
  fail = true;
  await list.refresh();
  assert.equal(list.isAllowed("192.168.1.50"), true);
});

test("check() re-resolves on a miss so a fresh IP gets in", async () => {
  let current = ["192.168.1.50"];
  const list = createAllowlist({
    allowedIps: [],
    allowedHostnames: ["juno.local"],
    hostnameRefreshSeconds: 3600,
    lookup: async () => current,
    log: quiet,
  });
  current = ["192.168.1.99"];
  assert.equal(await list.check("192.168.1.99"), true);
});

/**
 * @param {string} remoteAddress
 * @param {string} [ip]
 */
function fakeReq(remoteAddress, ip) {
  return /** @type {any} */ ({ socket: { remoteAddress }, ip, method: "GET", originalUrl: "/" });
}

function fakeRes() {
  const res = /** @type {any} */ ({
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    type() {
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  });
  return res;
}

test("middleware blocks strangers with 403 and lets allowed machines through", async () => {
  const list = createAllowlist({ allowedIps: ["192.168.1.20"], allowedHostnames: [], hostnameRefreshSeconds: 60, log: quiet });
  const mw = allowlistMiddleware(list, { trustProxy: false, log: quiet });

  const blocked = fakeRes();
  let nextCalled = false;
  mw(fakeReq("203.0.113.9"), blocked, () => (nextCalled = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(blocked.statusCode, 403);
  assert.equal(nextCalled, false);

  const ok = fakeRes();
  await new Promise((resolve) => mw(fakeReq("::ffff:192.168.1.20"), ok, () => resolve(undefined)));
  assert.equal(ok.statusCode, 200);
});

test("X-Forwarded-For style req.ip is ignored unless TRUST_PROXY is on", async () => {
  const list = createAllowlist({ allowedIps: ["192.168.1.20"], allowedHostnames: [], hostnameRefreshSeconds: 60, log: quiet });

  const spoofed = fakeRes();
  allowlistMiddleware(list, { trustProxy: false, log: quiet })(fakeReq("203.0.113.9", "192.168.1.20"), spoofed, () => {});
  await new Promise((r) => setImmediate(r));
  assert.equal(spoofed.statusCode, 403);

  const proxied = fakeRes();
  await new Promise((resolve) =>
    allowlistMiddleware(list, { trustProxy: 1, log: quiet })(fakeReq("10.9.9.9", "192.168.1.20"), proxied, () => resolve(undefined)),
  );
  assert.equal(proxied.statusCode, 200);
});
