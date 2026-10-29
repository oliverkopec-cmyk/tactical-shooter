// The main menu: tabs, the 3D scene, and the Operators tab where you pick an
// operator, see their guns, ability and utilities, and equip operators and gun skins.
// Equipping goes through the server, which checks you own what you equip.

import { OPERATORS, operatorsFor } from '../../shared/operators.js';
import { WEAPONS } from '../../shared/weapons.js';
import { UTILITIES } from '../../shared/utilities.js';
import { SKINS, RARITIES, skinList, hexColor, priceOf, shopSkins } from '../../shared/skins.js';
import { equipSkin, equipOperator, getShop, buySkin, devMoney, buyOperator } from './account.js';
import { fillKeys } from './controls.js';
import { MenuScene } from './menuScene.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pips = (n) => '●'.repeat(n) + '○'.repeat(3 - n);

export class Menu {
  /** getAccount() -> the current profile; setAccount(profile) stores a new one. */
  constructor({ getAccount, setAccount, onSettings }) {
    this.getAccount = getAccount;
    this.setAccount = setAccount;
    this.onSettings = onSettings;
    this.tab = 'play';
    this.side = 'attack';
    this.selectedOp = null;
    this.slot = 'primary';
    this.error = '';
    this.shopData = null;      // { featured, resetsAt } from the server
    this.shopSelected = null;  // skin shown in the preview and the detail card
    this.shopMessage = '';
    this.scene = null;        // created the first time the menu is shown (needs WebGL)
    this.active = false;

    for (const btn of document.querySelectorAll('#menu-tabs .tab')) {
      btn.addEventListener('click', () => (btn.dataset.tab === 'settings' ? this.onSettings() : this.setTab(btn.dataset.tab)));
    }
    for (const btn of document.querySelectorAll('.side-btn')) {
      btn.addEventListener('click', () => this.setSide(btn.dataset.side));
    }
    $('op-list').addEventListener('click', (e) => {
      const card = e.target.closest('[data-op]');
      if (card) { this.selectedOp = card.dataset.op; this.error = ''; this.renderOperators(); }
    });
    $('op-detail').addEventListener('click', (e) => this.onDetailClick(e));
    $('shop-main').addEventListener('click', (e) => {
      const card = e.target.closest('[data-shop-skin]');
      if (card) { this.shopSelected = card.dataset.shopSkin; this.shopMessage = ''; this.renderShop(); }
    });
    $('shop-detail').addEventListener('click', (e) => this.onShopDetailClick(e));
    setInterval(() => { if (this.active && this.tab === 'shop') this.updateShopTimer(); }, 30000);
  }

  /** Called when the main menu screen is shown or hidden. */
  setActive(on) {
    this.active = on;
    $('menu-canvas').classList.toggle('hidden', !on);
    if (!on) { this.scene?.stop(); return; }
    if (!this.scene) {
      try { this.scene = new MenuScene($('menu-canvas')); } catch { this.scene = null; $('menu-canvas').classList.add('hidden'); }
    }
    this.scene?.start();
    this.refresh();
  }

  setTab(tab) {
    this.tab = tab;
    for (const btn of document.querySelectorAll('#menu-tabs .tab')) btn.classList.toggle('active', btn.dataset.tab === tab);
    for (const panel of document.querySelectorAll('.tab-panel')) panel.classList.toggle('hidden', panel.id !== `tab-${tab}`);
    this.refresh();
  }

  setSide(side) {
    this.side = side;
    this.selectedOp = null;
    this.error = '';
    this.renderOperators();
  }

  /** The account changed (login, equip, match payout): redraw whatever is showing. */
  refresh() {
    if (!this.active || !this.getAccount()) return;
    this.scene?.setMode(this.tab === 'operators' ? 'operators' : this.tab === 'shop' ? 'shop' : 'play');
    if (this.tab === 'operators') this.renderOperators();
    else if (this.tab === 'shop') this.openShop();
    else this.showEquipped();
  }

  // ---------------------------------------------------------------- the operator on stage

  /** Play/Shop/Friends: the equipped operator holding their primary gun, with its skin. */
  showEquipped() {
    const a = this.getAccount();
    const id = a.equippedOperators?.menu && OPERATORS[a.equippedOperators.menu] ? a.equippedOperators.menu : 'recruit_atk';
    const op = OPERATORS[id], weaponId = op.weapons.primary;
    this.scene?.setLook({ team: op.team, operatorId: id, weaponId, skinId: a.equippedSkins?.[weaponId] || null });
  }

