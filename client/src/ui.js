// DOM screens: home (name + create/join), room lobby, and the in-game HUD.

import { MAX_PER_TEAM, MAX_HEALTH } from '../../shared/constants.js';
import { WEAPONS, weaponStats } from '../../shared/weapons.js';
import { UTILITIES } from '../../shared/utilities.js';
import { MAP } from '../../shared/map.js';
import { operatorsFor, OPERATORS } from '../../shared/operators.js';
import { settings, setSetting, setKeybinds, onSettingsChange } from './settings.js';
import { fillKeys, keyFor } from './controls.js';
import { rankIcon } from './rankIcon.js';
import { rankInfo, rankStep, xpForLevel } from '../../shared/progression.js';
import { BIND_ACTIONS, DEFAULT_KEYBINDS, keyLabel, isBindableCode, RESERVED_CODES } from '../../shared/keybinds.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.screens = { auth: $('screen-auth'), home: $('screen-home'), lobby: $('screen-lobby') };
    this.hud = $('hud');
    this.fpsAvg = 60;
    this.statsTimer = 0;
    this.authMode = 'login';
    this.bindSettings();
    this.bindGunTips();
    $('summary-close').addEventListener('click', () => this.hideMatchSummary());
  }

  // ---------------------------------------------------------------- settings

  bindSettings() {
    const fmt = { sensitivity: (v) => `${Number(v).toFixed(2)}×`, volume: (v) => `${Math.round(v * 100)}%`, fov: (v) => `${Math.round(v)}°` };
    for (const name of Object.keys(fmt)) {
      const input = $(`set-${name}`);
      input.value = settings[name];
      $(`val-${name}`).textContent = fmt[name](settings[name]);
      input.addEventListener('input', () => {
        setSetting(name, input.value);
        $(`val-${name}`).textContent = fmt[name](settings[name]);
      });
    }
    // Settings can also change from outside (loaded from the account after login).
    onSettingsChange((name, value) => {
      if (name === 'keybinds') return this.renderKeybinds();
      if (!fmt[name]) return;
      $(`set-${name}`).value = value;
      $(`val-${name}`).textContent = fmt[name](value);
    });
    this.bindKeybinds();
    for (const btn of document.querySelectorAll('.settings-open')) btn.addEventListener('click', () => this.openSettings(false));
    $('settings-close').addEventListener('click', () => { this.closeSettings(); this.onSettingsClosed?.(); });
  }

  /** inGame: opened by Esc during a match (shows the resume hint). */
  openSettings(inGame) {
    $('settings').classList.remove('hidden');
    $('settings-title').textContent = inGame ? 'Paused' : 'Settings';
    $('settings-hint').classList.toggle('hidden', !inGame);
    this.settingsInGame = inGame;
  }

  closeSettings() {
    this.stopListening();
    $('settings').classList.add('hidden');
    this.settingsInGame = false;
  }

  // ---------------------------------------------------------------- keybinds

  bindKeybinds() {
    this.listeningFor = null;
    this.capture = null;
    this.swallowUntil = 0;   // the click/context menu that follows a captured mouse button
    for (const ev of ['click', 'contextmenu']) {
      window.addEventListener(ev, (e) => {
        if (performance.now() < this.swallowUntil) { e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);
    }
    $('keybind-list').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (btn) this.startListening(btn.dataset.action);
    });
    $('keybinds-reset').addEventListener('click', () => {
      this.stopListening();
      setKeybinds(DEFAULT_KEYBINDS);
      this.keybindMsg('All keybinds are back to their defaults.');
    });
    this.renderKeybinds();
  }

  renderKeybinds() {
    let group = '';
    const html = [];
    for (const a of BIND_ACTIONS) {
      if (a.group !== group) { group = a.group; html.push(`<div class="kb-group">${group}</div>`); }
      const code = settings.keybinds[a.id];
      const listening = this.listeningFor === a.id;
      const cls = listening ? 'listening' : code ? '' : 'unbound';
      html.push(`<div class="kb-row"><span>${a.label}</span><button type="button" data-action="${a.id}" class="${cls}">${listening ? 'Press a key…' : escapeHtml(keyLabel(code))}</button></div>`);
    }
    $('keybind-list').innerHTML = html.join('');
  }

  keybindMsg(text) { $('keybind-msg').textContent = text || ''; }

  /** Wait for the next key or mouse button and bind it to `action`. Nothing else sees that input. */
  startListening(action) {
    this.stopListening();
    this.listeningFor = action;
    this.keybindMsg('');
    const swallow = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    this.capture = {
      keydown: (e) => {
        swallow(e);
        if (e.repeat) return;
        if (e.code === 'Escape') this.stopListening();
        else if (e.code === 'Backspace' || e.code === 'Delete') this.assignKey(action, '');
        else this.assignKey(action, e.code);
      },
      keyup: swallow,
      mousedown: (e) => {
        swallow(e);
        this.swallowUntil = performance.now() + 500;
        this.assignKey(action, `Mouse${e.button}`);
      },
    };
    for (const [ev, fn] of Object.entries(this.capture)) window.addEventListener(ev, fn, true);
    this.renderKeybinds();
  }

  stopListening() {
    if (!this.capture) return;
    for (const [ev, fn] of Object.entries(this.capture)) window.removeEventListener(ev, fn, true);
    this.capture = null;
    this.listeningFor = null;
    this.renderKeybinds();
  }

  /** Bind `code` to `action`. If another action had it, the two swap keys. */
  assignKey(action, code) {
    if (code && !isBindableCode(code)) {
      this.keybindMsg(RESERVED_CODES.has(code) ? `${keyLabel(code)} is reserved. Pick another key.` : 'That key can\'t be bound. Pick another key.');
      return;
    }
    const binds = { ...settings.keybinds };
    const prev = binds[action];
    const other = code && BIND_ACTIONS.find((a) => a.id !== action && binds[a.id] === code);
    if (other) binds[other.id] = prev;
    binds[action] = code;
    this.stopListening();
    setKeybinds(binds);
    this.keybindMsg(other ? `${other.label} ${prev ? `is now on ${keyLabel(prev)}` : 'is now unbound'}.` : '');
  }

  get settingsOpen() {
    return !$('settings').classList.contains('hidden');
  }

  // ---------------------------------------------------------------- in-game extras

  setHint(text) {
    if (text === this.lastHint) return;
    this.lastHint = text;
    $('controls-hint').textContent = text;
  }

  toggleHint() {
    $('controls-hint').classList.toggle('off');
  }

  banner(title, sub = '', ms = 2600) {
    const el = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    el.classList.remove('hidden');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  setLowHealth(on) {
    this.hud.classList.toggle('lowhp', on);
  }

  /** Tab scoreboard. rows: [{ id, name, team, k, d, alive, op, me }] */
  renderBoard(visible, rows, scores) {
    const el = $('board');
    el.classList.toggle('hidden', !visible);
    if (!visible) return;
    const table = (team, title, score) => {
      const list = rows.filter((r) => r.team === team).sort((a, b) => b.k - a.k || a.d - b.d);
      const body = list.map((r) => `
        <tr class="${r.me ? 'me' : ''}${r.alive ? '' : ' dead'}">
          <td class="nm">${escapeHtml(r.name)}</td><td class="opn">${r.op ? escapeHtml(OPERATORS[r.op]?.name || '') : '—'}</td>
          <td>${r.k}</td><td>${r.d}</td></tr>`).join('');
      return `<div class="board-team ${team}"><h3>${title} <span>${score}</span></h3>
        <table><thead><tr><th>Player</th><th>Operator</th><th>K</th><th>D</th></tr></thead><tbody>${body}</tbody></table></div>`;
    };
    el.innerHTML = `<div class="board-inner">${table('attack', 'Attack', scores.attack)}${table('defense', 'Defense', scores.defense)}</div>`;
  }

  /** Lobby: copy the room code to the clipboard. */
  bindCopyCode() {
    $('copy-code').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('room-code').textContent); $('copy-code').textContent = 'Copied!'; }
      catch { $('copy-code').textContent = 'Select the code to copy'; }
      setTimeout(() => { $('copy-code').textContent = 'Copy code'; }, 1500);
    });
  }

  show(screen) {
    for (const [key, el] of Object.entries(this.screens)) el.classList.toggle('hidden', key !== screen);
    this.hud.classList.toggle('hidden', screen !== 'game');
    this.onShow?.(screen);   // the main menu starts and stops its 3D scene
  }

  // ---------------------------------------------------------------- account

  /** onSubmit(mode, username, password), mode 'login' | 'signup'. */
  bindAuth({ onSubmit, onLogout }) {
    for (const tab of document.querySelectorAll('.auth-tab')) {
      tab.addEventListener('click', () => this.setAuthMode(tab.dataset.mode));
    }
    $('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      onSubmit(this.authMode, $('auth-username').value.trim(), $('auth-password').value);
    });
    $('logout-btn').addEventListener('click', onLogout);
  }

  setAuthMode(mode) {
    this.authMode = mode;
    for (const tab of document.querySelectorAll('.auth-tab')) tab.classList.toggle('active', tab.dataset.mode === mode);
    const signup = mode === 'signup';
    $('auth-submit').textContent = signup ? 'Create account' : 'Log in';
    $('auth-password').autocomplete = signup ? 'new-password' : 'current-password';
    $('auth-rules').classList.toggle('hidden', !signup);
    this.authError('');
  }

  authBusy(busy) { $('auth-submit').disabled = busy; }
  authError(msg) { $('auth-error').textContent = msg || ''; }
  showStorageWarning(on) { $('auth-storage').classList.toggle('hidden', !on); }
  clearPassword() { $('auth-password').value = ''; }

  renderProfile(p) {
    $('profile-name').textContent = p.username;
    $('profile-level').textContent = `· Level ${p.level} (${(p.xp - xpForLevel(p.level)).toLocaleString()} / ${(xpForLevel(p.level + 1) - xpForLevel(p.level)).toLocaleString()} XP)`;
    $('profile-money').textContent = p.money.toLocaleString();
    $('profile-polish').textContent = p.polishMoney.toLocaleString();
    const rank = rankInfo(p.rankPoints);
    $('profile-rank-icon').innerHTML = rankIcon(rank, 44);
    $('profile-rank-label').textContent = rank.label;
    $('profile-rank-label').style.color = rank.color;
    $('profile-rank').textContent = rank.ceiling === null ? `${p.rankPoints} points` : `${p.rankPoints} / ${rank.ceiling} to ${rank.nextLabel}`;
    $('profile-rank-bar').style.width = `${Math.round(rank.progress * 100)}%`;
    $('profile-rank-bar').style.background = rank.color;
    this.renderQuests(p.quests);
  }

  // ---------------------------------------------------------------- daily quests

  renderQuests(quests) {
    this.questsExpireAt = quests?.expiresAt ? Date.parse(quests.expiresAt) : 0;
    $('quest-list').innerHTML = (quests?.list || []).map((q) => `
      <div class="quest${q.done ? ' done' : ''}">
        <div class="quest-top"><span class="quest-label">${q.done ? '✔ ' : ''}${escapeHtml(q.label)}</span><b>+${q.reward}</b></div>
        <div class="quest-row"><div class="bar thin"><div style="width:${Math.round((q.progress / q.target) * 100)}%"></div></div><span class="muted">${q.progress} / ${q.target}</span></div>
      </div>`).join('') || '<div class="muted">No quests right now.</div>';
    this.updateQuestTimer();
    if (!this.questTimer) this.questTimer = setInterval(() => this.updateQuestTimer(), 30000);
  }

  updateQuestTimer() {
    const left = this.questsExpireAt - Date.now();
    const el = $('quest-timer');
    if (!this.questsExpireAt) { el.textContent = ''; return; }
    if (left <= 0) { el.textContent = 'New quests on your next visit'; return; }
    const h = Math.floor(left / 3600000), m = Math.floor((left % 3600000) / 60000);
    el.textContent = `New quests in ${h}h ${String(m).padStart(2, '0')}m`;
  }

  // ---------------------------------------------------------------- end-of-match summary

  /** The server's verdict on a finished match: Money, XP, quests and the rank change. */
  showMatchSummary(s) {
    if (document.pointerLockElement) document.exitPointerLock();
    const el = $('match-summary');
    el.classList.remove('hidden');
    const body = $('summary-body');
    if (s.none) {
      $('summary-title').textContent = 'MATCH OVER';
      $('summary-title').className = 'summary-title';
      $('summary-score').textContent = '';
      body.innerHTML = `<p class="muted center">${escapeHtml(s.reason || '')}</p>`;
      return;
    }
    $('summary-title').textContent = s.won ? 'VICTORY' : 'DEFEAT';
    $('summary-title').className = `summary-title ${s.won ? 'win' : 'lose'}`;
    $('summary-score').textContent = `${s.score.yours} – ${s.score.theirs} in rounds · ${s.stats.kills} kills · ${s.stats.deaths} deaths`;

    const before = rankInfo(s.rank.before), after = rankInfo(s.rank.after);
    const stepDelta = rankStep(s.rank.after) - rankStep(s.rank.before);
    const verdict = stepDelta > 0 ? `<div class="rank-verdict up">PROMOTED to ${after.label}</div>`
      : stepDelta < 0 ? `<div class="rank-verdict down">Demoted to ${after.label}</div>` : '';
    const sign = s.rank.delta > 0 ? '+' : s.rank.delta < 0 ? '−' : '±';
    const rankBlock = `
      <div class="summary-rank">
        <div class="rank-side">${rankIcon(before, 46)}<span style="color:${before.color}">${before.label}</span></div>
        <div class="rank-mid"><b class="${s.rank.delta >= 0 ? 'up' : 'down'}">${sign}${Math.abs(s.rank.delta)}</b><span class="muted">rank points</span></div>
        <div class="rank-side">${rankIcon(after, 46)}<span style="color:${after.color}">${after.label}</span></div>
      </div>
      ${verdict}
      <div class="bar thin"><div style="width:${Math.round(after.progress * 100)}%;background:${after.color}"></div></div>
      <div class="muted center small-note">${after.ceiling === null ? `${s.rank.after} points` : `${s.rank.after} / ${after.ceiling} to ${after.nextLabel}`}</div>`;

    const lines = s.money.lines.map((l) => `<div class="sum-line"><span>${escapeHtml(l.label)}</span><b>+${l.amount}</b></div>`).join('');
    const quests = s.money.quests.length
      ? `<div class="sum-sub">Quests completed</div>${s.money.quests.map((q) => `<div class="sum-line quest-done"><span>✔ ${escapeHtml(q.label)}</span><b>+${q.reward}</b></div>`).join('')}` : '';
    const leveled = s.xp.levelAfter > s.xp.levelBefore ? `<div class="levelup">LEVEL UP! You are now level ${s.xp.levelAfter}</div>` : '';
    body.innerHTML = `
      ${rankBlock}
      <div class="sum-sub">Money earned</div>
      ${lines}${quests}
      <div class="sum-line total"><span>Total</span><b>+${s.money.total + s.money.questTotal}</b></div>
      <div class="muted center small-note">Balance: ${s.money.balance.toLocaleString()} · +${s.xp.gained} XP</div>
      ${leveled}`;
  }

  hideMatchSummary() {
    $('match-summary').classList.add('hidden');
  }

  get code() {
    return $('code-input').value.trim().toUpperCase();
  }

  homeError(msg) { $('home-error').textContent = msg || ''; }
  lobbyError(msg) { $('lobby-error').textContent = msg || ''; }

  bindHome({ onCreate, onJoin }) {
    $('create-btn').addEventListener('click', onCreate);
    $('join-btn').addEventListener('click', onJoin);
    $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') onJoin(); });
    $('code-input').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  }

  bindLobby({ onTeam, onStart, onLeave }) {
    for (const btn of document.querySelectorAll('.team-btn')) {
      btn.addEventListener('click', () => onTeam(btn.dataset.team));
    }
    $('start-btn').addEventListener('click', onStart);
    $('leave-btn').addEventListener('click', onLeave);
  }

  renderLobby(room, myId) {
    $('room-code').textContent = room.code;
    for (const t of ['attack', 'defense']) {
      $(`count-${t}`).textContent = `${room.players.filter((p) => p.team === t).length}/${MAX_PER_TEAM}`;
    }
    $('hud-room').textContent = `ROOM ${room.code}`;
    const me = room.players.find((p) => p.id === myId);
    const isHost = room.hostId === myId;

    for (const team of ['attack', 'defense']) {
      const list = $(`team-${team}`);
      list.innerHTML = '';
      const members = room.players.filter((p) => p.team === team);
      for (const p of members) {
        const li = document.createElement('li');
        if (p.id === myId) li.classList.add('me');
        const name = document.createElement('span');
        name.textContent = p.name;
        li.appendChild(name);
        if (p.id === room.hostId) {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = 'host';
          li.appendChild(tag);
        }
        list.appendChild(li);
      }
      const btn = document.querySelector(`.team-btn[data-team="${team}"]`);
      btn.disabled = me?.team === team || members.length >= MAX_PER_TEAM;
    }

    const startBtn = $('start-btn');
    startBtn.classList.toggle('hidden', !isHost);
    $('lobby-status').textContent = isHost
      ? `${room.players.length} player${room.players.length === 1 ? '' : 's'} in room. Start when everyone is ready.`
      : 'Waiting for the host to start the match…';
  }

  // ---------------------------------------------------------------- combat HUD

  updateCombat({ health, weapon, alive, slotKeys = ['1', '2'] }) {
    if (health !== this.lastHealth) {
      this.lastHealth = health;
      $('health-value').textContent = Math.ceil(health);
      $('health-bar').style.width = `${(health / MAX_HEALTH) * 100}%`;
      $('health-box').classList.toggle('low', health <= 30);
    }
    if (weapon) {
      const w = WEAPONS[weapon.id];
      const other = weapon.other;
      const key = `${weapon.id}|${weapon.ammo}|${weapon.reserve}|${weapon.reload > 0}|${other?.id}|${other?.ammo}|${other?.reserve}|${slotKeys}`;
      if (key !== this.lastAmmoKey) {
        this.lastAmmoKey = key;
        $('weapon-name').textContent = `${w.name} · ${w.kind}`;
        const o = other && WEAPONS[other.id];
        $('weapon-other').textContent = o ? `${slotKeys[weapon.slot === 0 ? 1 : 0]} ${o.name} ${other.ammo} / ${other.reserve}` : '';
        $('ammo-mag').textContent = weapon.ammo;
        $('ammo-reserve').textContent = ` / ${weapon.reserve}`;
        $('reload-text').classList.toggle('hidden', !(weapon.reload > 0));
        $('ammo-box').classList.toggle('empty', weapon.ammo === 0);
      }
    }
    for (const id of ['crosshair', 'health-box', 'ammo-box']) $(id).classList.toggle('hidden', !alive);
    this.hud.classList.toggle('dead', !alive);
  }

  setCrosshairGap(px) {
    $('crosshair').style.setProperty('--gap', `${Math.round(Math.max(4, Math.min(80, px)))}px`);
  }

  showHitmarker(head, kill) {
    const el = $('hitmarker');
    el.className = '';
    void el.offsetWidth; // restart the fade
    el.classList.add('show');
    if (head) el.classList.add('head');
    if (kill) el.classList.add('kill');
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => el.classList.remove('show'), kill ? 220 : 90);
  }

  /** angle: direction of the attacker relative to where we face, radians, clockwise. */
  showDamage(angle) {
    const v = $('damage-vignette');
    v.classList.remove('show'); void v.offsetWidth; v.classList.add('show');
    clearTimeout(this.vigTimer);
    this.vigTimer = setTimeout(() => v.classList.remove('show'), 80);

    const d = $('damage-indicator');
    d.style.transform = `rotate(${angle}rad)`;
    d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
    clearTimeout(this.dirTimer);
    this.dirTimer = setTimeout(() => d.classList.remove('show'), 150);
  }

  addKill({ killer, victim, weapon, head, mine }) {
    const li = document.createElement('li');
    if (mine) li.classList.add('mine');
    const k = document.createElement('span');
    k.className = killer.team; k.textContent = killer.name;
    const w = document.createElement('span');
    w.className = 'weapon'; w.textContent = `${WEAPONS[weapon]?.name || UTILITIES[weapon]?.name || weapon}${head ? ' · head' : ''}`;
    const v = document.createElement('span');
    v.className = victim.team; v.textContent = victim.name;
    li.append(k, w, v);
    const feed = $('killfeed');
    feed.prepend(li);
    while (feed.children.length > 5) feed.lastChild.remove();
    setTimeout(() => li.classList.add('fade'), 6000);
    setTimeout(() => li.remove(), 6600);
  }

  /** op: operator config; lines: [{ key, label, value }] */
  updateGadgets(op, lines, alive) {
    const sig = `${op?.id}|${alive}|${lines.map((l) => `${l.key}${l.label}${l.value}`).join('|')}`;
    if (sig === this.lastGadget) return;
    this.lastGadget = sig;
    $('gadget-box').classList.toggle('hidden', !alive);
    $('op-name').textContent = op ? op.name : '';
    $('op-swatch').style.background = op ? `#${op.color.toString(16).padStart(6, '0')}` : 'transparent';
    const box = $('gadget-lines');
    box.innerHTML = '';
    for (const l of lines) {
      const row = document.createElement('div');
      row.className = 'gadget-row';
      row.innerHTML = `<span class="keycap">${l.key}</span> <span class="gadget-label">${l.label}</span> <b>${l.value}</b>`;
      box.appendChild(row);
    }
  }

  /** Defenders vote on the objective site during operator select; attackers just wait. */
  renderSiteVote(on, { team, counts, mine, onVote }) {
    const el = $('site-vote');
    el.classList.toggle('hidden', !on);
    if (!on) { this.lastSiteVote = null; return; }
    const sig = JSON.stringify([team, counts, mine]);
    if (sig === this.lastSiteVote) return;
    this.lastSiteVote = sig;
    if (team !== 'defense') {
      el.innerHTML = '<div class="site-note">The defenders are choosing where the objective is. Find it with your drones during prep.</div>';
      return;
    }
    el.innerHTML = '<div class="site-title">Vote for the objective site</div><div class="site-options"></div>';
    const row = el.querySelector('.site-options');
    MAP.sites.forEach((site, i) => {
      const b = document.createElement('button');
      b.className = `site-option${mine === i ? ' selected' : ''}`;
      b.innerHTML = `<b>${site.name}</b><span>${site.where}</span><span class="votes">${counts[i]} vote${counts[i] === 1 ? '' : 's'}</span>`;
      b.addEventListener('click', () => onVote(i));
      row.appendChild(b);
    });
  }

  setSiteChip(text) {
    if (text === this.lastSiteChip) return;
    this.lastSiteChip = text;
    $('site-chip').textContent = text;
  }

  /** White-out after a stun grenade. frac 1 = fully blind, 0 = clear. */
  setStun(frac) {
    const v = Math.round(frac * 100) / 100;
    if (v === this.lastStun) return;
    this.lastStun = v;
    $('stun-overlay').style.opacity = String(v);
  }

  // ---------------------------------------------------------------- operator select

  showOperatorSelect(on, { team, picks, names, myId, myOp, myUtility, timeText, onPick, onUtility } = {}) {
    const el = $('op-select');
    el.classList.toggle('hidden', !on);
    this.hud.classList.toggle('selecting', on);
    if (!on) { this.lastSelect = null; return; }
    $('op-timer').textContent = timeText;
    const sig = JSON.stringify([team, picks, myOp, myUtility]);
    if (sig === this.lastSelect) return;
    this.lastSelect = sig;
    const cards = $('op-cards');
    cards.innerHTML = '';
    this.hideGunTip();   // the card under the pointer is about to be replaced
    const pips = (n) => '●'.repeat(n) + '○'.repeat(3 - n);
    const gunRow = (id, slot) => {
      const g = WEAPONS[id];
      return `<div class="op-gun" data-gun="${id}"><span class="slot">${slot}</span><b>${escapeHtml(g.name)}</b><i>${escapeHtml(g.kind)}</i></div>`;
    };
    for (const op of operatorsFor(team)) {
      const holderId = Object.keys(picks || {}).find((id) => picks[id].op === op.id && picks[id].confirmed && id !== myId);
      const taken = op.unique && !!holderId;
      const mine = op.id === myOp;
      const card = document.createElement('div');
      card.className = `op-card${mine ? ' selected' : ''}${taken ? ' taken' : ''}`;
      const utilities = op.utilities.map((id) => {
        const u = UTILITIES[id];
        const chosen = mine && id === myUtility;
        return `<button type="button" class="op-util${chosen ? ' chosen' : ''}" data-util="${id}" title="${escapeHtml(u.desc)}"${mine ? '' : ' tabindex="-1"'}>${escapeHtml(u.name)}<span>×${u.charges}</span></button>`;
      }).join('');
      card.innerHTML = `
        <div class="op-color" style="background:#${op.color.toString(16).padStart(6, '0')}"></div>
        <div class="op-name">${op.name}</div>
        <div class="op-guns">${gunRow(op.weapons.primary, 1)}${gunRow(op.weapons.secondary, 2)}</div>
        <div class="op-stats"><span>SPEED ${pips(op.speed)}</span><span>ARMOR ${pips(op.armor)}</span></div>
        <div class="op-ab">${op.ability ? `<b>${op.ability.name}</b><br>${fillKeys(op.ability.desc)}` : '<i>No special ability</i>'}</div>
        <div class="op-utils-label">Utility${mine ? ' (pick one)' : ''}</div>
        <div class="op-utils${mine ? '' : ' inactive'}">${utilities}</div>
        <div class="op-who">${taken ? `Taken by ${names[holderId] || 'a teammate'}` : (mine ? 'Your pick' : (op.unique ? '' : 'Unlimited'))}</div>`;
      card.addEventListener('click', (e) => {
        const util = e.target.closest('[data-util]');
        if (util && mine) { onUtility?.(util.dataset.util); return; }
        if (!taken && !mine) onPick(op.id);
      });
      cards.appendChild(card);
    }
  }

  // ---------------------------------------------------------------- gun hover cards
  // Any element with data-gun="<weapon id>" shows that gun's stats while hovered.
  // Works on every menu, so later screens only need to add the attribute.

  bindGunTips() {
    this.gunTip = $('gun-tip');
    document.addEventListener('mousemove', (e) => {
      const target = e.target instanceof Element ? e.target.closest('[data-gun]') : null;
      if (!target) return this.hideGunTip();
      this.showGunTip(target.dataset.gun, e.clientX, e.clientY);
    });
    document.addEventListener('mouseleave', () => this.hideGunTip());
    window.addEventListener('blur', () => this.hideGunTip());
  }

  showGunTip(id, x, y) {
    const w = WEAPONS[id];
    const tip = this.gunTip;
    if (!w || !tip) return;
    if (this.tipGun !== id) {
      this.tipGun = id;
      const rows = weaponStats(w).map((s) => `
        <div class="tip-row"><span>${s.label}</span><div class="tip-bar"><i style="width:${Math.round(s.frac * 100)}%"></i></div><b>${s.text}</b></div>`).join('');
      tip.innerHTML = `
        <div class="tip-head"><b>${escapeHtml(w.name)}</b><span>${escapeHtml(w.kind)}${w.auto ? ' · auto' : ' · semi-auto'}</span></div>
        <div class="tip-desc">${escapeHtml(w.desc)}</div>${rows}`;
    }
    tip.classList.remove('hidden');
    const pad = 16, r = tip.getBoundingClientRect();
    const left = x + pad + r.width > window.innerWidth ? x - pad - r.width : x + pad;
    const top = Math.min(window.innerHeight - r.height - 8, y + pad);
    tip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  }

  hideGunTip() {
    this.tipGun = null;
    this.gunTip?.classList.add('hidden');
  }

  setPrompt(text) {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    $('prompt').textContent = text;
    $('prompt').classList.toggle('hidden', !text);
  }

  /** frac in 0..1, or null to hide */
  setProgress(frac, label) {
    $('progress').classList.toggle('hidden', frac === null);
    if (frac === null) return;
    $('progress-label').textContent = label;
    $('progress-bar').style.width = `${Math.round(frac * 100)}%`;
  }

  toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  // ---------------------------------------------------------------- rounds

  updateRound({ attack, defense, time, label, urgent, myTeam }) {
    const sig = `${attack}|${defense}|${time}|${label}|${urgent}|${myTeam}`;
    if (sig === this.lastRound) return;
    this.lastRound = sig;
    $('score-attack').textContent = attack;
    $('score-defense').textContent = defense;
    $('round-time').textContent = time;
    $('round-time').classList.toggle('urgent', urgent);
    $('round-label').textContent = label;
    $('score-attack-box').classList.toggle('mine', myTeam === 'attack');
    $('score-defense-box').classList.toggle('mine', myTeam === 'defense');
  }

  updateSpawnPicker(show, choice) {
    const box = $('spawn-box');
    box.classList.toggle('hidden', !show);
    if (!show) return;
    const sig = String(choice);
    if (sig === this.lastSpawn) return;
    this.lastSpawn = sig;
    const opts = $('spawn-opts');
    opts.innerHTML = '';
    MAP.spawns.attack.forEach((sp, i) => {
      const el = document.createElement('span');
      el.className = 'spawn-opt' + (i + 1 === choice ? ' selected' : '');
      el.innerHTML = `<span class="keycap">${i + 1}</span> ${sp.name}`;
      opts.appendChild(el);
    });
  }

  setDroneHud(on, info, title = '● DRONE CAM', jammed = false) {
    $('drone-overlay').classList.toggle('jammed', on && jammed);
    $('drone-hud').querySelector('.drone-title').textContent = jammed ? '● SIGNAL JAMMED' : title;
    if (on !== this.droneOn) {
      this.droneOn = on;
      $('drone-overlay').classList.toggle('hidden', !on);
      $('drone-hud').classList.toggle('hidden', !on);
      this.hud.classList.toggle('in-drone', on);
    }
    if (on && info !== this.droneInfo) { this.droneInfo = info; $('drone-info').textContent = info; }
  }

  setCapture(frac, contested) {
    const el = $('capture');
    el.classList.toggle('hidden', frac === null);
    if (frac === null) return;
    el.classList.toggle('contested', contested);
    $('capture-label').textContent = contested ? 'Objective contested' : 'Securing objective';
    $('capture-bar').style.width = `${Math.round(frac * 100)}%`;
  }

  /** kind: 'attack' | 'defense' (round) or 'win' | 'lose' (match). */
  showRoundEnd({ title, reason, score, note, kind }) {
    const el = $('round-end');
    el.className = kind;
    $('round-end-title').textContent = title;
    $('round-end-reason').textContent = reason;
    $('round-end-score').textContent = score;
    $('round-end-note').textContent = note;
  }

  hideRoundEnd() {
    $('round-end').className = 'hidden';
  }

  showDeath(title, sub) {
    $('death-overlay').classList.remove('hidden');
    $('death-title').textContent = title;
    $('death-sub').textContent = sub;
  }

  setDeathSub(sub) {
    $('death-sub').textContent = sub;
  }

  hideDeath() {
    $('death-overlay').classList.add('hidden');
  }

  clearKillfeed() {
    $('killfeed').innerHTML = '';
  }

  setPointerLocked(locked) {
    $('click-to-play').classList.toggle('hidden', locked);
  }

  updateStats(dt, ping, local) {
    this.fpsAvg += (1 / Math.max(dt, 1e-3) - this.fpsAvg) * 0.05;
    this.statsTimer += dt;
    if (this.statsTimer < 0.5) return;
    this.statsTimer = 0;
    $('net-stats').textContent = `${Math.round(this.fpsAvg)} fps · ${ping} ms · ${local?.pending.length ?? 0} unacked`;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
