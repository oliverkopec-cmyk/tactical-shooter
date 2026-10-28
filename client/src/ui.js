// DOM screens: home (name + create/join), room lobby, and the in-game HUD.

import { MAX_PER_TEAM, MAX_HEALTH } from '../../shared/constants.js';
import { WEAPONS } from '../../shared/weapons.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.screens = { home: $('screen-home'), lobby: $('screen-lobby') };
    this.hud = $('hud');
    this.fpsAvg = 60;
    this.statsTimer = 0;

    const saved = localStorageGet('breachline:name');
    if (saved) $('name-input').value = saved;
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

  updateGadgets({ label, key, value }, alive) {
    const sig = `${label}|${key}|${value}|${alive}`;
    if (sig === this.lastGadget) return;
    this.lastGadget = sig;
    $('gadget-box').classList.toggle('hidden', !alive);
    $('gadget-label').textContent = label;
    $('gadget-key').textContent = key;
    $('gadget-value').textContent = value;
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

  setDroneHud(on, info) {
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
