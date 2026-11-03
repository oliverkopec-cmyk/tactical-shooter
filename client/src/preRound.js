// The screens before each round (Stage F): location (a top-down map: attackers pick a spawn point,
// defenders vote for a site) and loadout (operator grid, details with a turning 3D model, utility,
// skins and charms, LOCK IN, and the team's picks along the bottom). Attackers open the loadout
// again in prep (6) to change operator, utility or spawn point.
//
// The game calls update() every frame with the current state; each part of the screen only
// re-renders when what it shows has changed.

import { OPERATORS, operatorsFor } from '../../shared/operators.js';
import { WEAPONS } from '../../shared/weapons.js';
import { UTILITIES } from '../../shared/utilities.js';
import { SKINS, RARITIES } from '../../shared/skins.js';
import { CHARMS } from '../../shared/charms.js';
import { operatorIcon } from './operatorIcons.js';
import { gunIcon } from './gunIcons.js';
import { fillKeys, keyFor } from './controls.js';
import { drawTopMap, mapLevels, levelOf } from './topMap.js';
import { OpPreview } from './opPreview.js';
import { menuAudio } from './menuAudio.js';
import { equipSkin, equipCharm } from './account.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const $ = (root, sel) => root.querySelector(sel);
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const LETTERS = 'ABCDEFGH';

export class PreRound {
  /**
   * hooks: { pickOperator(id), pickUtility(id), pickSpawn(n), voteSite(i), refreshLook(), backToDrone(),
   *          getAccount(), setAccount(profile), onSkinsChanged(skins, charms), toast(msg) }
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.el = document.getElementById('pre-round');
    this.view = null;            // null (closed), 'location', 'loadout' or 'prep'
    this.prepTab = 'operator';   // in prep: 'operator' or 'spawn'
    this.viewOp = null;          // the operator shown on the right (clicked, not necessarily locked in)
    this.pendingUtility = null;  // a utility clicked before locking that operator in
    this.level = null;           // the map floor shown
    this.hits = [];
    this.sig = {};
    this.build();
  }

  get open() { return this.view !== null; }

  build() {
    this.el.innerHTML = `
      <div class="pr-top">
        <div class="pr-phase"><span class="pr-step"></span><span class="pr-sub"></span></div>
        <div class="pr-timer"></div>
        <div class="pr-round"></div>
      </div>
      <div class="pr-tabs hidden">
        <button type="button" data-tab="operator">Operator</button>
        <button type="button" data-tab="spawn">Spawn point</button>
        <span class="pr-tabs-gap"></span>
        <button type="button" class="pr-back" data-back>Back to drone <kbd class="pr-key"></kbd></button>
      </div>
      <div class="pr-body">
        <section class="pr-location">
          <div class="pr-floors"></div>
          <div class="pr-map-wrap"><canvas class="pr-map"></canvas></div>
          <div class="pr-legend"></div>
        </section>
        <section class="pr-loadout">
          <div class="pr-grid-wrap"><div class="pr-grid-title"></div><div class="pr-grid"></div></div>
          <div class="pr-details">
            <div class="pr-model"><canvas class="pr-model-canvas"></canvas></div>
            <div class="pr-info"></div>
            <div class="pr-lockbar"></div>
          </div>
        </section>
      </div>
      <div class="pr-team"></div>
      <div class="pr-pop hidden"></div>`;
    this.mapCanvas = $(this.el, '.pr-map');
    this.modelCanvas = $(this.el, '.pr-model-canvas');

    // Clicks (one listener each for the parts that re-render)
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('mouseover', (e) => {
      const t = e.target.closest('.pr-op:not(.locked), .pr-btn, .pr-util, .pr-floor, .pr-mark, .pr-tabs button');
      if (t && t !== this.lastHover) { this.lastHover = t; menuAudio.tick(); }
    });
    this.mapCanvas.addEventListener('mousemove', (e) => {
      const hit = this.hitAt(e);
      this.mapCanvas.style.cursor = hit ? 'pointer' : 'default';
      if ((hit?.id ?? null) !== this.mapHover) { this.mapHover = hit?.id ?? null; if (hit) menuAudio.tick(); this.sig.map = null; }
    });
    this.mapCanvas.addEventListener('mouseleave', () => { this.mapHover = null; this.sig.map = null; });
    this.mapCanvas.addEventListener('click', (e) => { const hit = this.hitAt(e); if (hit) this.chooseMarker(hit.id); });
    window.addEventListener('resize', () => { this.sig.map = null; });
  }

  hitAt(e) {
    const r = this.mapCanvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    return this.hits.find((h) => Math.hypot(h.x - x, h.y - y) <= h.r) || null;
  }

  // ---------------------------------------------------------------- open, close, per-frame update

  /** s: the game's view of things (see game.preRoundState()). view: null closes the screen. */
  update(view, s) {
    if (view !== this.view) this.setView(view, s);
    if (!view) return;
    this.s = s;
    this.renderTop(s);
    if (view === 'location' || (view === 'prep' && this.prepTab === 'spawn')) this.renderLocation(s);
    else this.renderLoadout(s);
    this.renderTeam(s);
  }