  // ---------------------------------------------------------------- operators tab

  renderOperators() {
    const a = this.getAccount();
    for (const btn of document.querySelectorAll('.side-btn')) btn.classList.toggle('active', btn.dataset.side === this.side);
    const ops = operatorsFor(this.side);
    const equippedId = a.equippedOperators?.[this.side];
    if (!this.selectedOp || OPERATORS[this.selectedOp]?.team !== this.side) this.selectedOp = equippedId && OPERATORS[equippedId] ? equippedId : ops[0].id;

    $('op-list').innerHTML = ops.map((op) => {
      const owned = a.ownedOperators.includes(op.id);
      return `<button type="button" class="op-row${op.id === this.selectedOp ? ' selected' : ''}${owned ? '' : ' locked'}" data-op="${op.id}">
        <span class="swatch" style="background:${hexColor(op.color)}"></span>
        <span class="op-row-name">${esc(op.name)}</span>
        ${op.id === equippedId ? '<span class="tag">Equipped</span>' : owned ? '' : `<span class="tag lock">${op.price.toLocaleString()}</span>`}
      </button>`;
    }).join('');

    const op = OPERATORS[this.selectedOp];
    const owned = a.ownedOperators.includes(op.id);
    const equipped = op.id === equippedId;
    const gunRow = (slot) => {
      const w = WEAPONS[op.weapons[slot]];
      const skin = SKINS[a.equippedSkins?.[w.id]];
      const rar = skin && RARITIES[skin.rarity];
      return `<button type="button" class="gun-row${this.slot === slot ? ' selected' : ''}" data-slot="${slot}" data-gun="${w.id}">
        <span class="slot">${slot === 'primary' ? 1 : 2}</span>
        <span class="gun-name"><b>${esc(w.name)}</b><i>${esc(w.kind)}</i></span>
        <span class="gun-skin"${rar ? ` style="color:${rar.color}"` : ''}>${skin ? esc(skin.name) : 'Default'}</span>
      </button>`;
    };
    const w = WEAPONS[op.weapons[this.slot]];
    const current = a.equippedSkins?.[w.id] || null;
    const owns = new Set(a.ownedSkins);
    const tiles = [`<button type="button" class="skin-tile${current === null ? ' equipped' : ''}" data-skin="" title="The gun's original look">
        <span class="skin-swatch" style="background:linear-gradient(135deg,${hexColor(w.color)},${hexColor(w.accent)})"></span><span class="skin-name">Default</span><span class="skin-rar" style="color:#8b95a3">Standard</span></button>`]
      .concat(skinList().map((s) => {
        const ok = owns.has(s.id);
        return `<button type="button" class="skin-tile${current === s.id ? ' equipped' : ''}${ok ? '' : ' locked'}" data-skin="${s.id}" style="--rar:${s.rarityInfo.color}" title="${ok ? '' : 'You don\'t own this skin yet: click to see it in the Shop'}">
          <span class="skin-swatch" style="background:linear-gradient(135deg,${hexColor(s.body)} 0%,${hexColor(s.body)} 45%,${hexColor(s.mark)} 46%,${hexColor(s.mark)} 54%,${hexColor(s.accent)} 55%)"></span>
          <span class="skin-name">${esc(s.name)}</span><span class="skin-rar" style="color:${s.rarityInfo.color}">${s.rarityInfo.name}${ok ? '' : ' · 🔒'}</span></button>`;
      })).join('');

    $('op-detail').innerHTML = `
      <div class="detail-head">
        <div><div class="detail-name" style="color:${hexColor(op.color)}">${esc(op.name)}</div><div class="muted">${op.team === 'attack' ? 'Attacker' : 'Defender'} · Speed ${pips(op.speed)} · Armor ${pips(op.armor)}</div></div>
        ${owned
          ? `<button type="button" class="${equipped ? '' : 'primary'}" data-equip-op="${op.id}" ${equipped ? 'disabled' : ''}>${equipped ? 'Equipped' : 'Equip operator'}</button>`
          : `<button type="button" class="primary" data-buy-op="${op.id}" ${a.money < op.price ? 'disabled' : ''}>${a.money < op.price ? `Need ${(op.price - a.money).toLocaleString()} more` : `Buy for ${op.price.toLocaleString()}`}</button>`}
      </div>
      <div class="detail-sub">Ability</div>
      <div class="detail-text">${op.ability ? `<b>${esc(op.ability.name)}</b><br>${esc(fillKeys(op.ability.desc))}` : '<i class="muted">No special ability</i>'}</div>
      <div class="detail-sub">Guns <span class="muted">(hover for stats, click to choose skins)</span></div>
      ${gunRow('primary')}${gunRow('secondary')}
      <div class="detail-sub">Utility <span class="muted">(pick one before each round)</span></div>
      ${op.utilities.map((id) => `<div class="util-row"><b>${esc(UTILITIES[id].name)}</b><span class="muted">×${UTILITIES[id].charges} · ${esc(UTILITIES[id].desc)}</span></div>`).join('')}
      <div class="detail-sub">Skins for ${esc(w.name)}</div>
      <div class="rarity-legend">${Object.values(RARITIES).map((r) => `<span style="color:${r.color}">● ${r.name}</span>`).join('')}</div>
      <div class="skin-grid">${tiles}</div>
      <p class="error">${esc(this.error)}</p>`;

    const skinId = current && SKINS[current] ? current : null;
    this.scene?.setLook({ team: op.team, operatorId: op.id, weaponId: w.id, skinId });
  }

