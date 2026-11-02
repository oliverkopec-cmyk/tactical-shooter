// The Admin tab (only shown to admins; the server checks again on every request):
// announcements, gifts and Money, the gifts sent so far, everyone online, every running
// match, and joining a match to watch or play.

import { ownerTag } from './badge.js';
import { SKINS, RARITIES, skinList } from '../../shared/skins.js';
import { CHARMS, charmList } from '../../shared/charms.js';
import { WEAPONS } from '../../shared/weapons.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = { menu: 'In the menu', lobby: 'In a lobby', match: 'In a match' };
const AUDIENCE = { player: 'One player', online: 'Everyone online', everyone: 'Whole server' };

/** "Who gets it": one player (with a username box), everyone online, or every account. */
function recipients(prefix) {
  return `<div class="adm-who" data-who="${prefix}">
    ${Object.entries(AUDIENCE).map(([v, label], i) => `<label class="adm-radio"><input type="radio" name="${prefix}-who" value="${v}"${i === 0 ? ' checked' : ''}> ${label}</label>`).join('')}
    <input type="text" class="adm-user" id="${prefix}-user" list="adm-players" placeholder="Username" maxlength="16" autocomplete="off" />
  </div>`;
}

/** Short text for what a gift holds. */
function describe(c = {}) {
  const parts = [];
  if (c.money) parts.push(`${Number(c.money).toLocaleString()} Money`);
  if (c.skin && SKINS[c.skin]) parts.push(`${SKINS[c.skin].name}${SKINS[c.skin].rarity === 'exclusive' ? ' (Exclusive)' : ''} skin`);
  if (c.charm && CHARMS[c.charm]) parts.push(`${CHARMS[c.charm].name} charm`);
  if (c.crate) parts.push(c.crate === 'charm' ? 'charm crate' : `${WEAPONS[c.crate]?.name || c.crate} crate`);
  return parts.join(' + ');
}

export class AdminPanel {
  constructor({ network, onPreviewSkin }) {
    this.network = network;
    this.onPreviewSkin = onPreviewSkin;
    this.online = [];
    this.matches = [];
    this.history = [];
    this.message = '';
    this.timer = null;
    this.visible = false;
    this.sendTab = 'announce';
    $('admin-matches').addEventListener('click', (e) => this.onClick(e));
    this.buildSend();
  }

  // ---------------------------------------------------------------- announcements, gifts, Money

