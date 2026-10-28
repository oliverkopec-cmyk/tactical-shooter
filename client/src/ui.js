// DOM screens: home (name + create/join), room lobby, and the in-game HUD.

import { MAX_PER_TEAM } from '../../shared/constants.js';

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
