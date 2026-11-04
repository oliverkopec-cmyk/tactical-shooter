// The main menu: tabs, the 3D scene, and the Operators tab where you pick an
// operator, see their guns, ability and utilities, and equip operators and gun skins.
// Equipping goes through the server, which checks you own what you equip.

import { OPERATORS, operatorsFor } from '../../shared/operators.js';
import { WEAPONS } from '../../shared/weapons.js';
import { UTILITIES } from '../../shared/utilities.js';
import { SKINS, RARITIES, skinList, hexColor, CRATE } from '../../shared/skins.js';
import { operatorIcon, sideSymbol } from './operatorIcons.js';
import { equipSkin, equipOperator, openCrate as openCrateRequest, buyOperator, equipCharm, equipAttachment } from './account.js';
import { GunWorkshop } from './gunWorkshop.js';
import { CHARMS, charmList, charmUnlockLevel } from '../../shared/charms.js';
import { PRESENT_BASE, countdownText } from '../../shared/christmas.js';
import { ShopCards } from './shopCards.js';
import { ShopView } from './shopView.js';
import { fillKeys } from './controls.js';
import { MenuScene } from './menuScene.js';
import { menuMusic } from './menuMusic.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pips = (n) => '●'.repeat(n) + '○'.repeat(3 - n);
const EXCL_TAG = '<span class="excl-tag">EXCLUSIVE</span>';
/** A skin's swatch: a stripe of its mark colour (Exclusive skins: all three of their colours, shimmering). */
const swatch = (s) => (s.rarity === 'exclusive'
  ? `<span class="skin-swatch excl-swatch" style="background:linear-gradient(120deg,${hexColor(s.c1)} 0%,${hexColor(s.c2)} 45%,${hexColor(s.c3)} 60%,${hexColor(s.c1)} 100%);background-size:200% 200%"></span>`
  : `<span class="skin-swatch" style="background:linear-gradient(135deg,${hexColor(s.body)} 0%,${hexColor(s.body)} 45%,${hexColor(s.mark)} 46%,${hexColor(s.mark)} 54%,${hexColor(s.accent)} 55%)"></span>`);

export class Menu {
  /** getAccount() -> the current profile; setAccount(profile) stores a new one. */
  constructor({ getAccount, setAccount, onSettings, onTab = () => {}, claimGift, christmasRequest }) {
    this.onTab = onTab;
    this.claimGift = claimGift;   // (id) -> { result, account } or { error }, from the server
    this.christmasRequest = christmasRequest;   // (name, value): ask the server about Christmas
    this.adminGifts = [];         // unopened admin gifts
    this.christmas = null;        // the server's Christmas state (shared/christmas.js)
    this.christmasClock = 0;      // server time - local time
    this.giftList = [];           // unopened gifts and Christmas presents, waiting as presents
    this.giftOpen = null;         // the gift being unwrapped: { id, result, account }
    this.getAccount = getAccount;
    this.setAccount = setAccount;
    this.onSettings = onSettings;
    this.tab = 'play';
    this.side = 'attack';
    this.selectedOp = null;
    this.slot = 'primary';
    this.error = '';
    this.opening = false;      // a crate opening is playing
    this.busy = false;
    this.shop = new ShopView({ getAccount, setAccount, onOpenCrate: () => this.openCrate() });
    this.scene = null;        // created the first time the menu is shown (needs WebGL)
    this.active = false;

    for (const btn of document.querySelectorAll('#menu-tabs .tab')) {
      btn.addEventListener('click', () => (btn.dataset.tab === 'settings' ? this.onSettings() : this.setTab(btn.dataset.tab)));
    }
    window.addEventListener('resize', () => this.moveIndicator());
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
    this.workshop = new GunWorkshop({
      getAccount,
      equipAttachment: async (gun, slot, value) => this.apply(equipAttachment(gun, slot, value)),
      equipSkin: async (gun, id) => this.apply(equipSkin(gun, id)),
      equipCharm: async (gun, id) => this.apply(equipCharm(gun, id)),
      skinTiles: (gun) => this.skinTiles(gun),
      charmTiles: (gun) => this.charmTiles(gun),
      skinName: (id) => SKINS[id]?.name || 'Default',
      charmName: (id) => CHARMS[id]?.name || 'None',
      goToShop: () => this.setTab('shop'),
      onClose: () => { if (this.active) this.scene?.start(); this.refresh(); },
    });
    this.bindCrateOverlay();
    this.bindGifts();
    this.bindChristmasDev();
    setInterval(() => this.tickChristmas(), 1000);
  }