  async onDetailClick(e) {
    const buyBtn = e.target.closest('[data-buy-op]');
    if (buyBtn && !buyBtn.disabled) {
      buyBtn.disabled = true;
      const res = await buyOperator(buyBtn.dataset.buyOp);
      this.error = res.bought ? '' : res.error || 'Could not buy that.';
      if (res.account) this.setAccount(res.account); else this.renderOperators();
      return;
    }
    const equipBtn = e.target.closest('[data-equip-op]');
    if (equipBtn && !equipBtn.disabled) { await this.apply(equipOperator(equipBtn.dataset.equipOp)); return; }
    const gun = e.target.closest('[data-slot]');
    if (gun) { this.slot = gun.dataset.slot; this.renderOperators(); return; }
    const tile = e.target.closest('[data-skin]');
    if (tile && tile.classList.contains('locked')) {
      // Not owned yet: take them to the shop with that skin ready to look at
      this.shopSelected = tile.dataset.skin;
      this.shopMessage = '';
      this.setTab('shop');
    } else if (tile) {
      const weapon = OPERATORS[this.selectedOp].weapons[this.slot];
      await this.apply(equipSkin(weapon, tile.dataset.skin || null));
    }
  }

  // ---------------------------------------------------------------- shop tab

  /** Load today's featured skins if we don't have them (or they've changed), then draw the shop. */
  async openShop() {
    const stale = !this.shopData || Date.parse(this.shopData.resetsAt) <= Date.now();
    if (stale) {
      const res = await getShop();
      if (res.featured) this.shopData = res;
    }
    if (this.tab !== 'shop' || !this.active) return;
    if (!this.shopSelected || !priceOf(this.shopSelected)) this.shopSelected = this.shopData?.featured?.[0] || shopSkins()[0].id;
    this.renderShop();
  }

  shopCard(id, owns, featured = false) {
    const s = SKINS[id], rar = RARITIES[s.rarity], price = priceOf(id), owned = owns.has(id);
    const money = this.getAccount().money;
    const state = owned ? '<span class="shop-owned">✔ Owned</span>' : `<span class="shop-price${money < price ? ' short' : ''}">${price.toLocaleString()}</span>`;
    return `<button type="button" class="shop-card${this.shopSelected === id ? ' selected' : ''}${owned ? ' owned' : ''}${featured ? ' featured' : ''}" data-shop-skin="${id}" style="--rar:${rar.color}">
      <span class="skin-swatch" style="background:linear-gradient(135deg,${hexColor(s.body)} 0%,${hexColor(s.body)} 45%,${hexColor(s.mark)} 46%,${hexColor(s.mark)} 54%,${hexColor(s.accent)} 55%)"></span>
      <span class="skin-name">${esc(s.name)}</span>
      <span class="shop-row"><span class="skin-rar" style="color:${rar.color}">${rar.name}</span>${state}</span>
    </button>`;
  }