  setView(view, s) {
    const was = this.view;
    this.view = view;
    this.sig = {};
    this.closePop();
    this.el.classList.toggle('hidden', !view);
    if (!view) { this.preview?.dispose(); this.preview = null; return; }
    if (was !== view) { menuAudio.whoosh(); this.el.classList.remove('pr-enter'); void this.el.offsetWidth; this.el.classList.add('pr-enter'); }
    if (view === 'location') this.level = null;
    if (view !== 'prep') this.prepTab = 'operator';
    if (view !== 'location') this.viewOp = s?.myOp || null;   // open on the operator you have
    this.applyLayout();
  }

  applyLayout() {
    const loc = this.view === 'location' || (this.view === 'prep' && this.prepTab === 'spawn');
    this.el.classList.toggle('pr-show-location', loc);
    this.el.classList.toggle('pr-show-loadout', !loc);
    this.el.classList.toggle('pr-prep', this.view === 'prep');
    $(this.el, '.pr-tabs').classList.toggle('hidden', this.view !== 'prep');
    for (const b of this.el.querySelectorAll('.pr-tabs [data-tab]')) b.classList.toggle('active', b.dataset.tab === this.prepTab);
    $(this.el, '.pr-key').textContent = keyFor('loadout');
    if (!loc && !this.preview) {
      // A fresh canvas each time: the last preview's renderer was thrown away with its canvas's context
      const canvas = document.createElement('canvas');
      canvas.className = 'pr-model-canvas';
      this.modelCanvas.replaceWith(canvas);
      this.modelCanvas = canvas;
      try { this.preview = new OpPreview(canvas); this.preview.start(); } catch (err) { console.warn('Operator preview unavailable:', err.message); this.preview = null; }
    }
    if (loc && this.preview) { this.preview.dispose(); this.preview = null; }
    this.sig = {};
  }

  // ---------------------------------------------------------------- header

  renderTop(s) {
    const attack = s.team === 'attack';
    const step = this.view === 'location' ? 'Location' : this.view === 'loadout' ? 'Loadout' : 'Prep phase';
    const sub = this.view === 'location' ? (attack ? 'Choose where you appear' : 'Vote for the site to defend')
      : this.view === 'loadout' ? 'Pick your operator, then lock in'
        : 'Change operator, utility or spawn point (closes 2 s before action)';
    const sig = `${step}|${sub}|${s.secondsLeft}|${s.round}|${s.team}`;
    if (sig === this.sig.top) return;
    this.sig.top = sig;
    $(this.el, '.pr-step').textContent = step;
    $(this.el, '.pr-sub').textContent = sub;
    const t = $(this.el, '.pr-timer');
    t.textContent = mmss(s.secondsLeft);
    t.classList.toggle('urgent', s.secondsLeft <= 3);
    $(this.el, '.pr-round').innerHTML = `Round ${s.round} · <b class="${attack ? 'atk' : 'def'}">${attack ? 'Attack' : 'Defense'}</b>`;
  }

