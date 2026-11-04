// The Shop tab (Stage 2K): a featured banner for the best item of the day, the daily shop (6 items, a new set
// every day at the same time, with a countdown), the Limited section (skins on sale for a few days only) and the
// crate (with its odds and everything inside). Every card shows its gun in 3D, slowly turning (shopCards.js).
// Buying is two clicks (the price button asks to confirm); the server decides prices and what you get.

import { SKINS, RARITIES, CRATE_RARITIES } from '../../shared/skins.js';
import { CHARMS } from '../../shared/charms.js';
import { WEAPONS } from '../../shared/weapons.js';
import { getShop, buyShopItem, devMoney } from './account.js';
import { ShopCards } from './shopCards.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n).toLocaleString();

/** "5h 12m 04s", "3d 4h". */
function countdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${h}h ${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

const gunNames = (guns) => guns.map((g) => WEAPONS[g]?.name || g).join(', ');

export class ShopView {
  /** onOpenCrate(): play the crate opening (menu.js); setAccount(profile): store a new profile. */
  constructor({ getAccount, setAccount, onOpenCrate }) {
    this.getAccount = getAccount;
    this.setAccount = setAccount;
    this.onOpenCrate = onOpenCrate;
    this.cards = new ShopCards();
    this.data = null;          // the server's shop: { daily, limited, crate, resetsAt, now }
    this.clockOffset = 0;      // server time - local time
    this.message = '';
    this.messageError = false;
    this.confirming = null;    // the item id whose price button is asking "sure?"
    this.showContents = {};    // which crates have their contents opened out
    this.root = $('shop-wrap');
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('mouseleave', () => { if (this.confirming) { this.confirming = null; this.updateButtons(); } });
    setInterval(() => this.tick(), 1000);
  }

  /** The tab was opened or closed. */
  async setVisible(on) {
    this.visible = on;
    this.cards.setActive(on);
    if (!on) return;
    if (!this.data || Date.now() + this.clockOffset >= this.data.resetsAt) await this.load();
    else this.render();
  }

  async load() {
    const res = await getShop();
    if (res.error) { this.root.innerHTML = `<div class="card"><h2>Shop</h2><p class="error">${esc(res.error)}</p></div>`; return; }
    this.data = res;
    this.clockOffset = res.now - Date.now();
    if (this.visible) this.render();
  }

  /** The Christmas dates changed something: forget the shop so the crate comes or goes. */
  christmasChanged() {
    if (!this.data) return;
    if (this.visible) this.load(); else this.data = null;
  }

  /** The account changed (Money, owned skins): redraw prices and OWNED labels without reloading the 3D. */
  accountChanged() {
    if (this.visible && this.data) this.updateButtons();
  }

  // ---------------------------------------------------------------- drawing

  render() {
    const a = this.getAccount(), d = this.data;
    if (!a || !d) return;
    const [featured, ...rest] = d.daily;
    this.root.innerHTML = `
      <div class="shop-top">
        <div><h2>Shop</h2><span class="muted">Everything here is bought with Money, never Polish Money.</span></div>
        <div class="shop-balance">💰 <b id="shop-money">${money(a.money)}</b> Money</div>
      </div>
      ${featured ? this.featuredHtml(featured) : ''}
      <div class="shop-section"><h3>Daily shop</h3><span class="shop-timer">New items in <b id="shop-reset">${countdown(d.resetsAt - (Date.now() + this.clockOffset))}</b></span></div>
      <div class="shop-cards">${rest.map((it) => this.cardHtml(it)).join('')}</div>
      ${d.limited.length ? `<div class="shop-section"><h3>Limited</h3><span class="muted">Only for a few days, then gone for good. Owned on every gun.</span></div>
      <div class="shop-cards">${d.limited.map((it) => this.cardHtml(it, true)).join('')}</div>` : ''}
      ${d.christmasCrate ? `<div class="shop-section"><h3>Christmas crate</h3><span class="shop-timer">Gone in <b data-until="${d.christmasCrate.until}">${countdown(d.christmasCrate.until - Date.now() - this.clockOffset)}</b></span></div>
      ${this.crateHtml('christmas', d.christmasCrate, 'Christmas Crate', '10 Christmas skins and 10 Christmas charms')}` : ''}
      <div class="shop-section"><h3>Crate</h3><span class="muted">Every crate skin on any gun, and every charm</span></div>
      ${this.crateHtml('crate', d.crate, 'The Crate', 'A skin on a random gun, or a charm')}
      <p id="shop-msg" class="${this.messageError ? 'error' : 'shop-ok'}">${esc(this.message)}</p>
      ${a.devTools ? '<div class="dev-box"><span class="muted small-note">Local test database only.</span> <button type="button" data-dev-money>+10,000 Money</button></div>' : ''}`;
    // Every card's 3D view
    const views = [...this.root.querySelectorAll('canvas[data-view]')].map((canvas) => {
      const it = this.item(canvas.dataset.view);
      return it === 'crate' || it === 'christmas' ? { canvas, crate: it, guns: [] } : { canvas, skin: it.skin, guns: it.guns === undefined ? ['rifle'] : it.guns };
    });
    this.cards.setCards(views);
    this.updateButtons();
  }

  item(id) {
    if (id === 'crate' || id === 'christmas') return id;
    return this.data.daily.find((x) => x.id === id) || this.data.limited.find((x) => x.id === id);
  }

  featuredHtml(it) {
    const s = SKINS[it.skin], r = RARITIES[it.rarity];
    return `
      <div class="shop-featured shop-card r-${it.rarity}" data-card="${it.id}" style="--rar:${r.color}">
        <div class="sf-view"><canvas data-view="${it.id}"></canvas></div>
        <div class="sf-info">
          <span class="sf-tag">★ FEATURED TODAY</span>
          <div class="sf-name">${esc(s.name)}</div>
          <div class="sf-sub" style="color:${r.color}">${r.name}${it.pack ? ` · Skin pack for ${it.guns.length} guns` : ''}</div>
          <div class="sf-guns muted">${esc(gunNames(it.guns))}</div>
          ${this.buyButton(it)}
        </div>
      </div>`;
  }

  cardHtml(it, limited = false) {
    const s = SKINS[it.skin], r = RARITIES[it.rarity];
    const where = limited ? 'All guns' : it.pack ? `${it.guns.length}-gun pack` : WEAPONS[it.guns[0]]?.name;
    return `
      <div class="shop-card r-${it.rarity}${limited ? ' limited' : ''}" data-card="${it.id}" style="--rar:${r.color}">
        <div class="sc-view"><canvas data-view="${it.id}"></canvas>
          ${it.pack ? `<span class="sc-badge">PACK · ${it.guns.length} GUNS</span>` : ''}
          ${limited ? `<span class="sc-badge limited">LIMITED · <span data-until="${it.until}">${countdown(it.until - Date.now() - this.clockOffset)}</span> left</span>` : ''}
          <span class="sc-owned">OWNED</span>
        </div>
        <div class="sc-info">
          <div class="sc-name">${esc(s.name)}</div>
          <div class="sc-sub"><span style="color:${r.color}">${r.name}</span> · ${esc(where)}</div>
          ${it.pack ? `<div class="sc-guns muted">${esc(gunNames(it.guns))}</div>` : ''}
          ${this.buyButton(it)}
        </div>
      </div>`;
  }

  buyButton(it) { return `<button type="button" class="sc-price" data-buy="${it.id}"></button>`; }

  /** A crate's card, odds and contents. `key` is what the buttons name it by: 'crate' or 'christmas'. */
  crateHtml(key, c, title, sub) {
    const odds = CRATE_RARITIES.map((r) => `
      <div class="odds-row"><span style="color:${r.color}">● ${r.name}</span><b>${Math.round(c.odds[r.id] * 100)}%</b></div>`).join('');
    const contents = CRATE_RARITIES.map((r) => `
      <div class="detail-sub" style="color:${r.color}">${r.name}</div>
      <div class="crate-skins">${c.contents.skins[r.id].map((id) => `<span class="crate-skin" style="--rar:${r.color}">${esc(SKINS[id].name)} skin</span>`).join('')}
      ${c.contents.charms[r.id].map((id) => `<span class="crate-skin charm" style="--rar:${r.color}">${esc(CHARMS[id].name)} charm</span>`).join('')}</div>`).join('');
    return `
      <div class="shop-crate${key === 'christmas' ? ' christmas' : ''}">
        <div class="shop-card crate-card-big" data-card="${key}" style="--rar:#f0b43c">
          <div class="sc-view"><canvas data-view="${key}"></canvas></div>
          <div class="sc-info"><div class="sc-name">${esc(title)}</div><div class="sc-sub muted">${esc(sub)}</div>
            <button type="button" class="sc-price" data-open-crate="${key}"></button></div>
        </div>
        <div class="crate-odds">
          <div class="detail-sub">Odds</div>${odds}
          <p class="muted small-note">First the rarity, then a charm (${Math.round(c.charmChance * 100)}%) or a skin on a random gun (${Math.round((1 - c.charmChance) * 100)}%). Anything you already own gives back ${money(c.refund)} Money (half the price).</p>
          <button type="button" class="ghost small" data-toggle-contents="${key}">${this.showContents[key] ? 'Hide' : 'Show'} everything inside</button>
          <div class="crate-contents${this.showContents[key] ? '' : ' hidden'}">${contents}</div>
        </div>
      </div>`;
  }

  /** Prices, OWNED labels and the confirm step, from the latest account and shop data. */
  updateButtons() {
    const a = this.getAccount(), d = this.data;
    if (!a || !d || !this.root.isConnected) return;
    const m = $('shop-money');
    if (m) m.textContent = money(a.money);
    for (const b of this.root.querySelectorAll('[data-buy]')) {
      const it = this.item(b.dataset.buy), owned = this.owns(a, it), price = this.priceOf(a, it);
      const card = b.closest('[data-card]');
      card?.classList.toggle('owned', owned);
      b.disabled = owned;
      b.classList.toggle('confirm', this.confirming === it.id);
      b.classList.toggle('short', !owned && a.money < price);
      b.innerHTML = owned ? 'OWNED' : this.confirming === it.id ? `Buy for 💰 ${money(price)}?` : `💰 ${money(price)}${price < (it.fullPrice || it.price) ? ` <s>${money(it.fullPrice || it.price)}</s>` : ''}`;
    }
    for (const open of this.root.querySelectorAll('[data-open-crate]')) {
      const key = open.dataset.openCrate, price = key === 'christmas' ? d.christmasCrate?.price ?? 0 : d.crate.price;
      open.classList.toggle('short', a.money < price);
      open.classList.toggle('confirm', this.confirming === key);
      open.innerHTML = this.confirming === key ? `Open for 💰 ${money(price)}?` : `Open · 💰 ${money(price)}`;
    }
  }

  /** Owned, using the latest account (a pack is owned when every one of its guns has the skin). */
  owns(a, it) {
    if (!it.guns) return Object.keys(WEAPONS).every((g) => (a.ownedSkins[g] || []).includes(it.skin));   // a Limited skin: owned on every gun
    return it.guns.every((g) => (a.ownedSkins[g] || []).includes(it.skin));
  }

  /** What it costs now: a pack you partly own costs only the guns you are missing. */
  priceOf(a, it) {
    if (!it.guns || !it.pack) return it.fullPrice || it.price;
    const missing = it.guns.filter((g) => !(a.ownedSkins[g] || []).includes(it.skin)).length;
    return Math.round(((it.fullPrice || it.price) * missing) / it.guns.length / 10) * 10;
  }

  say(text, error = false) {
    this.message = text; this.messageError = error;
    const el = $('shop-msg');
    if (el) { el.textContent = text; el.className = error ? 'error' : 'shop-ok'; }
  }

  tick() {
    if (!this.visible || !this.data) return;
    const now = Date.now() + this.clockOffset;
    const el = $('shop-reset');
    if (el) el.textContent = countdown(this.data.resetsAt - now);
    for (const s of this.root.querySelectorAll('[data-until]')) s.textContent = countdown(Number(s.dataset.until) - now);
    if (now >= this.data.resetsAt || (this.data.christmasCrate && now >= this.data.christmasCrate.until)) { this.data = null; this.load(); }   // a new day: a new shop
  }

  // ---------------------------------------------------------------- buying

  async onClick(e) {
    const toggle = e.target.closest('[data-toggle-contents]');
    if (toggle) {
      const key = toggle.dataset.toggleContents;
      this.showContents[key] = !this.showContents[key];
      toggle.closest('.crate-odds').querySelector('.crate-contents').classList.toggle('hidden', !this.showContents[key]);
      toggle.textContent = `${this.showContents[key] ? 'Hide' : 'Show'} everything inside`;
      return;
    }
    if (e.target.closest('[data-dev-money]')) {
      const res = await devMoney();
      if (res.account) this.setAccount(res.account);
      this.say(res.error || 'Added 10,000 Money.', !!res.error);
      return;
    }
    const crate = e.target.closest('[data-open-crate]');
    if (crate) {
      const key = crate.dataset.openCrate;
      if (this.confirming !== key) { this.confirming = key; return this.updateButtons(); }
      this.confirming = null;
      this.updateButtons();
      return this.onOpenCrate(key);
    }
    const buy = e.target.closest('[data-buy]');
    if (!buy || buy.disabled || this.busy) return;
    const id = buy.dataset.buy;
    if (this.confirming !== id) { this.confirming = id; return this.updateButtons(); }   // first click: "Buy for ...?"
    this.confirming = null;
    this.busy = true;
    const res = await buyShopItem(id);
    this.busy = false;
    if (res.account) this.setAccount(res.account);
    if (res.shop) this.data = res.shop;
    if (res.error) { this.say(res.error, true); this.updateButtons(); return; }
    const s = SKINS[res.bought.skin];
    const where = res.bought.guns === 'all' ? 'every gun' : gunNames(res.bought.guns);
    this.say(`Bought ${s.name} for ${where}. Equip it in the Operators tab.`);
    this.updateButtons();
    const card = this.root.querySelector(`[data-card="${id}"]`);
    card?.classList.add('just-bought');
    setTimeout(() => card?.classList.remove('just-bought'), 1200);
  }
}

