import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @param {string} name */
export function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(here, "fixtures", name), "utf8"));
}

/**
 * A fetch stand-in that answers from a route table and records every URL.
 * @param {Record<string, unknown> | ((url: string) => unknown)} routes  URL substring -> JSON body
 */
export function fakeFetch(routes) {
  /** @type {{ url: string, init?: RequestInit }[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fn = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    const body =
      typeof routes === "function"
        ? routes(url)
        : Object.entries(routes).find(([key]) => url.includes(key))?.[1];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return Object.assign(fn, { calls });
}
