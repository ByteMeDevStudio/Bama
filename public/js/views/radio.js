import { getConfig, getJson } from "../api.js";
import { html, mount } from "../html.js";
import { kickoff, opponentOf, teamName } from "../format.js";
import { MAX_DELAY, radio } from "../radio-player.js";

const OFFICIAL = [
  { label: "RollTide.com", url: "https://rolltide.com/", note: "Alabama Athletics' official site. Look for Listen Live on game days." },
  { label: "SiriusXM", url: "https://www.siriusxm.com/", note: "SEC games on satellite radio and in the SXM app." },
  {
    label: "TuneIn",
    url: "https://tunein.com/search/?query=Crimson%20Tide%20Sports%20Network",
    note: "Find a Crimson Tide Sports Network affiliate station.",
  },
];

/** @param {import("../app.js").ViewContext} ctx */
export async function radioView(ctx) {
  const [config, schedule] = await Promise.all([getConfig(), getJson("/api/schedule").catch(() => null)]);
  if (!ctx.isCurrent()) return;

  const featuredId = schedule?.featured?.gameId;
  const game = featuredId ? schedule.games.find((/** @type {any} */ g) => g.id === featuredId) : null;
  const src = config.radio.proxied ? "/api/radio/stream" : config.radio.directUrl;
  const delayable = Boolean(config.radio.proxied);

  mount(
    ctx.view,
    html`
      <div class="page-head"><h1>Crimson Tide radio</h1></div>

      ${game
        ? html`<p class="muted">${game.status.state === "in" ? "On now: " : "Next broadcast: "}<strong><span class="vs">${opponentOf(game).prefix}</span> ${teamName(opponentOf(game).opponent)}</strong> · ${kickoff(game.date, game.timeTbd)}</p>`
        : ""}

      ${config.radio.configured
        ? html`<section class="card radio">
            <div class="radio-main">
              <button type="button" class="btn primary big" id="play">▶ Listen live</button>
              <div>
                <strong>Crimson Tide Sports Network</strong>
                <p class="muted" id="radio-status">Stopped</p>
              </div>
            </div>
            <label class="slider">
              <span>Volume</span>
              <input type="range" id="volume" min="0" max="1" step="0.05" />
            </label>
            <div class="sync">
              <label class="slider">
                <span>Delay to sync with TV: <strong id="delay-label"></strong></span>
                <input type="range" id="delay" min="0" max="${MAX_DELAY}" step="1" ${delayable ? "" : html`disabled`} />
              </label>
              <div class="nudge">
                ${[-5, -1, 1, 5].map((n) => html`<button type="button" class="btn small" data-nudge="${n}" ${delayable ? "" : html`disabled`}>${n > 0 ? `+${n}` : n}s</button>`)}
              </div>
              <p class="muted small">
                ${delayable
                  ? "Radio usually runs ahead of the TV picture. Slide the delay until the call matches what you see. Streaming TV often needs 30 to 60 seconds; antenna or cable, a few seconds."
                  : "The delay needs the stream to come through Bama Hub. Set RADIO_PROXY=true in .env to turn it on."}
              </p>
            </div>
          </section>`
        : html`<section class="card">
            <h2>Set up the in-app player</h2>
            <p>
              The Crimson Tide Sports Network doesn't publish a public API, so Bama Hub plays a stream URL you provide. Put the
              live-audio URL you're entitled to use in <code>RADIO_STREAM_URL</code> in the .env file and restart. Until then,
              use the official options below.
            </p>
          </section>`}

      <section class="card">
        <h2>Official ways to listen</h2>
        <div class="watch-list">
          ${OFFICIAL.map(
            (o) => html`<a class="watch-option" href="${o.url}" target="_blank" rel="noopener noreferrer"><span class="watch-label">${o.label}</span><small>${o.note}</small></a>`,
          )}
          <div class="watch-option"><span class="watch-label">Varsity Network app</span><small>Learfield's app for official college radio broadcasts. Search for it in your app store.</small></div>
          <div class="watch-option free"><span class="watch-label"><span class="free-tag">FREE</span> AM/FM radio</span><small>Every game airs on Crimson Tide Sports Network affiliate stations around Alabama.</small></div>
        </div>
      </section>
    `,
  );

  if (!config.radio.configured || !src) return;

  const play = /** @type {HTMLButtonElement} */ (ctx.view.querySelector("#play"));
  const statusEl = /** @type {HTMLElement} */ (ctx.view.querySelector("#radio-status"));
  const volume = /** @type {HTMLInputElement} */ (ctx.view.querySelector("#volume"));
  const delay = /** @type {HTMLInputElement} */ (ctx.view.querySelector("#delay"));
  const delayLabel = /** @type {HTMLElement} */ (ctx.view.querySelector("#delay-label"));

  let on = false;
  const unsubscribe = radio.subscribe((s) => {
    on = s.status === "playing" || s.status === "connecting";
    play.textContent = on ? "■ Stop" : "▶ Listen live";
    statusEl.textContent =
      s.status === "playing" ? "Live" : s.status === "connecting" ? "Connecting…" : s.status === "error" ? (s.error ?? "Unavailable") : "Stopped";
    statusEl.classList.toggle("error-text", s.status === "error");
    volume.value = String(s.volume);
    delay.value = String(s.delay);
    delayLabel.textContent = `${s.delay}s`;
  });
  // The player keeps going when you leave the page; only the controls go away.
  ctx.onCleanup(unsubscribe);

  play.addEventListener("click", () => {
    if (on) radio.stop();
    else void radio.play(src, { delayable });
  });
  volume.addEventListener("input", () => radio.setVolume(Number(volume.value)));
  delay.addEventListener("input", () => radio.setDelay(Number(delay.value)));
  for (const btn of ctx.view.querySelectorAll("[data-nudge]")) {
    btn.addEventListener("click", () => radio.setDelay(Number(delay.value) + Number(btn.getAttribute("data-nudge"))));
  }
}