  renderShop() {
    const a = this.getAccount();
    if (!a || !this.shopSelected) return;
    const owns = new Set(a.ownedSkins);
    const featured = (this.shopData?.featured || []).map((id) => this.shopCard(id, owns, true)).join('');
    const sections = Object.values(RARITIES).filter((r) => r.id !== 'common').map((r) => {
      const cards = shopSkins().filter((s) => s.rarity === r.id).map((s) => this.shopCard(s.id, owns)).join('');
      return `<div class="detail-sub" style="color:${r.color}">${r.name} · ${priceOf(shopSkins().find((s) => s.rarity === r.id).id).toLocaleString()} Money</div><div class="shop-grid">${cards}</div>`;
    }).join('');
    $('shop-main').innerHTML = `
      <div class="shop-head"><h2>Featured today</h2><span id="shop-timer" class="muted"></span></div>
      <div class="shop-grid">${featured}</div>
      <h2 class="shop-all">All skins</h2>
      <p class="muted small-note">Common skins are free and already yours. Sorted by rarity: the rarer the skin, the higher the price.</p>
      ${sections}`;
    this.updateShopTimer();

    const id = this.shopSelected, s = SKINS[id], rar = RARITIES[s.rarity], price = priceOf(id), owned = owns.has(id);
    const need = price - a.money;
    $('shop-detail').innerHTML = `
      <div class="detail-name" style="color:${rar.color}">${esc(s.name)}</div>
      <div class="muted">${rar.name} skin · ${esc(s.pattern === 'solid' ? 'solid colour' : s.pattern)}</div>
      <div class="shop-balance"><span class="muted">Your Money</span><b>${a.money.toLocaleString()}</b></div>
      <button type="button" class="${owned ? '' : 'primary'} buy-btn" data-buy="${id}" ${owned || need > 0 ? 'disabled' : ''}>
        ${owned ? '✔ You own this skin' : need > 0 ? `Need ${need.toLocaleString()} more Money` : `Buy for ${price.toLocaleString()} Money`}
      </button>
      <p class="${this.shopMessageIsError ? 'error' : 'shop-ok'}">${esc(this.shopMessage)}</p>
      <p class="muted small-note">${owned ? 'Equip it in the Operators tab: pick an operator, click a gun, then the skin.' : 'Preview shown on your equipped operator\'s primary gun. Skins fit every gun.'}</p>
      ${a.devTools ? `<div class="dev-box"><div class="detail-sub">Developer tools</div><div class="muted small-note">Local test database only. Never on the live site.</div><button type="button" data-dev-money>+10,000 Money</button></div>` : ''}`;

    // Show the skin on the equipped operator's primary gun
    const opId = a.equippedOperators?.menu && OPERATORS[a.equippedOperators.menu] ? a.equippedOperators.menu : 'recruit_atk';
    const op = OPERATORS[opId];
    this.scene?.setLook({ team: op.team, operatorId: opId, weaponId: op.weapons.primary, skinId: id });
  }

  updateShopTimer() {
    const el = $('shop-timer');
    if (!el || !this.shopData) return;
    const left = Date.parse(this.shopData.resetsAt) - Date.now();
    if (left <= 0) { el.textContent = 'Changing…'; this.shopData = null; this.openShop(); return; }
    el.textContent = `Changes in ${Math.floor(left / 3600000)}h ${String(Math.floor((left % 3600000) / 60000)).padStart(2, '0')}m`;
  }

  async onShopDetailClick(e) {
    if (e.target.closest('[data-dev-money]')) {
      const res = await devMoney();
      this.shopMessageIsError = !!res.error;
      this.shopMessage = res.error || 'Added 10,000 Money.';
      if (res.account) this.setAccount(res.account); else this.renderShop();
      return;
    }
    const buy = e.target.closest('[data-buy]');
    if (!buy || buy.disabled) return;
    buy.disabled = true;
    const res = await buySkin(buy.dataset.buy);
    this.shopMessageIsError = !res.bought;
    this.shopMessage = res.bought ? `Bought ${SKINS[res.bought].name}! Equip it in the Operators tab.` : res.error || 'Could not buy that.';
    if (res.account) this.setAccount(res.account); else this.renderShop();
  }

  async apply(request) {
    const res = await request;
    this.error = res.error || '';
    if (res.account) this.setAccount(res.account);
    else this.renderOperators();
  }
}