  /** Called when the main menu screen is shown or hidden. */
  setActive(on) {
    this.active = on;
    menuMusic.setWanted(on);   // ambient music while the menu shows, fading out for a match
    $('menu-canvas').classList.toggle('hidden', !on);
    this.onTab(on ? this.tab : null);
    this.shop.setVisible(on && this.tab === 'shop' && !this.opening);
    this.xmasCards?.setActive(on && this.tab === 'christmas');
    if (!on) { this.scene?.stop(); return; }
    if (!this.scene) {
      try { this.scene = new MenuScene($('menu-canvas')); } catch { this.scene = null; $('menu-canvas').classList.add('hidden'); }
      if (this.scene) { this.scene.onGiftClick = (id) => this.openGift(id); this.scene.setChristmas(this.christmas?.theme); this.scene.setGifts(this.adminGifts); this.scene.setPresents(this.presentList || []); }
    }
    this.scene?.start();
    this.refresh();
    requestAnimationFrame(() => this.moveIndicator());
  }

  /** Slide the glowing bar under the tabs to the active one. */
  moveIndicator() {
    const active = document.querySelector('#menu-tabs .tab.active'), bar = document.querySelector('#menu-tabs .tab-indicator');
    if (!active || !bar || !active.offsetWidth) return;
    bar.style.width = `${active.offsetWidth}px`;
    bar.style.transform = `translateX(${active.offsetLeft}px)`;
  }

  setTab(tab) {
    this.tab = tab;
    this.onTab(tab);
    for (const btn of document.querySelectorAll('#menu-tabs .tab')) btn.classList.toggle('active', btn.dataset.tab === tab);
    for (const panel of document.querySelectorAll('.tab-panel')) panel.classList.toggle('hidden', panel.id !== `tab-${tab}`);
    this.shop.setVisible(tab === 'shop');   // its 3D cards only turn while it shows
    this.xmasCards?.setActive(tab === 'christmas');
    this.moveIndicator();
    this.refresh();
  }

  /** The account changed (login, equip, match payout): redraw whatever is showing. */
  refresh() {
    if (!this.active || !this.getAccount() || this.opening || this.giftOpen) return;
    this.updateChristmasTab();
    this.scene?.setMode(this.tab === 'operators' ? 'operators' : this.tab === 'christmas' ? 'christmas' : 'play');
    if (this.tab === 'operators') this.renderOperators();
    else if (this.tab === 'shop') { this.shop.accountChanged(); this.showEquipped(); }
    else this.showEquipped();
  }

  // ---------------------------------------------------------------- the operator on stage

  /** Play/Shop/Friends: the equipped operator holding their primary gun, with its skin. */
  showEquipped() {
    const a = this.getAccount();
    const id = a.equippedOperators?.menu && OPERATORS[a.equippedOperators.menu] ? a.equippedOperators.menu : 'recruit_atk';
    const op = OPERATORS[id], weaponId = op.weapons.primary;
    this.scene?.setLook({ team: op.team, operatorId: id, weaponId, skinId: a.equippedSkins?.[weaponId] || null, attachments: a.equippedAttachments?.[weaponId] || null });
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
        <span class="gun-skin${skin?.rarity === 'exclusive' ? ' excl-text' : ''}"${rar ? ` style="color:${rar.color}"` : ''}>${skin ? esc(skin.name) : 'Default'}</span>
        <span class="gun-open">Workshop ›</span>
      </button>`;
    };
    const w = WEAPONS[op.weapons[this.slot]];
    const current = a.equippedSkins?.[w.id] || null;
    const currentCharm = a.equippedCharms?.[w.id] || null;
    const tiles = this.skinTiles(w.id), charmTiles = this.charmTiles(w.id);

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
      <div class="rarity-legend">${Object.values(RARITIES).map((r) => `<span class="${r.giftOnly ? 'excl-text' : ''}" style="color:${r.color}">● ${r.name}${r.giftOnly ? ' (gifts only)' : ''}</span>`).join('')}</div>
      <div class="skin-grid">${tiles}</div>
      <div class="detail-sub">Charm for ${esc(w.name)} <span class="muted">(hangs from the gun; other players see it)</span></div>
      <div class="skin-grid charm-grid">${charmTiles}</div>
      <p class="error">${esc(this.error)}</p>`;

    const skinId = current && SKINS[current] ? current : null;
    this.scene?.setLook({ team: op.team, operatorId: op.id, weaponId: w.id, skinId, charmId: currentCharm && CHARMS[currentCharm] ? currentCharm : null, attachments: a.equippedAttachments?.[w.id] || null });
  }

