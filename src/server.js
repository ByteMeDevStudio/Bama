import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config.js";
import { createApp } from "./app.js";
import { createAllowlist } from "./security/ipAllowlist.js";
import { TtlCache } from "./lib/cache.js";
import { createEspnClient } from "./sources/espn.js";
import { createCfbdClient } from "./sources/cfbd.js";
import { loadKnowledge } from "./sources/knowledge.js";
import { createToolkit } from "./ai/tools.js";
import { createChatService } from "./ai/chat.js";

const here = path.dirname(fileURLToPath(import.meta.url));

try {
  process.loadEnvFile(path.join(here, "..", ".env"));
} catch {
  // No .env file: rely on the real environment.
}

const config = loadConfig();
const cache = new TtlCache();

const allowlist = createAllowlist(config.security);
const espn = createEspnClient({ cache, teamId: config.team.espnId, provider: config.watch.provider });
const cfbd = createCfbdClient({ cache, ...config.cfbd });
const knowledge = await loadKnowledge(path.join(here, "..", "data", "knowledge"));
const toolkit = createToolkit({ espn, cfbd, knowledge, webSearch: config.ai.webSearch });

// The SDK finds credentials in ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN, or
// an `ant auth login` profile).
const aiCredentials = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
const chat = createChatService({
  client: new Anthropic(),
  toolkit,
  model: config.ai.model,
  effort: config.ai.effort,
  timeZone: config.timeZone,
  maxTurns: config.ai.maxTurnsPerConversation,
  rateLimitPerHour: config.ai.rateLimitPerHour,
});

await allowlist.start();
const app = createApp({ config, espn, cfbd, chat, aiCredentials, allowlist });

const server = app.listen(config.port, config.host, () => {
  const allowed = ["this machine", ...config.security.allowedIps, ...config.security.allowedHostnames];
  console.log(`Bama Hub running at http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`);
  console.log(`  Accepting connections from: ${allowed.join(", ")}`);
  if (config.host === "127.0.0.1" && (config.security.allowedIps.length || config.security.allowedHostnames.length)) {
    console.log("  Note: HOST=127.0.0.1 only listens locally. Set HOST=0.0.0.0 so juno can reach it over the network.");
  }
  if (!aiCredentials) console.log("  Tide AI: no ANTHROPIC_API_KEY set, so chat will not work until you add one.");
  if (!cfbd.configured) console.log("  CollegeFootballData: no CFBD_API_KEY set, so history/stats lookups are off.");
  console.log(`  Knowledge base: ${knowledge.size} sections loaded.`);
});

for (const signal of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
  process.on(signal, () => {
    allowlist.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