  // ---------------------------------------------------------------- location: the map

  /** The markers on the map: the attackers' spawn points, or the defenders' sites (only on their own floor). */
  markers(s) {
    const levels = mapLevels(s.map);
    if (s.team === 'attack') {
      return s.map.spawns.attack.map((sp, i) => ({
        id: i + 1, x: sp.x, z: sp.z, y: 0, label: sp.name || `Spawn ${i + 1}`, short: String(i + 1), color: '#ff8a3d', selected: s.spawnChoice === i + 1, onEdge: true, level: 0,
      }));
    }
    return s.map.sites.map((site, i) => ({
      id: i, x: site.x, z: site.z, y: site.y, label: site.name, short: LETTERS[i], color: '#4da3ff', selected: s.siteVotes.mine === i, level: levelOf(levels, site.y),
    }));
  }

  renderLocation(s) {
    const levels = mapLevels(s.map), markers = this.markers(s);
    if (this.level === null) {
      // Start on the floor of what you picked (defenders' sites can be upstairs)
      const sel = markers.find((m) => m.selected) || markers[0];
      this.level = sel ? sel.level : 0;
    }
    // Who picked what, by name
    const names = {};
    if (s.team === 'attack') for (const [id, n] of Object.entries(s.spawnPicks || {})) (names[n] ||= []).push(s.names[id] || '?');
    else for (const [id, i] of Object.entries(s.siteVotes.votes || {})) (names[i] ||= []).push(s.names[id] || '?');
    const sig = JSON.stringify([this.level, markers.map((m) => [m.id, m.selected]), names, this.mapHover, this.mapCanvas.clientWidth, this.mapCanvas.clientHeight]);
    if (sig !== this.sig.map) {
      this.sig.map = sig;
      const shown = markers.filter((m) => m.level === this.level || m.onEdge);
      this.hits = drawTopMap(this.mapCanvas, s.map, { level: this.level, markers: shown, names, hover: this.mapHover });
    }
    const floorSig = JSON.stringify([this.level, levels.length, markers.map((m) => m.level)]);
    if (floorSig !== this.sig.floors) {
      this.sig.floors = floorSig;
      $(this.el, '.pr-floors').innerHTML = levels.map((l, i) => {
        const has = markers.some((m) => !m.onEdge && m.level === i);
        return `<button type="button" class="pr-floor${i === this.level ? ' active' : ''}" data-floor="${i}">${esc(l.name)}${has ? '<i class="dot"></i>' : ''}</button>`;
      }).join('');
    }
    const legendSig = JSON.stringify([markers.map((m) => [m.id, m.selected]), names, s.siteVotes.counts]);
    if (legendSig !== this.sig.legend) {
      this.sig.legend = legendSig;
      const title = s.team === 'attack' ? 'Spawn points' : 'Sites';
      $(this.el, '.pr-legend').innerHTML = `<div class="pr-legend-title">${title}</div>${markers.map((m) => {
        const who = names[m.id] || [];
        const where = s.team === 'attack' ? 'Outside' : levels[m.level]?.name || '';
        return `<button type="button" class="pr-mark${m.selected ? ' selected' : ''}" data-mark="${m.id}" style="--c:${m.color}">
          <span class="pr-mark-pin">${m.short}</span><span class="pr-mark-name"><b>${esc(m.label)}</b><i>${esc(where)}</i></span>
          <span class="pr-mark-who">${who.map((n) => esc(n)).join(', ') || '&nbsp;'}</span></button>`;
      }).join('')}
      <div class="pr-legend-keys"><span><i class="k-door"></i>Door</span><span><i class="k-window"></i>Window</span><span><i class="k-stairs"></i>Stairs</span></div>`;
    }
  }

  chooseMarker(id) {
    const s = this.s;
    menuAudio.select();
    if (s.team === 'attack') this.hooks.pickSpawn(Number(id));
    else if (this.view === 'location') this.hooks.voteSite(Number(id));
    this.sig.map = null;
  }

