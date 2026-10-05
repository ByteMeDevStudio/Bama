'use strict';

/* Grocery Buddy: a shopping list, deals notebook and grocery budget.
   All data lives on the phone (window.Android bridge, or localStorage when the
   page is opened in a desktop browser for testing). */

// ---------------------------------------------------------------------------
// Storage

const STORAGE_KEY = 'grocery-buddy';

const storage = {
  load() {
    try {
      const raw = window.Android ? window.Android.load(STORAGE_KEY) : localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  save(data) {
    const raw = JSON.stringify(data);
    try {
      if (window.Android) window.Android.save(STORAGE_KEY, raw);
      else localStorage.setItem(STORAGE_KEY, raw);
    } catch (e) {
      toast('Could not save. Is the phone out of space?');
    }
  },
};

// Columbia, AL 36319 stores. Details can be changed on the Stores screen.
function defaultStores() {
  return [
    {
      id: 'pig',
      name: 'Piggly Wiggly',
      address: '119 E Church St, Columbia, AL 36319',
      phone: '(334) 696-2070',
      hours: '7 AM – 8 PM',
      adUrl: 'https://www.wallstreetmarketsllc.com/sale-ads',
      couponUrl: '',
    },
    {
      id: 'dg-church',
      name: 'Dollar General (Church St)',
      address: '211 W Church St, Columbia, AL 36319',
      phone: '(334) 403-5275',
      hours: '8 AM – 10 PM',
      adUrl: 'https://www.dollargeneral.com/weekly-ads',
      couponUrl: 'https://www.dollargeneral.com/deals/coupons',
    },
    {
      id: 'dg-green',
      name: 'Dollar General (Green Dr)',
      address: '100 Green Dr, Columbia, AL 36319',
      phone: '(334) 696-4220',
      hours: '8 AM – 10 PM',
      adUrl: 'https://www.dollargeneral.com/weekly-ads',
      couponUrl: 'https://www.dollargeneral.com/deals/coupons',
    },
  ];
}

function freshState() {
  return {
    version: 1,
    settings: { textSize: 1, budget: 0 },
    stores: defaultStores(),
    items: [],
    deals: [],
    trips: [],
    known: {},
  };
}

function loadState() {
  const saved = storage.load();
  const base = freshState();
  if (!saved || typeof saved !== 'object') return base;
  return {
    version: 1,
    settings: Object.assign(base.settings, saved.settings),
    stores: Array.isArray(saved.stores) ? saved.stores : base.stores,
    items: Array.isArray(saved.items) ? saved.items : [],
    deals: Array.isArray(saved.deals) ? saved.deals : [],
    trips: Array.isArray(saved.trips) ? saved.trips : [],
    known: saved.known && typeof saved.known === 'object' ? saved.known : {},
  };
}

let state = loadState();
let tab = 'list';
let moneyMonth = monthKey(today());
let dialogOnClose = null;

function commit() {
  storage.save(state);
  render();
}

// ---------------------------------------------------------------------------
// Helpers

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function money(n) {
  return (n < 0 ? '-$' : '$') + Math.abs(round2(n || 0)).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "3.49", "$3.49", "3" -> 3.49 / 3. Blank or junk -> null. */
function parseMoney(text) {
  const cleaned = String(text || '').replace(/[$,\s]/g, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? round2(n) : null;
}

function moneyField(n) {
  return n == null ? '' : round2(n).toFixed(2);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function monthKey(date) {
  return date.slice(0, 7);
}

function shiftMonth(key, by) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

function monthName(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function niceDate(date) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function storeById(id) {
  return state.stores.find((s) => s.id === id) || null;
}

function storeName(id) {
  const s = storeById(id);
  return s ? s.name : 'Any store';
}

function storeOptions(selected, allowAny) {
  const opts = state.stores.map((s) =>
    `<option value="${esc(s.id)}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`);
  if (allowAny) opts.unshift(`<option value=""${!selected ? ' selected' : ''}>Any store</option>`);
  return opts.join('');
}

function itemCost(item) {
  return item.price == null ? 0 : item.price * (item.qty || 1);
}

function itemSaving(item) {
  if (item.price == null || item.regular == null || item.regular <= item.price) return 0;
  return (item.regular - item.price) * (item.qty || 1);
}

function isExpired(deal) {
  return !!deal.ends && deal.ends < today();
}

function openUrl(url) {
  if (!url) return;
  if (window.Android) window.Android.openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

function mapsUrl(address) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
}

/** Learn an item's last price and store; `added` counts it toward "usually buy". */
function remember(item, added) {
  const key = item.name.trim().toLowerCase();
  if (!key) return;
  const prev = state.known[key] || { count: 0 };
  state.known[key] = {
    name: item.name.trim(),
    price: item.price != null ? item.price : prev.price,
    storeId: item.storeId || prev.storeId || '',
    count: Math.max(1, prev.count + (added ? 1 : 0)),
  };
}

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

// ---------------------------------------------------------------------------
// Toast (with optional Undo)

let toastTimer = null;
let toastUndo = null;

function toast(message, undo) {
  const el = document.getElementById('toast');
  toastUndo = undo || null;
  el.innerHTML = `<span>${esc(message)}</span>` + (undo ? '<button type="button" data-act="undo">Undo</button>' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; toastUndo = null; }, undo ? 7000 : 3500);
}

// ---------------------------------------------------------------------------
// Dialog

function openDialog(title, body, onClose) {
  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-body').innerHTML = body;
  document.getElementById('dialog').hidden = false;
  dialogOnClose = onClose || null;
  const first = document.querySelector('#dialog-body [autofocus]');
  if (first) setTimeout(() => first.focus(), 50);
}

function closeDialog() {
  const el = document.getElementById('dialog');
  if (el.hidden) return;
  el.hidden = true;
  document.getElementById('dialog-body').innerHTML = '';
  const cb = dialogOnClose;
  dialogOnClose = null;
  if (cb) cb();
}

function confirmBox(title, message, yesLabel, onYes) {
  openDialog(title, `
    <p>${esc(message)}</p>
    <div class="dialog-actions">
      <button type="button" class="btn" data-act="close">No, keep it</button>
      <button type="button" class="btn danger primary" data-act="confirm-yes">${esc(yesLabel)}</button>
    </div>`);
  actions['confirm-yes'] = () => { closeDialog(); onYes(); };
}

// ---------------------------------------------------------------------------
// Screens

const TITLES = { list: 'My List', deals: 'Deals', money: 'Money', stores: 'Stores' };

function render() {
  document.documentElement.className = 'size-' + state.settings.textSize;
  document.getElementById('title').textContent = TITLES[tab];
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const screen = document.getElementById('screen');
  const scroll = screen.dataset.tab === tab ? screen.scrollTop : 0;
  screen.innerHTML = SCREENS[tab]();
  screen.dataset.tab = tab;
  screen.scrollTop = scroll;
}

const SCREENS = {
  list() {
    const items = state.items;
    let html = `
      <form class="add-bar" data-form="add-item" autocomplete="off">
        <input type="text" id="new-item" placeholder="Add an item" aria-label="New item" enterkeyhint="done">
        <button type="submit" class="btn primary">Add</button>
      </form>`;
    if (Object.keys(state.known).length) {
      html += '<p><button type="button" class="btn wide" data-act="pick-usual">&#11088; Pick from things I usually buy</button></p>';
    }
    if (!items.length) {
      return html + `<div class="empty"><p><strong>Your list is empty.</strong></p>
        <p>Type an item above and press <strong>Add</strong>.</p>
        <p>Or look at <strong>Deals</strong> for this week's sales.</p></div>`;
    }

    // Group by store, in the order stores are listed, with "Any store" last.
    const groups = state.stores.map((s) => ({ id: s.id, name: s.name, items: [] }));
    const anyGroup = { id: '', name: 'Any store', items: [] };
    items.forEach((it) => {
      const g = groups.find((x) => x.id === it.storeId) || anyGroup;
      g.items.push(it);
    });
    groups.push(anyGroup);
    groups.filter((g) => g.items.length).forEach((g) => {
      html += `<div class="group-title">${esc(g.name)}</div>`;
      g.items.forEach((it) => { html += itemRow(it); });
    });

    const total = items.reduce((t, it) => t + itemCost(it), 0);
    const cart = items.filter((it) => it.checked);
    const cartTotal = cart.reduce((t, it) => t + itemCost(it), 0);
    const unpriced = items.filter((it) => it.price == null).length;
    html += `<div class="total"><span>Estimated total</span><strong>${money(total)}</strong></div>`;
    if (unpriced) {
      html += `<p class="muted small">${unpriced} item${unpriced > 1 ? 's have' : ' has'} no price yet. Tap <strong>Change</strong> to add one.</p>`;
    }
    const budget = state.settings.budget;
    if (budget > 0) {
      const left = budget - spentIn(monthKey(today()));
      html += `<p class="muted small">Budget left this month: <strong>${money(left)}</strong></p>`;
    }
    html += '<div class="stack" style="margin-top:1rem">';
    if (cart.length) {
      html += `<button type="button" class="btn primary wide" data-act="finish">&#10004; Done shopping (${cart.length} in cart, ${money(cartTotal)})</button>`;
      html += '<button type="button" class="btn wide" data-act="clear-checked">Take checked items off the list</button>';
    } else {
      html += '<p class="muted small center">Tap the box next to each item as you put it in your cart.</p>';
    }
    html += '<button type="button" class="btn wide" data-act="share-list">&#9993; Send this list to someone</button>';
    html += '</div>';
    return html;
  },

  deals() {
    let html = '<h2>This week\'s ads</h2>';
    // Stores of one chain share an ad (both Dollar Generals), so show it once.
    const seen = new Set();
    const withAds = state.stores.filter((s) => {
      const key = s.adUrl || s.couponUrl;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!withAds.length) {
      html += '<p class="muted">Add an ad link to a store on the <strong>Stores</strong> screen.</p>';
    }
    withAds.forEach((s) => {
      const shared = state.stores.filter((x) => x !== s && (x.adUrl || x.couponUrl) === (s.adUrl || s.couponUrl)).length;
      const name = shared ? s.name.replace(/\s*\(.*\)\s*$/, '') : s.name;
      html += `<div class="card"><h3>${esc(name)}</h3><div class="row">`;
      if (s.adUrl) html += `<button type="button" class="btn primary" data-act="open-url" data-url="${esc(s.adUrl)}">See weekly ad</button>`;
      if (s.couponUrl) html += `<button type="button" class="btn" data-act="open-url" data-url="${esc(s.couponUrl)}">Digital coupons</button>`;
      html += '</div></div>';
    });
    html += `<p class="muted small">The ad opens in your web browser. Press the phone's Back button to come back here.
      When you see a good deal, save it below so it's easy to add to your list.</p>`;

    html += '<h2>Deals I saved</h2>';
    html += '<button type="button" class="btn primary wide" data-act="deal-new">+ Save a deal I saw</button>';
    const current = state.deals.filter((d) => !isExpired(d));
    const old = state.deals.filter(isExpired);
    if (!current.length) {
      html += '<div class="empty" style="margin-top:0.6rem">No deals saved yet.</div>';
    }
    current
      .slice()
      .sort((a, b) => (a.ends || '9999').localeCompare(b.ends || '9999'))
      .forEach((d) => { html += dealCard(d, false); });
    if (old.length) {
      html += `<h2>Ended deals</h2>
        <button type="button" class="btn wide danger" data-act="deal-clear-old">Remove ${old.length} ended deal${old.length > 1 ? 's' : ''}</button>`;
      old.forEach((d) => { html += dealCard(d, true); });
    }
    return html;
  },

  money() {
    const key = moneyMonth;
    const trips = state.trips.filter((t) => monthKey(t.date) === key)
      .sort((a, b) => b.date.localeCompare(a.date));
    const spent = spentIn(key);
    const saved = trips.reduce((t, x) => t + (x.saved || 0), 0);
    const budget = state.settings.budget;
    const isNow = key === monthKey(today());

    let html = `
      <div class="month-nav">
        <button type="button" class="btn" data-act="month" data-by="-1" aria-label="Earlier month">&#9664;</button>
        <strong>${esc(monthName(key))}</strong>
        <button type="button" class="btn" data-act="month" data-by="1" aria-label="Later month"${isNow ? ' disabled style="visibility:hidden"' : ''}>&#9654;</button>
      </div>`;

    html += `<div class="card"><p>Spent on groceries</p><div class="big-number">${money(spent)}</div>`;
    if (budget > 0) {
      const pct = Math.min(100, Math.round((spent / budget) * 100));
      const over = spent > budget;
      html += `<p>of your ${money(budget)} monthly budget</p>
        <div class="bar${over ? ' over' : ''}" role="img" aria-label="${pct}% of budget used"><div style="width:${pct}%"></div></div>
        <div class="big-number ${over ? 'bad' : 'good'}">${over ? money(spent - budget) + ' over' : money(budget - spent) + ' left'}</div>`;
    } else {
      html += '<p class="muted">Set a monthly budget to see how much you have left.</p>';
    }
    if (saved > 0) html += `<p><span class="tag">SAVED</span> <strong>${money(saved)}</strong> with deals this month</p>`;
    html += '</div>';

    html += `<div class="stack">
      <button type="button" class="btn primary wide" data-act="trip-new">+ Write down a receipt</button>
      <button type="button" class="btn wide" data-act="budget">${budget > 0 ? 'Change' : 'Set'} my monthly budget</button>
    </div>`;

    html += '<h2>Receipts</h2>';
    if (!trips.length) {
      html += '<div class="empty">No receipts for this month.</div>';
    } else {
      html += '<div class="card">';
      trips.forEach((t) => {
        html += `<div class="line">
          <span><strong>${esc(niceDate(t.date))}</strong><br><span class="small muted">${esc(storeName(t.storeId))}</span></span>
          <span style="text-align:right"><strong>${money(t.amount)}</strong><br>
            <button type="button" class="edit btn" style="min-height:2.2rem;padding:0.1rem 0.6rem;font-size:0.85rem" data-act="trip-edit" data-id="${esc(t.id)}">Change</button></span>
        </div>`;
      });
      html += '</div>';

      const byStore = {};
      trips.forEach((t) => { byStore[t.storeId || ''] = (byStore[t.storeId || ''] || 0) + t.amount; });
      html += '<h2>By store</h2><div class="card">';
      Object.keys(byStore).sort((a, b) => byStore[b] - byStore[a]).forEach((id) => {
        html += `<div class="line"><span>${esc(storeName(id))}</span><strong>${money(byStore[id])}</strong></div>`;
      });
      html += '</div>';
    }

    html += '<h2>Past months</h2><div class="card">';
    for (let i = 0; i < 6; i++) {
      const k = shiftMonth(monthKey(today()), -i);
      const s = spentIn(k);
      const over = budget > 0 && s > budget;
      html += `<div class="line"><span>${esc(monthName(k))}</span><strong${over ? ' style="color:var(--warn)"' : ''}>${money(s)}</strong></div>`;
    }
    html += '</div>';
    return html;
  },

  stores() {
    let html = '';
    state.stores.forEach((s) => {
      html += `<div class="card"><h3>${esc(s.name)}</h3>`;
      if (s.address) html += `<p>${esc(s.address)}</p>`;
      if (s.hours) html += `<p class="muted">Open ${esc(s.hours)}</p>`;
      if (s.phone) html += `<p class="muted">${esc(s.phone)}</p>`;
      html += '<div class="row" style="margin-top:0.5rem">';
      if (s.phone) html += `<button type="button" class="btn" data-act="open-url" data-url="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">&#128222; Call</button>`;
      if (s.address) html += `<button type="button" class="btn" data-act="open-url" data-url="${esc(mapsUrl(s.address))}">&#128205; Directions</button>`;
      if (s.adUrl) html += `<button type="button" class="btn" data-act="open-url" data-url="${esc(s.adUrl)}">Weekly ad</button>`;
      html += `<button type="button" class="btn" data-act="store-edit" data-id="${esc(s.id)}">Change</button>`;
      html += '</div></div>';
    });
    html += `<p class="muted small">Store hours and phone numbers can change. Tap <strong>Change</strong> to fix anything that's out of date.</p>
      <button type="button" class="btn primary wide" data-act="store-new">+ Add a store</button>

      <h2>Keep your information safe</h2>
      <p class="muted small">Everything stays on this phone. Nothing is sent anywhere unless you choose to send it.</p>
      <div class="stack">
        <button type="button" class="btn wide" data-act="backup">Send myself a backup copy</button>
        <button type="button" class="btn wide" data-act="restore">Bring back a backup copy</button>
      </div>`;
    return html;
  },
};

function itemRow(it) {
  const parts = [];
  if ((it.qty || 1) > 1) parts.push(`${it.qty} &times; ${it.price != null ? money(it.price) : 'no price'}`);
  else if (it.price != null) parts.push(money(it.price));
  const saving = itemSaving(it);
  const meta = parts.join(' · ') + (saving > 0 ? ` <span class="tag">DEAL &minus;${money(saving)}</span>` : '');
  return `
    <div class="item${it.checked ? ' done' : ''}">
      <button type="button" class="check" data-act="toggle" data-id="${esc(it.id)}" role="checkbox"
        aria-checked="${it.checked ? 'true' : 'false'}" aria-label="In cart: ${esc(it.name)}">${it.checked ? '&#10003;' : ''}</button>
      <div class="item-main">
        <div class="item-name">${esc(it.name)}</div>
        ${meta ? `<div class="item-meta">${meta}</div>` : ''}
      </div>
      <button type="button" class="edit" data-act="item-edit" data-id="${esc(it.id)}">Change</button>
    </div>`;
}

function dealCard(d, expired) {
  const onList = state.items.some((it) => it.dealId === d.id);
  let html = `<div class="card deal${expired ? ' expired' : ''}">
    <h3>${esc(d.name)}</h3>
    <div class="price">${money(d.price)}${d.note ? ` <span class="small">${esc(d.note)}</span>` : ''}</div>`;
  if (d.regular != null && d.regular > d.price) {
    html += `<p class="small">Usually ${money(d.regular)}, you save <strong>${money(d.regular - d.price)}</strong></p>`;
  }
  html += `<p class="small muted">${esc(storeName(d.storeId))}${d.ends ? ` · ${expired ? 'Ended' : 'Ends'} ${esc(niceDate(d.ends))}` : ''}</p>`;
  html += '<div class="row">';
  if (!expired) {
    html += onList
      ? '<span class="btn" aria-disabled="true">&#10003; On my list</span>'
      : `<button type="button" class="btn primary" data-act="deal-add" data-id="${esc(d.id)}">Add to my list</button>`;
  }
  html += `<button type="button" class="btn" data-act="deal-edit" data-id="${esc(d.id)}">Change</button></div></div>`;
  return html;
}

function spentIn(key) {
  return state.trips.filter((t) => monthKey(t.date) === key).reduce((s, t) => s + (t.amount || 0), 0);
}

// ---------------------------------------------------------------------------
// Dialog forms

function qtyField(qty) {
  return `<label for="f-qty">How many</label>
    <div class="row" style="flex-wrap:nowrap">
      <button type="button" class="btn" data-act="qty" data-by="-1" aria-label="One less">&minus;</button>
      <input type="text" inputmode="numeric" id="f-qty" value="${qty || 1}" style="text-align:center">
      <button type="button" class="btn" data-act="qty" data-by="1" aria-label="One more">+</button>
    </div>`;
}

function moneyInput(id, value, label) {
  return `<label for="${id}">${label}</label>
    <div class="money-input"><input type="text" inputmode="decimal" id="${id}" value="${moneyField(value)}" placeholder="0.00"></div>`;
}

function itemDialog(it) {
  openDialog('Change item', `
    <label for="f-name">Item</label>
    <input type="text" id="f-name" value="${esc(it.name)}">
    ${qtyField(it.qty)}
    ${moneyInput('f-price', it.price, 'Price for one (if you know it)')}
    <label for="f-store">Where to buy it</label>
    <select id="f-store">${storeOptions(it.storeId, true)}</select>
    <div class="dialog-actions">
      <button type="button" class="btn" data-act="close">Cancel</button>
      <button type="button" class="btn primary" data-act="item-save" data-id="${esc(it.id)}">Save</button>
    </div>
    <button type="button" class="btn wide danger" style="margin-top:0.8rem" data-act="item-remove" data-id="${esc(it.id)}">Take off my list</button>`);
}

function dealDialog(d) {
  const isNew = !d;
  d = d || { name: '', storeId: state.stores[0] ? state.stores[0].id : '', price: null, regular: null, ends: '', note: '' };
  openDialog(isNew ? 'Save a deal' : 'Change deal', `
    <label for="f-name">What is on sale</label>
    <input type="text" id="f-name" value="${esc(d.name)}" placeholder="Like: Bounty paper towels"${isNew ? ' autofocus' : ''}>
    <label for="f-store">Store</label>
    <select id="f-store">${storeOptions(d.storeId, true)}</select>
    <div class="two">
      <div>${moneyInput('f-price', d.price, 'Sale price')}</div>
      <div>${moneyInput('f-regular', d.regular, 'Usual price')}</div>
    </div>
    <label for="f-note">Notes (optional)</label>
    <input type="text" id="f-note" value="${esc(d.note)}" placeholder="Like: 2 for $5, or digital coupon">
    <label for="f-ends">Last day of the sale (optional)</label>
    <input type="date" id="f-ends" value="${esc(d.ends)}">
    <div class="dialog-actions">
      <button type="button" class="btn" data-act="close">Cancel</button>
      <button type="button" class="btn primary" data-act="deal-save" data-id="${isNew ? '' : esc(d.id)}">Save</button>
    </div>
    ${isNew ? '' : `<button type="button" class="btn wide danger" style="margin-top:0.8rem" data-act="deal-remove" data-id="${esc(d.id)}">Delete this deal</button>`}`);
}

function tripDialog(t, prefill) {
  const isNew = !t;
  t = t || Object.assign({ date: today(), storeId: '', amount: null, saved: 0 }, prefill || {});
  openDialog(isNew ? (prefill ? 'Done shopping' : 'Write down a receipt') : 'Change receipt', `
    ${prefill ? '<p>Check the total on your receipt and fix it if it is different.</p>' : ''}
    ${moneyInput('f-amount', t.amount, 'Total you paid')}
    <label for="f-store">Store</label>
    <select id="f-store">${storeOptions(t.storeId, true)}</select>
    <label for="f-date">Date</label>
    <input type="date" id="f-date" value="${esc(t.date)}">
    <div class="dialog-actions">
      <button type="button" class="btn" data-act="close">Cancel</button>
      <button type="button" class="btn primary" data-act="trip-save" data-id="${isNew ? '' : esc(t.id)}" data-finish="${prefill ? '1' : ''}">Save</button>
    </div>
    ${isNew ? '' : `<button type="button" class="btn wide danger" style="margin-top:0.8rem" data-act="trip-remove" data-id="${esc(t.id)}">Delete this receipt</button>`}`);
}

function storeDialog(s) {
  const isNew = !s;
  s = s || { name: '', address: '', phone: '', hours: '', adUrl: '', couponUrl: '' };
  openDialog(isNew ? 'Add a store' : 'Change store', `
    <label for="f-name">Store name</label>
    <input type="text" id="f-name" value="${esc(s.name)}"${isNew ? ' autofocus' : ''}>
    <label for="f-address">Address</label>
    <input type="text" id="f-address" value="${esc(s.address)}">
    <label for="f-phone">Phone</label>
    <input type="text" inputmode="tel" id="f-phone" value="${esc(s.phone)}">
    <label for="f-hours">Hours</label>
    <input type="text" id="f-hours" value="${esc(s.hours)}" placeholder="Like: 7 AM – 9 PM">
    <label for="f-ad">Weekly ad web address</label>
    <input type="text" inputmode="url" id="f-ad" value="${esc(s.adUrl)}" placeholder="https://">
    <label for="f-coupon">Coupons web address</label>
    <input type="text" inputmode="url" id="f-coupon" value="${esc(s.couponUrl)}" placeholder="https://">
    <div class="dialog-actions">
      <button type="button" class="btn" data-act="close">Cancel</button>
      <button type="button" class="btn primary" data-act="store-save" data-id="${isNew ? '' : esc(s.id)}">Save</button>
    </div>
    ${isNew ? '' : `<button type="button" class="btn wide danger" style="margin-top:0.8rem" data-act="store-remove" data-id="${esc(s.id)}">Remove this store</button>`}`);
}

function usualDialog() {
  const known = Object.values(state.known).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 60);
  const onList = new Set(state.items.map((it) => it.name.trim().toLowerCase()));
  const buttons = known.map((k) => {
    const has = onList.has(k.name.toLowerCase());
    return `<button type="button" class="btn wide${has ? ' primary' : ''}" data-act="usual-add" data-name="${esc(k.name)}" aria-pressed="${has}">
      ${has ? '&#10003; ' : '+ '}${esc(k.name)}${k.price != null ? ` <span class="small">(${money(k.price)})</span>` : ''}</button>`;
  }).join('');
  openDialog('Things I usually buy', `
    <p class="muted small">Tap an item to put it on your list.</p>
    <div class="stack choice-list">${buttons}</div>
    <div class="dialog-actions"><button type="button" class="btn primary" data-act="close">Done</button></div>`);
}

function cleanUrl(text) {
  const t = text.trim();
  if (!t) return '';
  return /^https?:\/\//i.test(t) ? t : 'https://' + t;
}

// ---------------------------------------------------------------------------
// Actions

function addItem(name, extra) {
  name = name.trim();
  if (!name) return null;
  const memory = state.known[name.toLowerCase()] || {};
  const item = Object.assign({
    id: newId(),
    name,
    qty: 1,
    price: memory.price != null ? memory.price : null,
    regular: null,
    storeId: memory.storeId && storeById(memory.storeId) ? memory.storeId : '',
    checked: false,
    dealId: null,
  }, extra || {});
  state.items.push(item);
  remember(item, true);
  return item;
}

function snapshot() {
  return JSON.stringify(state);
}

function undoTo(snap) {
  return () => { state = JSON.parse(snap); commit(); };
}

const actions = {
  close: closeDialog,
  undo() {
    const fn = toastUndo;
    document.getElementById('toast').hidden = true;
    toastUndo = null;
    if (fn) fn();
  },
  'open-url'(d) { openUrl(d.url); },

  // List
  toggle(d) {
    const it = state.items.find((x) => x.id === d.id);
    if (!it) return;
    it.checked = !it.checked;
    commit();
  },
  'item-edit'(d) {
    const it = state.items.find((x) => x.id === d.id);
    if (it) itemDialog(it);
  },
  qty(d) {
    const el = document.getElementById('f-qty');
    const n = Math.max(1, (parseInt(el.value, 10) || 1) + Number(d.by));
    el.value = n;
  },
  'item-save'(d) {
    const it = state.items.find((x) => x.id === d.id);
    if (!it) return closeDialog();
    const name = val('f-name');
    if (!name) return toast('Please type the item name.');
    const priceText = val('f-price');
    const price = parseMoney(priceText);
    if (priceText && price == null) return toast('That price does not look right.');
    it.name = name;
    it.qty = Math.max(1, parseInt(val('f-qty'), 10) || 1);
    it.price = price;
    if (price == null) it.regular = null;
    it.storeId = val('f-store');
    remember(it, false);
    closeDialog();
    commit();
  },
  'item-remove'(d) {
    const snap = snapshot();
    const it = state.items.find((x) => x.id === d.id);
    state.items = state.items.filter((x) => x.id !== d.id);
    closeDialog();
    commit();
    if (it) toast(`Took ${it.name} off the list.`, undoTo(snap));
  },
  'clear-checked'() {
    const snap = snapshot();
    const n = state.items.filter((x) => x.checked).length;
    state.items = state.items.filter((x) => !x.checked);
    commit();
    toast(`Took ${n} item${n > 1 ? 's' : ''} off the list.`, undoTo(snap));
  },
  finish() {
    const cart = state.items.filter((x) => x.checked);
    const total = round2(cart.reduce((t, it) => t + itemCost(it), 0));
    // Suggest the store most of the cart was planned for.
    const counts = {};
    cart.forEach((it) => { if (it.storeId) counts[it.storeId] = (counts[it.storeId] || 0) + 1; });
    const storeId = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
    tripDialog(null, { amount: total > 0 ? total : null, storeId });
  },
  'share-list'() {
    const lines = ['Grocery list'];
    const groups = {};
    state.items.filter((it) => !it.checked).forEach((it) => {
      const g = storeName(it.storeId);
      (groups[g] = groups[g] || []).push(it);
    });
    Object.keys(groups).forEach((g) => {
      lines.push('', g + ':');
      groups[g].forEach((it) => lines.push('• ' + it.name + ((it.qty || 1) > 1 ? ' (' + it.qty + ')' : '')));
    });
    if (lines.length === 1) return toast('Nothing left to buy on the list.');
    shareText(lines.join('\n'));
  },
  'pick-usual': usualDialog,
  'usual-add'(d, el) {
    const key = d.name.toLowerCase();
    const known = state.known[key];
    const existing = state.items.find((it) => it.name.trim().toLowerCase() === key);
    if (existing) state.items = state.items.filter((it) => it !== existing);
    else addItem(d.name);
    storage.save(state);
    render();
    // Update just this button so the box keeps its scroll position.
    const has = !existing;
    el.classList.toggle('primary', has);
    el.setAttribute('aria-pressed', has ? 'true' : 'false');
    el.innerHTML = (has ? '&#10003; ' : '+ ') + esc(known ? known.name : d.name)
      + (known && known.price != null ? ` <span class="small">(${money(known.price)})</span>` : '');
  },

  // Deals
  'deal-new'() { dealDialog(null); },
  'deal-edit'(d) {
    const deal = state.deals.find((x) => x.id === d.id);
    if (deal) dealDialog(deal);
  },
  'deal-save'(d) {
    const name = val('f-name');
    if (!name) return toast('Please type what is on sale.');
    const price = parseMoney(val('f-price'));
    if (price == null) return toast('Please type the sale price.');
    const regularText = val('f-regular');
    const regular = parseMoney(regularText);
    if (regularText && regular == null) return toast('That usual price does not look right.');
    const fields = { name, price, regular, storeId: val('f-store'), note: val('f-note'), ends: val('f-ends') };
    if (d.id) {
      const deal = state.deals.find((x) => x.id === d.id);
      if (deal) Object.assign(deal, fields);
      // Keep a matching list item's price in step with the deal.
      state.items.filter((it) => it.dealId === d.id).forEach((it) => {
        Object.assign(it, { name, price, regular, storeId: fields.storeId });
      });
    } else {
      state.deals.push(Object.assign({ id: newId() }, fields));
    }
    closeDialog();
    commit();
    toast('Deal saved.');
  },
  'deal-add'(d) {
    const deal = state.deals.find((x) => x.id === d.id);
    if (!deal) return;
    addItem(deal.name, { price: deal.price, regular: deal.regular, storeId: deal.storeId, dealId: deal.id });
    commit();
    toast(`Added ${deal.name} to your list.`);
  },
  'deal-remove'(d) {
    const deal = state.deals.find((x) => x.id === d.id);
    closeDialog();
    if (!deal) return;
    const snap = snapshot();
    state.deals = state.deals.filter((x) => x.id !== d.id);
    commit();
    toast('Deal deleted.', undoTo(snap));
  },
  'deal-clear-old'() {
    const snap = snapshot();
    state.deals = state.deals.filter((x) => !isExpired(x));
    commit();
    toast('Ended deals removed.', undoTo(snap));
  },

  // Money
  month(d) {
    const next = shiftMonth(moneyMonth, Number(d.by));
    if (next > monthKey(today())) return;
    moneyMonth = next;
    render();
  },
  budget() {
    openDialog('Monthly grocery budget', `
      <p>How much do you want to spend on groceries each month?</p>
      ${moneyInput('f-budget', state.settings.budget || null, 'Budget')}
      <div class="dialog-actions">
        <button type="button" class="btn" data-act="close">Cancel</button>
        <button type="button" class="btn primary" data-act="budget-save">Save</button>
      </div>`);
    setTimeout(() => { const el = document.getElementById('f-budget'); if (el) el.focus(); }, 50);
  },
  'budget-save'() {
    const text = val('f-budget');
    const n = text ? parseMoney(text) : 0;
    if (n == null) return toast('That amount does not look right.');
    state.settings.budget = n;
    closeDialog();
    commit();
  },
  'trip-new'() { tripDialog(null); },
  'trip-edit'(d) {
    const t = state.trips.find((x) => x.id === d.id);
    if (t) tripDialog(t);
  },
  'trip-save'(d) {
    const amount = parseMoney(val('f-amount'));
    if (amount == null) return toast('Please type the total you paid.');
    const date = val('f-date') || today();
    const storeId = val('f-store');
    if (d.id) {
      const t = state.trips.find((x) => x.id === d.id);
      if (t) Object.assign(t, { amount, date, storeId });
    } else {
      const trip = { id: newId(), date, storeId, amount, saved: 0, itemCount: 0 };
      if (d.finish) {
        const cart = state.items.filter((x) => x.checked);
        trip.saved = round2(cart.reduce((s, it) => s + itemSaving(it), 0));
        trip.itemCount = cart.length;
        state.items = state.items.filter((x) => !x.checked);
      }
      state.trips.push(trip);
    }
    closeDialog();
    moneyMonth = monthKey(date) <= monthKey(today()) ? monthKey(date) : monthKey(today());
    commit();
    const budget = state.settings.budget;
    const spent = spentIn(monthKey(today()));
    toast(budget > 0 ? `Saved. ${money(budget - spent)} left this month.` : 'Receipt saved.');
  },
  'trip-remove'(d) {
    closeDialog();
    const snap = snapshot();
    state.trips = state.trips.filter((x) => x.id !== d.id);
    commit();
    toast('Receipt deleted.', undoTo(snap));
  },

  // Stores
  'store-new'() { storeDialog(null); },
  'store-edit'(d) {
    const s = storeById(d.id);
    if (s) storeDialog(s);
  },
  'store-save'(d) {
    const name = val('f-name');
    if (!name) return toast('Please type the store name.');
    const fields = {
      name,
      address: val('f-address'),
      phone: val('f-phone'),
      hours: val('f-hours'),
      adUrl: cleanUrl(val('f-ad')),
      couponUrl: cleanUrl(val('f-coupon')),
    };
    if (d.id) Object.assign(storeById(d.id) || {}, fields);
    else state.stores.push(Object.assign({ id: newId() }, fields));
    closeDialog();
    commit();
  },
  'store-remove'(d) {
    const s = storeById(d.id);
    if (!s) return closeDialog();
    confirmBox('Remove store?', `Remove ${s.name}? Items and receipts for this store will be kept.`, 'Remove', () => {
      const snap = snapshot();
      state.stores = state.stores.filter((x) => x.id !== d.id);
      commit();
      toast('Store removed.', undoTo(snap));
    });
  },
  backup() {
    shareText('Grocery Buddy backup ' + today() + '\n' + JSON.stringify(state));
  },
  restore() {
    openDialog('Bring back a backup', `
      <p>Paste the backup text you sent yourself. This replaces what is on this phone now.</p>
      <textarea id="f-backup" rows="5" aria-label="Backup text"></textarea>
      <div class="dialog-actions">
        <button type="button" class="btn" data-act="close">Cancel</button>
        <button type="button" class="btn primary" data-act="restore-save">Bring it back</button>
      </div>`);
  },
  'restore-save'() {
    const text = val('f-backup');
    const start = text.indexOf('{');
    let data = null;
    try { data = JSON.parse(text.slice(start)); } catch (e) { data = null; }
    if (start < 0 || !data || !Array.isArray(data.items) || !Array.isArray(data.trips)) {
      return toast('That does not look like a Grocery Buddy backup.');
    }
    const snap = snapshot();
    storage.save(data);
    state = loadState();
    closeDialog();
    commit();
    toast('Backup brought back.', undoTo(snap));
  },
};

function shareText(text) {
  if (window.Android) {
    window.Android.share(text);
  } else if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('Copied.'));
  }
}

// ---------------------------------------------------------------------------
// Wiring

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tabs button');
  if (tabBtn) {
    tab = tabBtn.dataset.tab;
    if (tab === 'money') moneyMonth = monthKey(today());
    closeDialog();
    render();
    document.getElementById('screen').scrollTop = 0;
    return;
  }
  if (e.target === document.getElementById('dialog')) {
    closeDialog();
    return;
  }
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act] && !el.disabled) {
    e.preventDefault();
    actions[el.dataset.act](el.dataset, el);
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-form="add-item"]');
  if (!form) return;
  e.preventDefault();
  const input = document.getElementById('new-item');
  const item = addItem(input.value);
  if (!item) {
    toast('Type an item first, like milk.');
    input.focus();
    return;
  }
  commit();
  toast(`Added ${item.name}.`);
  const again = document.getElementById('new-item');
  if (again) again.focus();
});

document.getElementById('smaller').addEventListener('click', () => {
  state.settings.textSize = Math.max(0, state.settings.textSize - 1);
  commit();
});
document.getElementById('bigger').addEventListener('click', () => {
  state.settings.textSize = Math.min(3, state.settings.textSize + 1);
  commit();
});

// Called by the phone's Back button. Returns true if the app handled it.
window.appBack = function appBack() {
  if (!document.getElementById('dialog').hidden) {
    closeDialog();
    return true;
  }
  if (tab !== 'list') {
    tab = 'list';
    render();
    return true;
  }
  return false;
};

render();
