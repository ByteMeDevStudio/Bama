import { getJson } from "../api.js";
import { html, mount } from "../html.js";
import { ALABAMA_ID, logo } from "../format.js";

/** @param {import("../app.js").ViewContext} ctx */
export async function pollsView(ctx) {
  const polls = await getJson("/api/rankings");
  if (!ctx.isCurrent()) return;
  if (!polls.length) {
    mount(ctx.view, html`<h1>Polls</h1><div class="card"><p class="muted">No polls are out right now.</p></div>`);
    return;
  }
  const index = Math.min(Math.max(Number(ctx.query.get("poll")) || 0, 0), polls.length - 1);
  const poll = polls[index];

  mount(
    ctx.view,
    html`
      <div class="page-head"><h1>Polls</h1></div>
      <nav class="tabs" aria-label="Polls">
        ${polls.map(
          (/** @type {any} */ p, /** @type {number} */ i) =>
            html`<a href="${i === 0 ? "#/polls" : `#/polls?poll=${i}`}" class="${i === index ? "active" : ""}">${p.shortName}</a>`,
        )}
      </nav>
      <section class="card">
        <h2>${poll.headline || poll.name}</h2>
        <div class="table-wrap">
          <table class="poll">
            <thead><tr><th>#</th><th>Team</th><th>Record</th><th>Pts</th><th>Prev</th></tr></thead>
            <tbody>
              ${poll.ranks.map(
                (/** @type {any} */ r) => html`<tr class="${r.team.id === ALABAMA_ID ? "highlight" : ""}">
                  <td class="num">${r.rank}</td>
                  <td><span class="poll-team">${logo(r.team, 24)} ${r.team.name}${r.firstPlaceVotes ? html` <small class="muted">(${r.firstPlaceVotes})</small>` : ""}</span></td>
                  <td>${r.record ?? ""}</td>
                  <td>${r.points ?? ""}</td>
                  <td>${movement(r)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </section>
    `,
  );
}

/** @param {any} r */
function movement(r) {
  if (!r.previous) return html`<span class="muted">NR</span>`;
  const change = r.previous - r.rank;
  if (change > 0) return html`${r.previous} <span class="up">▲${change}</span>`;
  if (change < 0) return html`${r.previous} <span class="down">▼${-change}</span>`;
  return html`${r.previous}`;
}