  // ---------------------------------------------------------------- loadout: grid, details, team row

  renderLoadout(s) {
    const ops = operatorsFor(s.team);
    if (!this.viewOp || OPERATORS[this.viewOp]?.team !== s.team) this.viewOp = s.myOp || ops[0].id;
    const takenBy = {};
    for (const [id, p] of Object.entries(s.picks || {})) if (p.confirmed && id !== s.myId && OPERATORS[p.op]?.unique) takenBy[p.op] = s.names[id] || 'Teammate';
    const gridSig = JSON.stringify([s.team, this.viewOp, s.myOp, s.myConfirmed, takenBy, s.owned, s.opMatches]);
    if (gridSig !== this.sig.grid) {
      this.sig.grid = gridSig;
      $(this.el, '.pr-grid-title').innerHTML = `${s.team === 'attack' ? 'Attackers' : 'Defenders'} <span>${ops.length}</span>`;
      $(this.el, '.pr-grid').innerHTML = ops.map((op) => {
        const locked = !!op.price && !s.owned.includes(op.id);
        const taken = takenBy[op.id];
        const mine = op.id === s.myOp && s.myConfirmed;
        const played = s.opMatches?.[op.id] || 0;
        const cls = ['pr-op', op.id === this.viewOp ? 'selected' : '', locked ? 'locked' : '', taken ? 'taken' : '', mine ? 'mine' : ''].join(' ');
        return `<button type="button" class="${cls}" data-op="${op.id}" style="--c:${hex(op.color)}" title="${esc(op.name)}">
          <span class="pr-op-icon">${operatorIcon(op.id, 72)}</span>
          ${played ? `<span class="pr-op-badge" title="Matches played">${played > 999 ? '999+' : played}</span>` : ''}
          ${locked ? '<span class="pr-op-lock"><svg viewBox="0 0 24 24" width="22" height="22"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg></span>' : ''}
          ${taken ? `<span class="pr-op-taken">${esc(taken)}</span>` : ''}
          ${mine ? '<span class="pr-op-check">✓</span>' : ''}
          <span class="pr-op-name">${esc(op.name)}</span></button>`;
      }).join('');
    }
    this.renderDetails(s, takenBy);
  }

