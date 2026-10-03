// Hash router: each view gets a context with route params and a way to
// register cleanup (timers, audio) that runs when you navigate away.

import { mount } from "./html.js";
import { errorCard, loadingCard } from "./format.js";
import { homeView } from "./views/home.js";
import { scheduleView } from "./views/schedule.js";
import { gameView } from "./views/game.js";
import { scoresView } from "./views/scores.js";
import { pollsView } from "./views/polls.js";
import { watchView } from "./views/watch.js";
import { radioView } from "./views/radio.js";
import { aiView } from "./views/ai.js";

/**
 * @typedef {{
 *   view: HTMLElement,
 *   params: string[],
 *   query: URLSearchParams,
 *   onCleanup: (fn: () => void) => void,
 *   isCurrent: () => boolean,
 * }} ViewContext
 */

/** @type {[RegExp, string, (ctx: ViewContext) => Promise<void> | void][]} */
const routes = [
  [/^\/$/, "home", homeView],
  [/^\/schedule$/, "schedule", scheduleView],
  [/^\/game\/(\d+)$/, "schedule", gameView],
  [/^\/scores$/, "scores", scoresView],
  [/^\/polls$/, "polls", pollsView],
  [/^\/watch$/, "watch", watchView],
  [/^\/radio$/, "radio", radioView],
  [/^\/ai$/, "ai", aiView],
];

/** @type {(() => void)[]} */
let cleanups = [];
let navToken = 0;

async function navigate() {
  for (const fn of cleanups) {
    try {
      fn();
    } catch {
      // keep going
    }
  }
  cleanups = [];
  const token = ++navToken;

  const [path, search = ""] = (location.hash.replace(/^#/, "") || "/").split("?");
  const view = /** @type {HTMLElement} */ (document.getElementById("view"));
  const route = routes.find(([re]) => re.test(path));

  for (const link of document.querySelectorAll("[data-nav]")) {
    const active = route && link.getAttribute("data-nav") === route[1];
    link.classList.toggle("active", Boolean(active));
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  mount(view, loadingCard());
  if (!route) {
    mount(view, errorCard(new Error("That page doesn't exist.")));
    return;
  }

  /** @type {ViewContext} */
  const ctx = {
    view,
    params: /** @type {RegExpExecArray} */ (route[0].exec(path)).slice(1),
    query: new URLSearchParams(search),
    onCleanup: (fn) => {
      if (token === navToken) cleanups.push(fn);
      else fn();
    },
    isCurrent: () => token === navToken,
  };
  try {
    await route[2](ctx);
  } catch (err) {
    if (ctx.isCurrent()) mount(view, errorCard(err));
  }
  if (ctx.isCurrent()) window.scrollTo({ top: 0 });
}

// Inline onerror handlers are blocked by the CSP, so catch image failures here.
document.addEventListener(
  "error",
  (e) => {
    if (e.target instanceof HTMLImageElement) e.target.classList.add("img-failed");
  },
  true,
);

window.addEventListener("hashchange", navigate);
navigate();