  /** The skin choices for a gun (the Operators tab and the gun workshop). */
  skinTiles(gunId) {
    const a = this.getAccount(), w = WEAPONS[gunId];
    const current = a.equippedSkins?.[w.id] || null;
    const owns = new Set(a.ownedSkins[w.id] || []);
    return [`<button type="button" class="skin-tile${current === null ? ' equipped' : ''}" data-skin="" title="The gun's original look">
        <span class="skin-swatch" style="background:linear-gradient(135deg,${hexColor(w.color)},${hexColor(w.accent)})"></span><span class="skin-name">Default</span><span class="skin-rar" style="color:#8b95a3">Standard</span></button>`]
      // Exclusive (gift) and shop skins only show once you have them; the crate's skins always show, locked or not
      .concat(skinList().filter((s) => (s.rarity !== 'exclusive' && !s.source) || owns.has(s.id)).map((s) => {
        const ok = owns.has(s.id), excl = s.rarity === 'exclusive';
        return `<button type="button" class="skin-tile${current === s.id ? ' equipped' : ''}${ok ? '' : ' locked'}${excl ? ' exclusive' : ''}" data-skin="${s.id}" style="--rar:${s.rarityInfo.color}" title="${ok ? '' : 'Not owned for this gun yet: click to go to the Shop'}">
          ${swatch(s)}
          <span class="skin-name">${esc(s.name)}</span><span class="skin-rar${excl ? ' excl-text' : ''}" style="color:${s.rarityInfo.color}">${excl ? EXCL_TAG : s.rarityInfo.name}${ok ? '' : ' · 🔒'}</span></button>`;
      })).join('');
  }

  /** The charm choices for a gun. */
  charmTiles(gunId) {
    const a = this.getAccount(), w = WEAPONS[gunId];
    const ownedCharms = new Set(a.ownedCharms || []);
    const currentCharm = a.equippedCharms?.[w.id] || null;
    return [`<button type="button" class="skin-tile${currentCharm === null ? ' equipped' : ''}" data-charm="" title="No charm">
        <span class="skin-swatch charm-none"></span><span class="skin-name">None</span><span class="skin-rar" style="color:#8b95a3">&nbsp;</span></button>`]
      .concat(charmList().filter((c) => !c.source || ownedCharms.has(c.id)).map((c) => {   // Christmas charms only show once you have them
        const ok = ownedCharms.has(c.id), rar = RARITIES[c.rarity], lvl = charmUnlockLevel(c.id);
        const why = lvl ? `Unlocks at level ${lvl}, or from the charm crate` : 'From the charm crate in the Shop';
        return `<button type="button" class="skin-tile${currentCharm === c.id ? ' equipped' : ''}${ok ? '' : ' locked'}" data-charm="${c.id}" style="--rar:${rar.color}" title="${ok ? '' : why}">
          <span class="skin-swatch charm-dot" style="background:${rar.color}">${esc(c.name[0])}</span>
          <span class="skin-name">${esc(c.name)}</span><span class="skin-rar" style="color:${rar.color}">${rar.name}${ok ? '' : ` · 🔒${lvl ? ` L${lvl}` : ''}`}</span></button>`;
      })).join('');
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
    if (gun) {
      this.slot = gun.dataset.slot;
      this.renderOperators();
      this.scene?.stop();             // nothing else needs drawing behind the workshop
      this.workshop.open(gun.dataset.gun);
      return;
    }
    const charmTile = e.target.closest('[data-charm]');
    if (charmTile) {
      if (charmTile.classList.contains('locked')) { this.setTab('shop'); return; }
      await this.apply(equipCharm(OPERATORS[this.selectedOp].weapons[this.slot], charmTile.dataset.charm || null));
      return;
    }
    const tile = e.target.closest('[data-skin]');
    if (tile && tile.classList.contains('locked')) {
      // Not owned yet: take them to the shop
      this.setTab('shop');
    } else if (tile) {
      const weapon = OPERATORS[this.selectedOp].weapons[this.slot];
      await this.apply(equipSkin(weapon, tile.dataset.skin || null));
    }
  }