  renderDetails(s, takenBy) {
    const op = OPERATORS[this.viewOp];
    if (!op) return;
    const skins = s.skins || {}, charms = s.charms || {};
    const locked = !!op.price && !s.owned.includes(op.id);
    const taken = takenBy[op.id];
    const isMine = op.id === s.myOp && s.myConfirmed;
    const utility = isMine ? s.myUtility : (this.pendingUtility && op.utilities.includes(this.pendingUtility) ? this.pendingUtility : op.utilities[0]);
    const sig = JSON.stringify([op.id, locked, taken, isMine, utility, skins[op.weapons.primary], skins[op.weapons.secondary], charms[op.weapons.primary], charms[op.weapons.secondary], this.view]);
    this.preview?.setLook({ team: op.team, operatorId: op.id, weaponId: op.weapons.primary, skinId: skins[op.weapons.primary] || null, charmId: charms[op.weapons.primary] || null });
    if (sig === this.sig.details) return;
    this.sig.details = sig;
    const bars = (n) => `<span class="pr-bars">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
    const gun = (slot, id) => {
      const w = WEAPONS[id], skin = SKINS[skins[id]], charm = CHARMS[charms[id]];
      const rar = skin ? RARITIES[skin.rarity] : null;
      return `<div class="pr-gun" data-gun="${id}">
        <span class="pr-gun-slot">${slot === 'primary' ? 1 : 2}</span>
        <span class="pr-gun-pic">${gunIcon(w.model, hex(w.accent), 64)}</span>
        <span class="pr-gun-name"><b>${esc(w.name)}</b><i>${esc(w.kind)}</i></span>
        <span class="pr-gun-look">
          <button type="button" class="pr-btn small" data-skins="${id}" title="Change skin"${skin ? ` style="--rar:${rar.color}"` : ''}>${skin ? esc(skin.name) : 'Skin'}</button>
          <button type="button" class="pr-btn small" data-charms="${id}" title="Change charm">${charm ? esc(charm.name) : 'Charm'}</button>
        </span></div>`;
    };
    const lockLabel = locked ? `Locked · ${op.price.toLocaleString()} Money` : taken ? `Taken by ${esc(taken)}` : isMine ? 'Locked in ✓' : 'Lock in';
    $(this.el, '.pr-info').innerHTML = `
      <div class="pr-name" style="--c:${hex(op.color)}">${esc(op.name)}</div>
      <div class="pr-side ${op.team === 'attack' ? 'atk' : 'def'}">${op.team === 'attack' ? 'Attack' : 'Defense'}</div>
      <div class="pr-ratings"><span>Speed ${bars(op.speed)}</span><span>Armour ${bars(op.armor)}</span></div>
      <div class="pr-ability">
        <span class="pr-ability-icon">${operatorIcon(op.id, 40)}</span>
        <span>${op.ability ? `<b>${esc(op.ability.name)}</b><i>${esc(fillKeys(op.ability.desc))}</i>` : '<b>No special ability</b><i>A solid all-rounder.</i>'}</span>
      </div>
      <div class="pr-label">Guns <span>hover for stats</span></div>
      ${gun('primary', op.weapons.primary)}${gun('secondary', op.weapons.secondary)}
      <div class="pr-label">Utility</div>
      <div class="pr-utils">${op.utilities.map((id) => {
        const u = UTILITIES[id];
        return `<button type="button" class="pr-util${id === utility ? ' chosen' : ''}" data-util="${id}" title="${esc(u.desc)}"><b>${esc(u.name)}</b><span>×${u.charges}</span></button>`;
      }).join('')}</div>`;
    $(this.el, '.pr-lockbar').innerHTML = `<button type="button" class="pr-lock${isMine ? ' done' : ''}" data-lock${locked || taken || isMine ? ' disabled' : ''}>${lockLabel}</button>`;
  }

  renderTeam(s) {
    const mates = Object.entries(s.picks || {});
    const sig = JSON.stringify([mates, s.myId]);
    if (sig === this.sig.team) return;
    this.sig.team = sig;
    $(this.el, '.pr-team').innerHTML = `<span class="pr-team-title">Your team</span>${mates.map(([id, p]) => `
      <span class="pr-mate${id === s.myId ? ' me' : ''}${p.confirmed ? ' locked' : ''}">
        ${p.confirmed ? operatorIcon(p.op, 38) : '<span class="pr-mate-q">?</span>'}
        <span class="pr-mate-text"><b>${esc(s.names[id] || 'Player')}</b><i>${p.confirmed ? esc(OPERATORS[p.op]?.name || '') : 'Choosing…'}</i></span>
      </span>`).join('')}`;
  }

  // ---------------------------------------------------------------- clicks

  onClick(e) {
    const t = e.target;
    const tab = t.closest('[data-tab]');
    if (tab) { this.prepTab = tab.dataset.tab; menuAudio.select(); this.applyLayout(); return; }
    if (t.closest('[data-back]')) { this.hooks.backToDrone(); return; }
    const floor = t.closest('[data-floor]');
    if (floor) { this.level = Number(floor.dataset.floor); menuAudio.select(); this.sig.map = this.sig.floors = null; return; }
    const mark = t.closest('[data-mark]');
    if (mark) {
      const m = this.markers(this.s).find((x) => String(x.id) === mark.dataset.mark);
      if (m && !m.onEdge) this.level = m.level;
      this.chooseMarker(mark.dataset.mark);
      return;
    }
    const op = t.closest('[data-op]');
    if (op) {
      if (op.classList.contains('locked')) { this.hooks.toast(`Buy ${OPERATORS[op.dataset.op].name} in the Operators tab first.`); }
      this.viewOp = op.dataset.op;
      this.pendingUtility = null;
      this.closePop();
      menuAudio.select();
      this.sig.grid = this.sig.details = null;
      return;
    }
    const util = t.closest('[data-util]');
    if (util) {
      menuAudio.select();
      const s = this.s;
      if (this.viewOp === s.myOp && s.myConfirmed) this.hooks.pickUtility(util.dataset.util);
      else { this.pendingUtility = util.dataset.util; this.sig.details = null; }
      return;
    }
    if (t.closest('[data-lock]')) { this.lockIn(); return; }
    const skins = t.closest('[data-skins]');
    if (skins) { this.openPop('skin', skins.dataset.skins, skins); return; }
    const charms = t.closest('[data-charms]');
    if (charms) { this.openPop('charm', charms.dataset.charms, charms); return; }
    const pick = t.closest('[data-pick]');
    if (pick) { this.applyLook(pick.dataset.kind, pick.dataset.gun, pick.dataset.pick || null); return; }
    if (!t.closest('.pr-pop')) this.closePop();
  }

  lockIn() {
    const op = this.viewOp, util = this.pendingUtility;
    menuAudio.lockIn();
    this.el.querySelector('.pr-lock')?.classList.add('pulse');
    this.hooks.pickOperator(op);
    if (util && OPERATORS[op]?.utilities.includes(util)) this.hooks.pickUtility(util);
    this.pendingUtility = null;
  }

  // ---------------------------------------------------------------- skins and charms

  openPop(kind, gunId, anchor) {
    const a = this.hooks.getAccount();
    if (!a) return this.hooks.toast('Log in to change skins and charms.');
    const current = kind === 'skin' ? this.s.skins?.[gunId] || '' : this.s.charms?.[gunId] || '';
    let items;
    if (kind === 'skin') {
      const owned = a.ownedSkins?.[gunId] || [];
      items = [{ id: '', name: 'Default', color: '#9aa4b1' }, ...owned.filter((id) => SKINS[id]).map((id) => ({ id, name: SKINS[id].name, color: RARITIES[SKINS[id].rarity]?.color || '#fff' }))];
    } else {
      const owned = a.ownedCharms || [];
      items = [{ id: '', name: 'No charm', color: '#9aa4b1' }, ...owned.filter((id) => CHARMS[id]).map((id) => ({ id, name: CHARMS[id].name, color: RARITIES[CHARMS[id].rarity]?.color || '#fff' }))];
    }
    const pop = $(this.el, '.pr-pop');
    pop.innerHTML = `<div class="pr-pop-head">${kind === 'skin' ? 'Skin' : 'Charm'} for ${esc(WEAPONS[gunId].name)}</div>
      <div class="pr-pop-list">${items.map((it) => `<button type="button" class="pr-pop-item${it.id === current ? ' current' : ''}" data-pick="${it.id}" data-kind="${kind}" data-gun="${gunId}" style="--rar:${it.color}">${esc(it.name)}</button>`).join('')}</div>
      ${items.length === 1 ? `<div class="pr-pop-note">You don't own any ${kind}s for this gun yet.</div>` : ''}`;
    pop.classList.remove('hidden');
    const r = anchor.getBoundingClientRect(), host = this.el.getBoundingClientRect();
    const top = Math.min(r.bottom - host.top + 6, host.height - pop.offsetHeight - 10);
    pop.style.left = `${Math.max(10, Math.min(r.left - host.left - 120, host.width - pop.offsetWidth - 10))}px`;
    pop.style.top = `${Math.max(10, top)}px`;
    menuAudio.select();
  }

  closePop() { $(this.el, '.pr-pop')?.classList.add('hidden'); }

  async applyLook(kind, gunId, id) {
    this.closePop();
    const res = kind === 'skin' ? await equipSkin(gunId, id) : await equipCharm(gunId, id);
    if (res.error) return this.hooks.toast(res.error);
    this.hooks.setAccount(res.account);
    this.hooks.onSkinsChanged(res.account.equippedSkins || {}, res.account.equippedCharms || {});
    this.hooks.refreshLook();
    menuAudio.select();
  }
}
