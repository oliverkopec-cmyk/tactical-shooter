// The Admin tab (only shown to admins; the server checks again on every request):
// everyone online, every running match, and joining a match to watch or play.

import { ownerTag } from './badge.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = { menu: 'In the menu', lobby: 'In a lobby', match: 'In a match' };

export class AdminPanel {
  constructor({ network }) {
    this.network = network;
    this.online = [];
    this.matches = [];
    this.message = '';
    this.timer = null;
    this.visible = false;
    $('admin-matches').addEventListener('click', (e) => this.onClick(e));
  }

  /** Tab shown or hidden: poll while it is open. */
  setVisible(on) {
    this.visible = on;
    clearInterval(this.timer);
    if (!on) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), 3000);
  }

  async refresh() {
    const [online, matches] = await Promise.all([this.network.request('adminOnline'), this.network.request('adminMatches')]);
    if (online.error || matches.error) { this.message = online.error || matches.error; }
    else { this.online = online.players; this.matches = matches.matches; }
    if (this.visible) this.render();
  }

  async onClick(e) {
    const btn = e.target.closest('[data-join]');
    if (!btn) return;
    this.message = '';
    const res = await this.network.request('adminJoin', { code: btn.dataset.code, mode: btn.dataset.join });
    if (res.error) { this.message = res.error; this.render(); }
  }

  render() {
    const names = (list) => list.length ? list.map((p) => `${esc(p.name)}${p.owner ? ownerTag : ''}`).join(', ') : '<span class="muted">nobody</span>';
    $('admin-matches').innerHTML = `
      <h2>Matches</h2>
      ${this.message ? `<div class="error">${esc(this.message)}</div>` : ''}
      ${this.matches.length ? this.matches.map((m) => `
        <div class="admin-match">
          <div class="admin-match-head"><b>${esc(m.code)}</b> · ${esc(m.map)} · ${m.phase === 'match' ? `Round ${m.round} · ${m.scores.attack}–${m.scores.defense}` : 'Lobby'}${m.spectators ? ` · ${m.spectators} watching` : ''}</div>
          <div class="admin-team attack"><span>Attack</span> ${names(m.attack)}</div>
          <div class="admin-team defense"><span>Defense</span> ${names(m.defense)}</div>
          <div class="admin-actions">
            <button type="button" data-join="spectate" data-code="${esc(m.code)}"${m.phase === 'match' ? '' : ' disabled'}>Spectate (invisible)</button>
            <button type="button" data-join="attack" data-code="${esc(m.code)}"${m.attack.length >= 5 ? ' disabled' : ''}>Join attack</button>
            <button type="button" data-join="defense" data-code="${esc(m.code)}"${m.defense.length >= 5 ? ' disabled' : ''}>Join defense</button>
          </div>
        </div>`).join('') : '<div class="muted">No matches or lobbies right now.</div>'}`;
    $('admin-online').innerHTML = `
      <h2>Online (${this.online.length})</h2>
      ${this.online.map((p) => `
        <div class="friend-row"><span class="friend-who"><span><span class="friend-name">${esc(p.username)}${p.owner ? ownerTag : ''}</span>
          <span class="muted friend-status">${esc(p.rank)} · level ${p.level} · ${STATUS[p.status] || p.status}${p.room ? ` (${esc(p.room)})` : ''}</span></span></span></div>`).join('')}`;
  }
}