  // ---------------------------------------------------------------- crate opening

  /** Open the crate (the shop's Open button): the server draws it, then the 3D scene plays the opening. */
  async openCrate(kind = 'crate') {
    if (this.opening || this.busy) return;
    this.busy = true;
    this.crateKind = kind;
    const res = await openCrateRequest(kind);
    this.busy = false;
    if (!res.result) {
      if (res.account) this.setAccount(res.account);
      if (kind === 'christmas') $('xmas-error').textContent = res.error || 'Could not open the crate.';
      else this.shop.say(res.error || 'Could not open the crate.', true);
      return;
    }

    this.opening = true;
    this.shop.setVisible(false);
    this.pending = res;
    document.getElementById('screen-home').classList.add('crate-mode');
    $('crate-overlay').classList.remove('hidden');
    $('crate-result').classList.add('hidden');
    $('crate-hint').classList.remove('hidden');
    this.scene?.playCrate(res.result, () => this.showCrateResult(), { christmas: kind === 'christmas' });
    if (!this.scene) this.showCrateResult();   // no 3D (no WebGL): go straight to the result
  }

  /** The gun has appeared: say what it is, then offer the buttons. The new balance shows now, not before. */
  showCrateResult() {
    const { result, account } = this.pending;
    const rar = RARITIES[result.rarity];
    const charm = result.charm ? CHARMS[result.charm] : null;
    const skin = SKINS[result.skin], w = WEAPONS[result.weapon] || WEAPONS[this.charmTargetGun()];
    $('crate-hint').classList.add('hidden');
    $('crate-result').classList.remove('hidden');
    $('crate-rarity').textContent = rar.name.toUpperCase();
    $('crate-rarity').style.color = rar.color;
    $('crate-skin').textContent = charm ? `${charm.name} charm` : `${skin.name} · ${w.name}`;
    $('crate-note').textContent = result.duplicate ? `Duplicate: +${result.refund.toLocaleString()} Money refunded` : (charm ? 'New charm added to your collection!' : 'New skin added to your collection!');
    $('crate-note').className = result.duplicate ? 'crate-note dup' : 'crate-note new';
    $('crate-equip').textContent = charm ? `Equip on ${w.name}` : 'Equip';
    $('crate-equip').disabled = false;
    if (this.crateKind === 'christmas') {
      const left = account.christmasCrates || 0;
      $('crate-more').disabled = left === 0;
      $('crate-more').textContent = left ? `Open x${left}` : 'No crates left';
    } else {
      $('crate-more').disabled = account.money < CRATE.price;
      $('crate-more').textContent = account.money < CRATE.price ? 'Not enough Money' : 'Open another';
    }
    this.setAccount(account);   // updates the Money in the top bar (menu.refresh does nothing while opening)
  }

  closeOpening() {
    this.opening = false;
    document.getElementById('screen-home').classList.remove('crate-mode');
    $('crate-overlay').classList.add('hidden');
    this.scene?.stopCrate();
    this.refresh();
    this.shop.setVisible(this.active && this.tab === 'shop');
  }

