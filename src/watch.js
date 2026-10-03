// Turns a game's TV listing ("ABC", "SECN", "ESPN+", ...) into the legitimate
// ways to watch it. Nothing here streams video itself: ABC/ESPN don't offer a
// third-party streaming API, so the app sends you to the official app/site and
// points out when a free antenna is enough.

const ESPN_GAME_URL = "https://www.espn.com/college-football/game/_/gameId/";
const ANTENNA_MAP_URL = "https://www.fcc.gov/media/engineering/dtvmaps";

/** @type {Record<string, string>} */
const ALIASES = {
  "SEC NETWORK": "SECN",
  "SEC NETWORK+": "SECN+",
  "SECN PLUS": "SECN+",
  "ESPN PLUS": "ESPN+",
  "ACC NETWORK": "ACCN",
  "BIG TEN NETWORK": "BTN",
  "FOX SPORTS 1": "FS1",
};

/**
 * @typedef {"broadcast" | "cable" | "streaming"} NetworkKind
 * @typedef {{ kind: NetworkKind, app: { label: string, url: string | null, note: string } }} NetworkInfo
 */

/** @type {Record<string, NetworkInfo>} */
const NETWORKS = {
  ABC: {
    kind: "broadcast",
    app: {
      label: "ESPN app (ESPN on ABC)",
      url: null,
      note: "Stream with your TV-provider login or an ESPN subscription.",
    },
  },
  ESPN: espnFamily(),
  ESPN2: espnFamily(),
  ESPNU: espnFamily(),
  ESPNEWS: espnFamily(),
  SECN: espnFamily(),
  ACCN: espnFamily(),
  "ESPN+": {
    kind: "streaming",
    app: { label: "ESPN app (ESPN+)", url: null, note: "Streaming-only: needs an ESPN+ or ESPN subscription." },
  },
  "SECN+": {
    kind: "streaming",
    app: { label: "ESPN app (SEC Network+)", url: null, note: "Streams on ESPN+; needs an ESPN+ or ESPN subscription." },
  },
  CBS: {
    kind: "broadcast",
    app: { label: "Paramount+", url: "https://www.paramountplus.com/", note: "Paramount+ plans with live CBS." },
  },
  FOX: {
    kind: "broadcast",
    app: { label: "FOX Sports app", url: "https://www.foxsports.com/live", note: "TV-provider login or a FOX streaming plan." },
  },
  FS1: {
    kind: "cable",
    app: { label: "FOX Sports app", url: "https://www.foxsports.com/live", note: "TV-provider login or a FOX streaming plan." },
  },
  BTN: {
    kind: "cable",
    app: { label: "FOX Sports app", url: "https://www.foxsports.com/live", note: "TV-provider login." },
  },
  NBC: {
    kind: "broadcast",
    app: { label: "Peacock", url: "https://www.peacocktv.com/", note: "NBC games also stream on Peacock." },
  },
  PEACOCK: {
    kind: "streaming",
    app: { label: "Peacock", url: "https://www.peacocktv.com/", note: "Streaming-only: needs a Peacock subscription." },
  },
  CW: {
    kind: "broadcast",
    app: { label: "The CW app", url: "https://www.cwtv.com/", note: "Free in the CW app in most markets." },
  },
};

function espnFamily() {
  return /** @type {NetworkInfo} */ ({
    kind: "cable",
    app: {
      label: "ESPN app",
      url: null,
      note: "Stream with your TV-provider login or an ESPN subscription.",
    },
  });
}

/** Live-TV streaming services the user can pick as "my provider". */
export const PROVIDER_LINKS = {
  espn: null,
  antenna: null,
  youtubetv: { label: "YouTube TV", url: "https://tv.youtube.com/" },
  hulu: { label: "Hulu + Live TV", url: "https://www.hulu.com/live-tv" },
  fubo: { label: "Fubo", url: "https://www.fubo.tv/" },
  sling: { label: "Sling TV", url: "https://watch.sling.com/" },
  directv: { label: "DIRECTV", url: "https://www.directv.com/" },
};

/** @param {string} name */
export function normalizeNetwork(name) {
  const upper = name.trim().toUpperCase();
  return ALIASES[upper] ?? upper;
}

/**
 * @typedef {{ label: string, url: string | null, note: string, kind: "free" | "subscription" | "info" }} WatchOption
 */

/**
 * @param {{ id: string, broadcasts: string[] }} game
 * @param {keyof typeof PROVIDER_LINKS} provider
 * @returns {WatchOption[]}
 */
export function watchOptions(game, provider) {
  /** @type {WatchOption[]} */
  const options = [];
  const networks = game.broadcasts.map(normalizeNetwork);
  const espnGame = ESPN_GAME_URL + encodeURIComponent(game.id);

  if (networks.length === 0) {
    return [
      {
        label: "TV network not announced yet",
        url: espnGame,
        note: "SEC networks are often set 6–12 days before kickoff. Check back.",
        kind: "info",
      },
    ];
  }

  const seen = new Set();
  /** @param {WatchOption} option */
  const add = (option) => {
    const key = `${option.label}|${option.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push(option);
  };

  for (const network of networks) {
    const info = NETWORKS[network];
    if (info?.kind === "broadcast") {
      add({
        label: `Over the air on ${network}`,
        url: ANTENNA_MAP_URL,
        note: `${network} is a broadcast network: an antenna (one-time purchase) picks up your local affiliate for free.`,
        kind: "free",
      });
    }
    const link = provider === "antenna" ? null : PROVIDER_LINKS[provider];
    if (link && info?.kind !== "streaming") {
      add({
        label: `${link.label}: ${network}`,
        url: link.url,
        note: `Check that your ${link.label} plan carries ${network}.`,
        kind: "subscription",
      });
    }
    if (info) {
      add({ label: info.app.label, url: info.app.url ?? espnGame, note: info.app.note, kind: "subscription" });
    } else {
      add({ label: `Find ${network}`, url: espnGame, note: "ESPN's game page lists where it streams.", kind: "info" });
    }
  }
  return options;
}
