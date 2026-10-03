// Reads settings from the environment (and .env, if present) into one object.

/** @param {string | undefined} value */
function list(value) {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string | undefined} value
 * @param {boolean} fallback
 */
function bool(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/**
 * @param {string | undefined} value
 * @param {number} fallback
 */
function int(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Express's "trust proxy" setting. Off by default so X-Forwarded-For can't be
 * used to spoof an allowed address. Accepts a hop count or a list of proxy
 * addresses. "true" means one hop: trusting every hop would let a client put
 * juno's address in X-Forwarded-For and walk in.
 * @param {string | undefined} value
 * @returns {false | number | string[]}
 */
function trustProxy(value) {
  if (!value || value.toLowerCase() === "false" || value === "0") return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value.toLowerCase() === "true") return 1;
  return list(value);
}

const EFFORTS = /** @type {const} */ (["low", "medium", "high", "xhigh", "max"]);

export const PROVIDERS = /** @type {const} */ ([
  "espn",
  "youtubetv",
  "hulu",
  "fubo",
  "sling",
  "directv",
  "antenna",
]);

/** @param {NodeJS.ProcessEnv} env */
export function loadConfig(env = process.env) {
  const provider = (env.WATCH_PROVIDER ?? "espn").toLowerCase();
  return {
    host: env.HOST || "127.0.0.1",
    port: int(env.PORT, 3000),
    timeZone: env.TZ_DISPLAY || "America/Chicago",

    security: {
      // Addresses or CIDR ranges allowed to connect. Loopback is always allowed
      // so the app can be used from the machine it runs on.
      allowedIps: list(env.ALLOWED_IPS),
      // Hostnames (e.g. "juno.local" or a dynamic-DNS name) re-resolved on an
      // interval, so the allowlist follows juno if its IP changes.
      allowedHostnames: list(env.ALLOWED_HOSTNAMES),
      hostnameRefreshSeconds: int(env.ALLOWED_HOSTNAMES_REFRESH_SECONDS, 300),
      trustProxy: trustProxy(env.TRUST_PROXY),
    },

    team: {
      espnId: env.ESPN_TEAM_ID || "333",
      cfbdName: env.CFBD_TEAM_NAME || "Alabama",
    },

    cfbd: {
      apiKey: env.CFBD_API_KEY || "",
      baseUrl: env.CFBD_BASE_URL || "https://api.collegefootballdata.com",
    },

    ai: {
      model: env.CLAUDE_MODEL || "claude-opus-5-5",
      effort: EFFORTS.find((e) => e === env.CLAUDE_EFFORT?.toLowerCase()) ?? "medium",
      webSearch: bool(env.AI_WEB_SEARCH, true),
      maxTurnsPerConversation: int(env.AI_MAX_TURNS, 40),
      rateLimitPerHour: int(env.AI_RATE_LIMIT_PER_HOUR, 60),
    },

    radio: {
      // A live-audio URL you are entitled to use (e.g. the stream behind the
      // official "Listen Live" player). Left empty, the Radio page shows the
      // official places to listen instead.
      streamUrl: env.RADIO_STREAM_URL || "",
      proxy: bool(env.RADIO_PROXY, true),
    },

    watch: {
      provider: /** @type {(typeof PROVIDERS)[number]} */ (
        PROVIDERS.includes(/** @type {any} */ (provider)) ? provider : "espn"
      ),
    },
  };
}

/** @typedef {ReturnType<typeof loadConfig>} Config */
