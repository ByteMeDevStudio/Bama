import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { allowlistMiddleware } from "./security/ipAllowlist.js";
import { securityHeaders } from "./security/headers.js";
import { createApiRouter } from "./routes/api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(here, "..", "public");

/**
 * @param {Parameters<typeof createApiRouter>[0] & {
 *   allowlist: ReturnType<typeof import("./security/ipAllowlist.js").createAllowlist>,
 * }} deps
 */
export function createApp(deps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", deps.config.security.trustProxy);

  // First thing: anyone not on the allowlist gets a 403 and nothing else.
  app.use(allowlistMiddleware(deps.allowlist, { trustProxy: deps.config.security.trustProxy }));
  app.use(securityHeaders());
  app.use("/api", createApiRouter(deps));
  app.use(express.static(PUBLIC_DIR, { index: "index.html", maxAge: "5m" }));
  return app;
}