  bindCrateOverlay() {
    $('crate-overlay').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.scene?.crate?.skip();
    });
    $('menu-canvas').addEventListener('pointerdown', () => { if (this.opening) this.scene?.crate?.skip(); });
    $('crate-equip').addEventListener('click', async () => {
      const { result } = this.pending;
      const res = result.charm ? await equipCharm(this.charmTargetGun(), result.charm) : await equipSkin(result.weapon, result.skin);
      $('crate-equip').textContent = res.account ? 'Equipped ✔' : 'Could not equip';
      $('crate-equip').disabled = !!res.account;
      if (res.account) this.setAccount(res.account);
    });
    $('crate-more').addEventListener('click', () => { this.closeOpening(); this.openCrate(this.crateKind); });
    $('crate-back').addEventListener('click', () => this.closeOpening());
  }

  // ---------------------------------------------------------------- gifts

  /** Admin tab: show a skin on the operator's gun in the scene (nothing is equipped). */
  previewSkin(skinId) {
    const a = this.getAccount();
    const id = a?.equippedOperators?.menu && OPERATORS[a.equippedOperators.menu] ? a.equippedOperators.menu : 'recruit_atk';
    const op = OPERATORS[id];
    this.scene?.setLook({ team: op.team, operatorId: id, weaponId: op.weapons.primary, skinId: SKINS[skinId] ? skinId : null });
  }

  /** The server's list of unopened gifts: presents in the 3D scene, and a button in the Play tab. */
  setGifts(list) {
    this.adminGifts = Array.isArray(list) ? list : [];
    this.showGifts();
  }

  showGifts() {
    const presents = (this.christmas?.presents || []).map((p) => ({ id: PRESENT_BASE + p.day, title: `Christmas present · ${p.date}`, exclusive: p.special, christmas: true }));
    this.presentList = presents;
    this.giftList = this.adminGifts;
    this.scene?.setGifts(this.adminGifts);
    this.scene?.setPresents(presents);
    const admin = this.adminGifts.length, n = admin || presents.length, el = $('gift-notice');
    const what = admin ? (admin === 1 ? 'You have a gift!' : `You have ${admin} gifts!`) : (n === 1 ? 'A Christmas present is waiting!' : `${n} Christmas presents are waiting!`);
    const how = admin ? (this.scene ? 'Click a present in front of your operator to open it.' : 'Click here to open it.') : 'Click here to go to the Christmas room.';
    el.classList.toggle('hidden', n === 0);
    el.classList.toggle('exclusive', this.adminGifts.some((g) => g.exclusive));
    el.innerHTML = `<span class="gift-icon">🎁</span><span><b>${what}</b><br><span class="muted">${how}</span></span>`;
    document.querySelector('[data-tab="christmas"]').dataset.badge = presents.length ? String(presents.length) : '';
    if (!this.giftOpen) $('gift-next').classList.toggle('hidden', true);
    this.renderChristmasPanel();
  }

  /** The next gift to open from where you are: a present in the Christmas room, an admin gift on the rooftop. */
  nextGift() {
    return (this.tab === 'christmas' ? this.presentList : this.adminGifts)?.[0] || null;
  }

  // ---------------------------------------------------------------- Christmas

  /** What the server says about Christmas (null when logged out): the theme, the countdown and the presents. */
  setChristmas(state) {
    const wasOn = !!this.christmas?.theme;
    this.christmas = state;
    this.christmasClock = state ? state.now - Date.now() : 0;
    this.christmasAsked = false;
    this.scene?.setChristmas(state?.theme);
    this.showGifts();
    this.tickChristmas();
    this.renderChristmasDev();
    this.updateChristmasTab();
    if (wasOn !== !!state?.theme) this.shop.christmasChanged();
  }

  /** The colourful tab shows during the event, and afterwards for anyone who still has crates to open. */
  updateChristmasTab() {
    const a = this.getAccount(), btn = document.querySelector('[data-tab="christmas"]');
    const show = !!a && (!!this.christmas?.theme || a.christmasCrates > 0);
    if (btn.classList.contains('hidden') === show) {
      btn.classList.toggle('hidden', !show);
      requestAnimationFrame(() => this.moveIndicator());
    }
    if (!show && this.tab === 'christmas' && a) this.setTab('play');
    this.renderChristmasPanel();
  }

  /** The side panel in the Christmas tab: the crates you have and the presents waiting. */
  renderChristmasPanel() {
    const a = this.getAccount();
    if (!a) return;
    const n = a.christmasCrates || 0, on = !!this.christmas?.theme, presents = this.presentList?.length || 0;
    $('xmas-crate-count').textContent = `x${n}`;
    $('xmas-crate-count').classList.toggle('none', n === 0);
    $('xmas-open').textContent = n ? `Open x${n}` : 'No crates to open';
    $('xmas-open').disabled = n === 0;
    $('xmas-inv-note').textContent = on ? 'Crates from presents and the Shop land here. Open them whenever you like.' : 'The event is over, but these crates are still yours to open.';
    $('xmas-presents').classList.toggle('hidden', !on);
    $('xmas-presents').innerHTML = presents
      ? `<b>${presents} ${presents === 1 ? 'present' : 'presents'}</b> under the tree. Click one to unwrap it. You get a new one every day until Christmas Eve.`
      : 'No presents waiting. A new one arrives under the tree every day until Christmas Eve.';
    if (this.tab === 'christmas' && !this.xmasCards) {
      this.xmasCards = new ShopCards();
      this.xmasCards.setCards([{ canvas: $('xmas-crate-view'), crate: 'christmas', guns: [] }]);
      this.xmasCards.setActive(this.active);
    }
  }

  /** Once a second: the countdown; and at each midnight in Sydney ask the server what has changed. */
  async tickChristmas() {
    const st = this.christmas;
    if (!st) { $('xmas-bar').classList.add('hidden'); return; }
    const now = Date.now() + this.christmasClock;
    $('xmas-bar').classList.toggle('hidden', !st.theme);
    if (st.theme) $('xmas-countdown').textContent = countdownText(now);
    if (st.nextChange && now >= st.nextChange && !this.christmasAsked && this.christmasRequest) {
      this.christmasAsked = true;
      const res = await this.christmasRequest('christmasState');
      if (res?.christmas) this.setChristmas(res.christmas); else this.christmasAsked = false;
    }
  }

  /** Local test database only: pretend it is another date, to see the whole event. */
  renderChristmasDev() {
    const el = $('xmas-dev'), show = !!this.getAccount()?.devTools && !!this.christmas;
    el.classList.toggle('hidden', !show);
    if (!show || el.childElementCount) return;
    const dates = [['-', 'Choose a date...'], ['', 'Today'], ['2026-11-19T23:59:50', '19 Nov, 10 s before it starts'], ['2026-11-20T12:00:00', '20 Nov, first present'], ['2026-12-17T12:00:00', '17 Dec, last random day'], ['2026-12-18T12:00:00', '18 Dec, first skin day'], ['2026-12-24T23:59:50', '24 Dec, 10 s to Christmas'], ['2026-12-28T12:00:00', '28 Dec'], ['2027-01-02T23:59:50', '2 Jan, 10 s before the end']];
    el.innerHTML = `<span class="muted small-note">Local test database only: pretend it is</span>
      <select id="xmas-dev-date">${dates.map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}</select>
      <button type="button" class="ghost small" id="xmas-dev-reset">Forget my presents</button>`;
  }

  bindChristmasDev() {
    $('xmas-dev').addEventListener('change', (e) => { if (e.target.id !== 'xmas-dev-date' || e.target.value === '-') return; this.christmasRequest?.('christmasDevDate', e.target.value ? `${e.target.value}+11:00` : ''); });
    $('xmas-dev').addEventListener('click', (e) => { if (e.target.id === 'xmas-dev-reset') this.christmasRequest?.('christmasDevReset'); });
  }

  /** Open a gift: the server adds what's inside, then the unwrapping plays and shows it. */
  async openGift(id) {
    if (this.giftOpen || this.opening || this.busy || !this.claimGift) return;
    this.busy = true;
    const res = await this.claimGift(id);
    this.busy = false;
    if (!res.result) { $('home-error').textContent = res.error || 'Could not open the gift.'; return; }
    this.giftOpen = { id, ...res };
    document.getElementById('screen-home').classList.add('crate-mode');
    $('gift-overlay').classList.remove('hidden');
    $('gift-result').classList.add('hidden');
    $('gift-hint').classList.remove('hidden');
    if (this.scene) this.scene.playGift(id, res.result, { showGun: this.giftGun(), onReveal: () => this.showGiftResult() });
    else this.showGiftResult();
    if (res.christmas) this.setChristmas(res.christmas);   // after the box has been taken out of the pile
  }

  /** The gun a gifted skin is shown on and equipped to: the menu operator's primary. */
  giftGun() {
    const a = this.getAccount();
    const op = OPERATORS[a?.equippedOperators?.menu] || OPERATORS.recruit_atk;
    return op.weapons.primary;
  }

  showGiftResult() {
    const { result, account } = this.giftOpen;
    $('gift-hint').classList.add('hidden');
    $('gift-result').classList.remove('hidden');
    $('gift-title').textContent = result.title;
    $('gift-from').textContent = result.from ? `From ${result.from}` : '';
    $('gift-message').textContent = result.message || '';
    $('gift-message').classList.toggle('hidden', !result.message);
    const items = [];
    const rarityTag = (r) => (r === 'exclusive' ? EXCL_TAG : `<span style="color:${RARITIES[r].color}">${RARITIES[r].name}</span>`);
    if (result.skin) {
      const sk = SKINS[result.skin.id];
      items.push(`<div class="gift-item${result.skin.rarity === 'exclusive' ? ' exclusive' : ''}">${rarityTag(result.skin.rarity)} <b>${esc(sk.name)}</b> skin · fits every gun${result.skin.duplicate ? ' <span class="muted">(you already had it)</span>' : ''}</div>`);
    }
    if (result.crate) {
      const c = result.crate, what = c.kind === 'charm' ? `${esc(CHARMS[c.charm].name)} charm` : `${esc(SKINS[c.skin].name)} for the ${esc(WEAPONS[c.weapon].name)}`;
      items.push(`<div class="gift-item">${c.label ? `A ${esc(c.label)}` : `A ${c.kind === 'charm' ? 'charm' : esc(WEAPONS[c.weapon].name)} crate`}: ${rarityTag(c.rarity)} <b>${what}</b>${c.duplicate ? ` <span class="muted">(duplicate: +${c.refund.toLocaleString()} Money)</span>` : ''}</div>`);
    }
    if (result.charm) items.push(`<div class="gift-item">${rarityTag(result.charm.rarity)} <b>${esc(CHARMS[result.charm.id].name)}</b> charm${result.charm.duplicate ? ' <span class="muted">(you already had it)</span>' : ''}</div>`);
    if (result.christmasCrate) items.push('<div class="gift-item"><b>A Christmas crate</b> · sent to your Christmas inventory</div>');
    if (result.money) items.push(`<div class="gift-item money"><b>+${result.money.toLocaleString()} Money</b></div>`);
    $('gift-items').innerHTML = items.join('');
    const skinId = result.skin?.id;
    $('gift-equip').classList.toggle('hidden', !skinId);
    $('gift-equip').disabled = false;
    $('gift-equip').textContent = skinId ? `Equip on ${WEAPONS[this.giftGun()].name}` : 'Equip';
    $('gift-next').classList.toggle('hidden', !this.nextGift());
    $('gift-next').textContent = this.tab === 'christmas' ? 'Open the next present' : 'Open the next gift';
    this.setAccount(account);
  }

  closeGift() {
    if (this.giftOpen?.account) this.setAccount(this.giftOpen.account);   // in case it closes before the reveal has shown it
    this.giftOpen = null;
    document.getElementById('screen-home').classList.remove('crate-mode');
    $('gift-overlay').classList.add('hidden');
    this.scene?.stopGift();
    this.refresh();
  }

  bindGifts() {
    $('gift-notice').addEventListener('click', () => { if (this.adminGifts[0]) this.openGift(this.adminGifts[0].id); else if (this.presentList?.length) this.setTab('christmas'); });
    $('xmas-open').addEventListener('click', () => { $('xmas-error').textContent = ''; this.openCrate('christmas'); });
    $('gift-overlay').addEventListener('click', (e) => { if (!e.target.closest('button')) this.scene?.opening?.skip(); });
    $('menu-canvas').addEventListener('pointerdown', () => { if (this.giftOpen) this.scene?.opening?.skip(); });
    $('gift-close').addEventListener('click', () => this.closeGift());
    $('gift-next').addEventListener('click', () => { const next = this.nextGift(); this.closeGift(); if (next) this.openGift(next.id); });
    $('gift-equip').addEventListener('click', async () => {
      const skin = this.giftOpen?.result.skin?.id;
      if (!skin) return;
      const res = await equipSkin(this.giftGun(), skin);
      $('gift-equip').textContent = res.account ? 'Equipped ✔' : 'Could not equip';
      $('gift-equip').disabled = !!res.account;
      if (res.account) this.setAccount(res.account);
    });
  }

  /** The gun a charm from the crate gets equipped on: the gun picked in the Operators tab (or the equipped operator's primary). */
  charmTargetGun() {
    const a = this.getAccount();
    const op = OPERATORS[this.selectedOp] || OPERATORS[a?.equippedOperators?.menu] || Object.values(OPERATORS)[0];
    return op.weapons[this.slot] || op.weapons.primary;
  }

  async apply(request) {
    const res = await request;
    this.error = res.error || '';
    if (res.account) this.setAccount(res.account);
    else this.renderOperators();
  }
}
