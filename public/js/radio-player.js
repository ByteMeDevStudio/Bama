// One radio player for the whole app, so the call keeps playing while you
// move between pages. When the stream comes through the Bama Hub relay
// (same-origin), it runs through a Web Audio delay line so you can hold the
// radio back to match a TV picture that's running behind.

import { store } from "./format.js";

export const MAX_DELAY = 170; // seconds; Web Audio delay lines top out just under 180

/**
 * @typedef {{ status: "stopped" | "connecting" | "playing" | "error", delay: number, volume: number, delayable: boolean, error: string | null }} RadioState
 */

/** @type {RadioState} */
const state = {
  status: "stopped",
  delay: clamp(Number(store.get("radio.delay")) || 0, 0, MAX_DELAY),
  volume: clamp(Number(store.get("radio.volume") ?? 0.9), 0, 1),
  delayable: false,
  error: null,
};

/** @type {Set<(s: RadioState) => void>} */
const listeners = new Set();
/** @type {HTMLAudioElement | null} */
let audio = null;
/** @type {AudioContext | null} */
let context = null;
/** @type {DelayNode | null} */
let delayNode = null;
/** @type {GainNode | null} */
let gainNode = null;

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 */
function clamp(n, lo, hi) {
  return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : lo;
}

function emit() {
  for (const fn of listeners) fn({ ...state });
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "none";
  audio.addEventListener("playing", () => {
    state.status = "playing";
    state.error = null;
    emit();
  });
  audio.addEventListener("waiting", () => {
    if (state.status !== "stopped") {
      state.status = "connecting";
      emit();
    }
  });
  audio.addEventListener("error", () => {
    if (state.status === "stopped") return;
    state.status = "error";
    state.error = "The stream isn't available right now. It's usually live from about an hour before kickoff.";
    emit();
  });
  return audio;
}

/** Builds the delay graph the first time (needs a user gesture). */
function ensureGraph() {
  if (context) return;
  const el = ensureAudio();
  context = new AudioContext();
  const source = context.createMediaElementSource(el);
  delayNode = context.createDelay(MAX_DELAY + 1);
  gainNode = context.createGain();
  delayNode.delayTime.value = state.delay;
  gainNode.gain.value = state.volume;
  source.connect(delayNode).connect(gainNode).connect(context.destination);
}

export const radio = {
  /** @param {(s: RadioState) => void} fn */
  subscribe(fn) {
    listeners.add(fn);
    fn({ ...state });
    return () => listeners.delete(fn);
  },

  /**
   * @param {string} src
   * @param {{ delayable: boolean }} options  true when the stream is same-origin
   */
  async play(src, { delayable }) {
    const el = ensureAudio();
    state.delayable = delayable;
    if (delayable) {
      ensureGraph();
      await context?.resume();
    } else {
      el.volume = state.volume;
    }
    // A fresh connection each time starts at the live edge.
    el.src = `${src}${src.includes("?") ? "&" : "?"}t=${Date.now()}`;
    state.status = "connecting";
    state.error = null;
    emit();
    try {
      await el.play();
    } catch {
      state.status = "error";
      state.error = "Couldn't start the stream.";
      emit();
    }
  },

  stop() {
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load(); // drops the network connection
    }
    state.status = "stopped";
    emit();
  },

  /** @param {number} seconds */
  setDelay(seconds) {
    state.delay = clamp(Math.round(seconds), 0, MAX_DELAY);
    store.set("radio.delay", String(state.delay));
    if (delayNode && context) delayNode.delayTime.setTargetAtTime(state.delay, context.currentTime, 0.05);
    emit();
  },

  /** @param {number} volume 0..1 */
  setVolume(volume) {
    state.volume = clamp(volume, 0, 1);
    store.set("radio.volume", String(state.volume));
    if (gainNode) gainNode.gain.value = state.volume;
    if (audio && !state.delayable) audio.volume = state.volume;
    emit();
  },
};

// A small "now playing" bar at the bottom of every page while radio is on.
const bar = document.createElement("div");
bar.className = "miniplayer";
bar.hidden = true;
bar.innerHTML =
  '<span class="dot"></span><a href="#/radio" class="mini-title">Crimson Tide radio</a><span class="mini-status"></span><button type="button" class="btn small">Stop</button>';
bar.querySelector("button")?.addEventListener("click", () => radio.stop());
document.body.append(bar);
radio.subscribe((s) => {
  bar.hidden = s.status === "stopped";
  const status = /** @type {HTMLElement} */ (bar.querySelector(".mini-status"));
  status.textContent =
    s.status === "playing"
      ? s.delayable && s.delay
        ? `Live · ${s.delay}s delay`
        : "Live"
      : s.status === "connecting"
        ? "Connecting…"
        : "Unavailable";
});
