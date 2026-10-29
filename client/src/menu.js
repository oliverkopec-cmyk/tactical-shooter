// The main menu: tabs, the 3D scene, and the Operators tab where you pick an
// operator, see their guns, ability and utilities, and equip operators and gun skins.
// Equipping goes through the server, which checks you own what you equip.

import { OPERATORS, operatorsFor } from '../../shared/operators.js';
import { WEAPONS } from '../../shared/weapons.js';
import { UTILITIES } from '../../shared/utilities.js';
import { SKINS, RARITIES, skinList, hexColor, CRATE, crateContents } from '../../shared/skins.js';
import { gunIcon } from './gunIcons.js';
import { operatorIcon, sideSymbol } from './operatorIcons.js';
import { equipSkin, equipOperator, openCrate as openCrateRequest, devMoney, buyOperator } from './account.js';
import { fillKeys } from './controls.js';
import { MenuScene } from './menuScene.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pips = (n) => '●'.repeat(n) + '○'.repeat(3 - n);

export class Menu {
  /** getAccount() -> the current profile; setAccount(profile) stores a new one. */
  constructor({ getAccount, setAccount, onSettings, onTab = () => {} }) {
    this.onTab = onTab;
    this.getAccount = getAccount;
    this.setAccount = setAccount;
    this.onSettings = onSettings;
    this.tab = 'play';
    this.side = 'attack';
    this.selectedOp = null;
    this.slot = 'primary';
    this.error = '';
    this.crateGun = null;      // the gun whose crate is selected in the shop
    this.opening = false;      // a crate opening is playing
    this.busy = false;
    this.shopMessage = '';
    this.scene = null;        // created the first time the menu is shown (needs WebGL)
    this.active = false;

    for (const btn of document.querySelectorAll('#menu-tabs .tab')) {
      btn.addEventListener('click', () => (btn.dataset.tab === 'settings' ? this.onSettings() : this.setTab(btn.dataset.tab)));
    }
    $('op-list').addEventListener('click', (e) => {
      const card = e.target.closest('[data-op]');
      if (card) { this.selectedOp = card.dataset.op; this.error = ''; this.renderOperators(); }
    });
    // Hovering an icon shows the operator's name
    $('op-list').addEventListener('mousemove', (e) => {
      const icon = e.target.closest('[data-op]');
      const tip = $('name-tip');
      if (!icon) { tip.classList.add('hidden'); return; }
      tip.textContent = icon.dataset.name;
      tip.classList.remove('hidden');
      tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`;
    });
    $('op-list').addEventListener('mouseleave', () => $('name-tip').classList.add('hidden'));
    $('op-detail').addEventListener('click', (e) => this.onDetailClick(e));
    $('shop-main').addEventListener('click', (e) => {
      const card = e.target.closest('[data-crate-gun]');
      if (card) { this.crateGun = card.dataset.crateGun; this.shopMessage = ''; this.renderShop(); }
    });
    this.bindCrateOverlay();
    $('shop-detail').addEventListener('click', (e) => this.onShopDetailClick(e));
  }

  /** Called when the main menu screen is shown or hidden. */
  setActive(on) {
    this.active = on;
    $('menu-canvas').classList.toggle('hidden', !on);
    this.onTab(on ? this.tab : null);
    if (!on) { this.scene?.stop(); return; }
    if (!this.scene) {
      try { this.scene = new MenuScene($('menu-canvas')); } catch { this.scene = null; $('menu-canvas').classList.add('hidden'); }
    }
    this.scene?.start();
    this.refresh();
  }

  setTab(tab) {
    this.tab = tab;
    this.onTab(tab);
    for (const btn of document.querySelectorAll('#menu-tabs .tab')) btn.classList.toggle('active', btn.dataset.tab === tab);
    for (const panel of document.querySelectorAll('.tab-panel')) panel.classList.toggle('hidden', panel.id !== `tab-${tab}`);
    this.refresh();
  }

  /** The account changed (login, equip, match payout): redraw whatever is showing. */
  refresh() {
    if (!this.active || !this.getAccount() || this.opening) return;
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
    if (!this.selectedOp || !OPERATORS[this.selectedOp]) {
      const e = a.equippedOperators?.menu;
      this.selectedOp = e && OPERATORS[e] ? e : 'spark';
    }
    const equippedIds = new Set([a.equippedOperators?.attack, a.equippedOperators?.defense]);
    const section = (team, title) => `
      <section class="op-side ${team}">
        <div class="side-bg">${sideSymbol(team)}</div>
        <div class="side-title">${title}</div>
        <div class="icon-grid">${operatorsFor(team).map((op) => {
          const owned = a.ownedOperators.includes(op.id);
          return `<button type="button" class="op-tile${op.id === this.selectedOp ? ' selected' : ''}${owned ? '' : ' locked'}${equippedIds.has(op.id) ? ' equipped' : ''}" data-op="${op.id}" data-name="${esc(op.name)}${owned ? '' : ` · ${op.price.toLocaleString()}`}">
            ${operatorIcon(op.id, 64)}
            ${owned ? '' : `<span class="lock-badge">🔒</span><span class="tile-price">${op.price.toLocaleString()}</span>`}
            ${equippedIds.has(op.id) ? '<span class="eq-badge">✔</span>' : ''}
          </button>`;
        }).join('')}</div>
      </section>`;
    $('op-list').innerHTML = section('attack', 'ATTACKERS') + section('defense', 'DEFENDERS');

    const op = OPERATORS[this.selectedOp];
    const owned = a.ownedOperators.includes(op.id);
    const equippedId = a.equippedOperators?.[op.team];
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
    const owns = new Set(a.ownedSkins[w.id] || []);
    const tiles = [`<button type="button" class="skin-tile${current === null ? ' equipped' : ''}" data-skin="" title="The gun's original look">
        <span class="skin-swatch" style="background:linear-gradient(135deg,${hexColor(w.color)},${hexColor(w.accent)})"></span><span class="skin-name">Default</span><span class="skin-rar" style="color:#8b95a3">Standard</span></button>`]
      .concat(skinList().map((s) => {
        const ok = owns.has(s.id);
        return `<button type="button" class="skin-tile${current === s.id ? ' equipped' : ''}${ok ? '' : ' locked'}" data-skin="${s.id}" style="--rar:${s.rarityInfo.color}" title="${ok ? '' : 'Not owned for this gun yet: click to open its crate in the Shop'}">
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
      this.crateGun = OPERATORS[this.selectedOp].weapons[this.slot];
      this.shopMessage = '';
      this.setTab('shop');
    } else if (tile) {
      const weapon = OPERATORS[this.selectedOp].weapons[this.slot];
      await this.apply(equipSkin(weapon, tile.dataset.skin || null));
    }
  }

  // ---------------------------------------------------------------- shop tab: one crate per gun

  /** Every gun, in the order operators list them (primary, then secondary). */
  gunOrder() {
    const seen = new Set(), out = [];
    for (const op of Object.values(OPERATORS)) for (const id of [op.weapons.primary, op.weapons.secondary]) if (!seen.has(id)) { seen.add(id); out.push(id); }
    return out;
  }

  openShop() {
    if (this.opening) return;
    if (!this.crateGun || !WEAPONS[this.crateGun]) this.crateGun = this.gunOrder()[0];
    this.renderShop();
  }

  renderShop() {
    const a = this.getAccount();
    if (!a || !this.crateGun || this.opening) return;
    const total = skinList().length;
    const cards = this.gunOrder().map((id) => {
      const w = WEAPONS[id], have = (a.ownedSkins[id] || []).length;
      return `<button type="button" class="crate-card${this.crateGun === id ? ' selected' : ''}" data-crate-gun="${id}">
        ${gunIcon(w.model, hexColor(w.accent))}
        <span class="skin-name">${esc(w.name)}</span>
        <span class="shop-row"><span class="skin-rar">${have} / ${total} skins</span><span class="shop-price${a.money < CRATE.price ? ' short' : ''}">${CRATE.price.toLocaleString()}</span></span>
      </button>`;
    }).join('');
    const daily = a.dailyMoney || { earned: 0, limit: 0 };
    $('shop-main').innerHTML = `
      <div class="shop-head"><h2>Crates</h2><span class="muted">Money only · one crate per gun</span></div>
      <p class="muted small-note">Each crate holds skins for one gun. Click a crate to see its odds and every skin inside. Money earned today: ${daily.earned.toLocaleString()} / ${daily.limit.toLocaleString()}.</p>
      <div class="crate-grid">${cards}</div>`;

    const id = this.crateGun, w = WEAPONS[id], contents = crateContents(), owns = new Set(a.ownedSkins[id] || []);
    const odds = Object.values(RARITIES).map((r) => `<div class="odds-row"><span style="color:${r.color}">● ${r.name}</span><b>${Math.round(CRATE.odds[r.id] * 100)}%</b></div>`).join('');
    const lists = Object.values(RARITIES).map((r) => `
      <div class="detail-sub" style="color:${r.color}">${r.name}</div>
      <div class="crate-skins">${contents[r.id].map((sid) => `<span class="crate-skin${owns.has(sid) ? ' owned' : ''}" style="--rar:${r.color}">${owns.has(sid) ? '✔ ' : ''}${esc(SKINS[sid].name)}</span>`).join('')}</div>`).join('');
    const need = CRATE.price - a.money;
    $('shop-detail').innerHTML = `
      <div class="detail-name">${esc(w.name)} crate</div>
      <div class="muted">${esc(w.kind)} · ${owns.size} of ${total} skins owned</div>
      <div class="detail-sub">Odds</div>${odds}
      <p class="muted small-note">A skin you already own gives back ${CRATE.refund.toLocaleString()} Money (half the price).</p>
      <button type="button" class="primary buy-btn" data-open-crate="${id}" ${need > 0 ? 'disabled' : ''}>${need > 0 ? `Need ${need.toLocaleString()} more Money` : `Open crate · ${CRATE.price.toLocaleString()} Money`}</button>
      <p class="${this.shopMessageIsError ? 'error' : 'shop-ok'}">${esc(this.shopMessage)}</p>
      <div class="detail-sub">Possible skins</div>${lists}
      ${a.devTools ? `<div class="dev-box"><div class="detail-sub">Developer tools</div><div class="muted small-note">Local test database only. Never on the live site.</div><button type="button" data-dev-money>+10,000 Money</button></div>` : ''}`;

    // Preview the gun on the stage
    const op = Object.values(OPERATORS).find((o) => o.weapons.primary === id || o.weapons.secondary === id);
    this.scene?.setLook({ team: op.team, operatorId: op.id, weaponId: id, skinId: null });
  }

  async onShopDetailClick(e) {
    if (e.target.closest('[data-dev-money]')) {
      const res = await devMoney();
      this.shopMessageIsError = !!res.error;
      this.shopMessage = res.error || 'Added 10,000 Money.';
      if (res.account) this.setAccount(res.account); else this.renderShop();
      return;
    }
    const open = e.target.closest('[data-open-crate]');
    if (open && !open.disabled) this.openCrate(open.dataset.openCrate);
  }

  // ---------------------------------------------------------------- crate opening

  async openCrate(gun) {
    if (this.opening || this.busy) return;
    this.busy = true;
    const res = await openCrateRequest(gun);
    this.busy = false;
    this.shopMessageIsError = !res.result;
    this.shopMessage = res.result ? '' : res.error || 'Could not open the crate.';
    if (!res.result) { if (res.account) this.setAccount(res.account); else this.renderShop(); return; }

    this.opening = true;
    this.crateGun = gun;
    this.pending = res;
    document.getElementById('screen-home').classList.add('crate-mode');
    $('crate-overlay').classList.remove('hidden');
    $('crate-result').classList.add('hidden');
    $('crate-hint').classList.remove('hidden');
    this.scene?.playCrate(res.result, () => this.showCrateResult());
    if (!this.scene) this.showCrateResult();   // no 3D (no WebGL): go straight to the result
  }

  /** The gun has appeared: say what it is, then offer the buttons. The new balance shows now, not before. */
  showCrateResult() {
    const { result, account } = this.pending;
    const skin = SKINS[result.skin], rar = RARITIES[result.rarity], w = WEAPONS[result.weapon];
    $('crate-hint').classList.add('hidden');
    $('crate-result').classList.remove('hidden');
    $('crate-rarity').textContent = rar.name.toUpperCase();
    $('crate-rarity').style.color = rar.color;
    $('crate-skin').textContent = `${skin.name} · ${w.name}`;
    $('crate-note').textContent = result.duplicate ? `Duplicate: +${result.refund.toLocaleString()} Money refunded` : 'New skin added to your collection!';
    $('crate-note').className = result.duplicate ? 'crate-note dup' : 'crate-note new';
    $('crate-equip').textContent = 'Equip';
    $('crate-equip').disabled = false;
    $('crate-more').disabled = account.money < CRATE.price;
    $('crate-more').textContent = account.money < CRATE.price ? 'Not enough Money' : 'Open another';
    this.setAccount(account);   // updates the Money in the top bar (menu.refresh does nothing while opening)
  }

  closeOpening() {
    this.opening = false;
    document.getElementById('screen-home').classList.remove('crate-mode');
    $('crate-overlay').classList.add('hidden');
    this.scene?.stopCrate();
    this.refresh();
  }

  bindCrateOverlay() {
    $('crate-overlay').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.scene?.crate?.skip();
    });
    $('menu-canvas').addEventListener('pointerdown', () => { if (this.opening) this.scene?.crate?.skip(); });
    $('crate-equip').addEventListener('click', async () => {
      const { result } = this.pending;
      const res = await equipSkin(result.weapon, result.skin);
      $('crate-equip').textContent = res.account ? 'Equipped ✔' : 'Could not equip';
      $('crate-equip').disabled = !!res.account;
      if (res.account) this.setAccount(res.account);
    });
    $('crate-more').addEventListener('click', () => { const gun = this.pending.result.weapon; this.closeOpening(); this.openCrate(gun); });
    $('crate-back').addEventListener('click', () => this.closeOpening());
  }

  async apply(request) {
    const res = await request;
    this.error = res.error || '';
    if (res.account) this.setAccount(res.account);
    else this.renderOperators();
  }
}
