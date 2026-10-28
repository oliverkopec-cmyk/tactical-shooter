// DOM screens: home (name + create/join), room lobby, and the in-game HUD.

import { MAX_PER_TEAM, MAX_HEALTH } from '../../shared/constants.js';
import { WEAPONS } from '../../shared/weapons.js';
import { MAP } from '../../shared/map.js';
import { operatorsFor, OPERATORS } from '../../shared/operators.js';
import { settings, setSetting } from './settings.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.screens = { home: $('screen-home'), lobby: $('screen-lobby') };
    this.hud = $('hud');
    this.fpsAvg = 60;
    this.statsTimer = 0;

    const saved = localStorageGet('breachline:name');
    if (saved) $('name-input').value = saved;
    this.bindSettings();
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
    $('settings').classList.add('hidden');
    this.settingsInGame = false;
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
  }

  get name() {
    const name = $('name-input').value.trim();
    localStorageSet('breachline:name', name);
    return name;
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

  updateCombat({ health, weapon, alive }) {
    if (health !== this.lastHealth) {
      this.lastHealth = health;
      $('health-value').textContent = Math.ceil(health);
      $('health-bar').style.width = `${(health / MAX_HEALTH) * 100}%`;
      $('health-box').classList.toggle('low', health <= 30);
    }
    if (weapon) {
      const w = WEAPONS[weapon.id];
      const key = `${weapon.id}|${weapon.ammo}|${weapon.reserve}|${weapon.reload > 0}`;
      if (key !== this.lastAmmoKey) {
        this.lastAmmoKey = key;
        $('weapon-name').textContent = `${w.name} · ${w.kind}`;
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
    w.className = 'weapon'; w.textContent = `${WEAPONS[weapon]?.kind || weapon}${head ? ' · head' : ''}`;
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

  /** White-out after a stun grenade. frac 1 = fully blind, 0 = clear. */
  setStun(frac) {
    const v = Math.round(frac * 100) / 100;
    if (v === this.lastStun) return;
    this.lastStun = v;
    $('stun-overlay').style.opacity = String(v);
  }

  // ---------------------------------------------------------------- operator select

  showOperatorSelect(on, { team, picks, names, myId, myOp, timeText, onPick } = {}) {
    const el = $('op-select');
    el.classList.toggle('hidden', !on);
    this.hud.classList.toggle('selecting', on);
    if (!on) { this.lastSelect = null; return; }
    $('op-timer').textContent = timeText;
    const sig = JSON.stringify([team, picks, myOp]);
    if (sig === this.lastSelect) return;
    this.lastSelect = sig;
    const cards = $('op-cards');
    cards.innerHTML = '';
    const pips = (n) => '●'.repeat(n) + '○'.repeat(3 - n);
    for (const op of operatorsFor(team)) {
      const holderId = Object.keys(picks || {}).find((id) => picks[id].op === op.id && picks[id].confirmed && id !== myId);
      const taken = op.unique && !!holderId;
      const card = document.createElement('button');
      card.className = `op-card${op.id === myOp ? ' selected' : ''}${taken ? ' taken' : ''}`;
      card.disabled = taken;
      const w = WEAPONS[op.weapon];
      card.innerHTML = `
        <div class="op-color" style="background:#${op.color.toString(16).padStart(6, '0')}"></div>
        <div class="op-name">${op.name}</div>
        <div class="op-weapon">${w.kind} · ${w.name}</div>
        <div class="op-stats"><span>SPEED ${pips(op.speed)}</span><span>ARMOR ${pips(op.armor)}</span></div>
        <div class="op-ab">${op.ability ? `<b>${op.ability.name}</b><br>${op.ability.desc}` : '<i>No special ability</i>'}</div>
        <div class="op-who">${taken ? `Taken by ${names[holderId] || 'a teammate'}` : (op.id === myOp ? 'Your pick' : (op.unique ? '' : 'Unlimited'))}</div>`;
      card.addEventListener('click', () => onPick(op.id));
      cards.appendChild(card);
    }
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

function localStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function localStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