  buildSend() {
    const byRarity = (r) => skinList().filter((s) => s.rarity === r.id).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    const skinOptions = ['exclusive', 'legendary', 'epic', 'rare', 'common'].map((r) => `<optgroup label="${RARITIES[r].name}">${byRarity(RARITIES[r])}</optgroup>`).join('');
    const charmOptions = charmList().map((c) => `<option value="${c.id}">${esc(c.name)} (${RARITIES[c.rarity].name})</option>`).join('');
    const crateOptions = `<option value="charm">Charm crate</option>${Object.values(WEAPONS).map((w) => `<option value="${w.id}">${esc(w.name)} crate</option>`).join('')}`;
    $('admin-send').innerHTML = `
      <h2>Send to players</h2>
      <div class="adm-tabs">
        <button type="button" data-send-tab="announce" class="active">Announcement</button>
        <button type="button" data-send-tab="gift">Gift</button>
        <button type="button" data-send-tab="money">Send Money</button>
      </div>
      <datalist id="adm-players"></datalist>
      <div class="adm-pane" data-pane="announce">
        <textarea id="ann-msg" maxlength="200" rows="2" placeholder="Message for everyone online (shown as a banner at the top of the screen)"></textarea>
        <div class="adm-row"><label>Show for <select id="ann-secs"><option value="5">5 seconds</option><option value="10" selected>10 seconds</option><option value="30">30 seconds</option></select></label>
          <button type="button" class="primary" id="ann-send">Announce</button></div>
        <p class="muted small-note">Only players online right now see it.</p>
        <p class="adm-status" id="ann-status"></p>
      </div>
      <div class="adm-pane hidden" data-pane="gift">
        <input type="text" id="gift-title-in" maxlength="60" placeholder="Title (e.g. Thanks for playing!)" />
        <textarea id="gift-msg-in" maxlength="300" rows="2" placeholder="Message (optional)"></textarea>
        <div class="adm-grid">
          <label>Money <input type="number" id="gift-money" min="0" max="10000000" step="100" placeholder="0" /></label>
          <label>Skin <span class="adm-inline"><select id="gift-skin"><option value="">None</option>${skinOptions}</select><button type="button" id="gift-preview" class="small" title="Show it on your operator's gun">👁</button></span></label>
          <label>Charm <select id="gift-charm"><option value="">None</option>${charmOptions}</select></label>
          <label>Crate <select id="gift-crate"><option value="">None</option>${crateOptions}</select></label>
        </div>
        <p class="muted small-note">Skins in gifts are owned on every gun. A crate is opened when the gift is.</p>
        ${recipients('gift')}
        <button type="button" class="primary" id="gift-send">Send gift</button>
        <p class="adm-status" id="gift-status"></p>
      </div>
      <div class="adm-pane hidden" data-pane="money">
        <div class="adm-grid"><label>Amount <input type="number" id="money-amount" min="1" max="10000000" step="100" placeholder="1000" /></label></div>
        <textarea id="money-msg" maxlength="300" rows="2" placeholder="Message (optional)"></textarea>
        ${recipients('money')}
        <button type="button" class="primary" id="money-send">Send Money</button>
        <p class="adm-status" id="money-status"></p>
      </div>`;
    const box = $('admin-send');
    box.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-send-tab]');
      if (!tab) return;
      this.sendTab = tab.dataset.sendTab;
      for (const b of box.querySelectorAll('[data-send-tab]')) b.classList.toggle('active', b === tab);
      for (const p of box.querySelectorAll('[data-pane]')) p.classList.toggle('hidden', p.dataset.pane !== this.sendTab);
    });
    box.addEventListener('change', (e) => {
      if (e.target.name?.endsWith('-who')) this.updateWho(e.target.closest('.adm-who'));
      if (e.target.id === 'gift-skin' && e.target.value) this.onPreviewSkin?.(e.target.value);
    });
    for (const w of box.querySelectorAll('.adm-who')) this.updateWho(w);
    box.addEventListener('input', (e) => { if (e.target.classList.contains('adm-user')) this.suggest(e.target.value); });
    $('gift-preview').addEventListener('click', () => this.onPreviewSkin?.($('gift-skin').value));
    $('ann-send').addEventListener('click', () => this.announce());
    $('gift-send').addEventListener('click', () => this.sendGift('gift'));
    $('money-send').addEventListener('click', () => this.sendGift('money'));
  }

  updateWho(el) {
    const one = el.querySelector('input[type=radio]:checked')?.value === 'player';
    el.querySelector('.adm-user').classList.toggle('hidden', !one);
  }

  async suggest(q) {
    clearTimeout(this.suggestTimer);
    this.suggestTimer = setTimeout(async () => {
      const res = await this.network.request('adminFindPlayer', q);
      $('adm-players').innerHTML = (res.players || []).map((n) => `<option value="${esc(n)}"></option>`).join('');
    }, 200);
  }

  status(id, text, ok) {
    const el = $(id);
    el.textContent = text;
    el.className = `adm-status ${ok ? 'ok' : 'error'}`;
  }

  async announce() {
    const text = $('ann-msg').value.trim();
    if (!text) return this.status('ann-status', 'Type a message first.', false);
    const res = await this.network.request('adminAnnounce', { text, seconds: Number($('ann-secs').value) });
    if (res.error) return this.status('ann-status', res.error, false);
    this.status('ann-status', `Sent to ${res.sent} player${res.sent === 1 ? '' : 's'} online.`, true);
    $('ann-msg').value = '';
  }

  /** kind 'gift' (the full form) or 'money' (just an amount and a message). */
  async sendGift(kind) {
    const who = document.querySelector(`input[name="${kind}-who"]:checked`).value;
    const username = $(`${kind}-user`).value.trim();
    if (who === 'player' && !username) return this.status(`${kind}-status`, 'Type the player\'s username.', false);
    const contents = kind === 'money'
      ? { money: Number($('money-amount').value) || 0 }
      : { money: Number($('gift-money').value) || 0, skin: $('gift-skin').value || null, charm: $('gift-charm').value || null, crate: $('gift-crate').value || null };
    if (kind === 'money' && !(contents.money > 0)) return this.status('money-status', 'Enter an amount.', false);
    const what = describe(contents) || 'nothing';
    const target = who === 'player' ? username : who === 'online' ? `everyone online (${this.online.length})` : 'every account on the server';
    if (who !== 'player' && !window.confirm(`Send ${what} to ${target}?`)) return;
    const req = kind === 'money'
      ? { title: 'Money', message: $('money-msg').value, contents, audience: who, username }
      : { title: $('gift-title-in').value, message: $('gift-msg-in').value, contents, audience: who, username };
    const res = await this.network.request('adminGift', req);
    if (res.error) return this.status(`${kind}-status`, res.error, false);
    this.status(`${kind}-status`, `Sent ${what} to ${res.recipients} player${res.recipients === 1 ? '' : 's'}.`, true);
    this.loadHistory();
  }

  async loadHistory() {
    const res = await this.network.request('adminGifts');
    if (!res.error) this.history = res.gifts;
    if (this.visible) this.renderHistory();
  }

  renderHistory() {
    $('admin-history').innerHTML = `
      <h2>Gifts sent</h2>
      ${this.history.length ? this.history.map((g) => `
        <div class="adm-gift">
          <div class="adm-gift-head"><b>${esc(g.title)}</b><span class="muted">${new Date(g.created_at).toLocaleString()}</span></div>
          <div>${esc(describe(g.contents))}</div>
          ${g.message ? `<div class="muted small-note">“${esc(g.message)}”</div>` : ''}
          <div class="muted small-note">${g.audience === 'player' ? `To ${esc(g.player || '?')}` : AUDIENCE[g.audience]} · by ${esc(g.created_by)} · <b>${g.claimed}</b> of ${g.recipients} opened</div>
        </div>`).join('') : '<div class="muted">No gifts sent yet.</div>'}`;
  }

  /** Tab shown or hidden: poll while it is open. */
  setVisible(on) {
    this.visible = on;
    clearInterval(this.timer);
    if (!on) return;
    this.refresh();
    this.loadHistory();
    let ticks = 0;
    this.timer = setInterval(() => { this.refresh(); if (++ticks % 5 === 0) this.loadHistory(); }, 3000);   // claim counts every 15 s
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
