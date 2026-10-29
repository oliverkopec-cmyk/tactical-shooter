// The Friends tab, the party panel and the party invite pop-up.
// Friends and requests come from the server over HTTP; presence, invites and the party
// arrive as live events, so the list updates by itself.

import { getFriends, searchPlayers, sendFriendRequest, answerFriendRequest, removeFriend } from './account.js';
import { rankIcon } from './rankIcon.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STATUS = {
  menu: { label: 'Online · in the menu', cls: 'online' },
  lobby: { label: 'In a lobby', cls: 'lobby' },
  match: { label: 'In a match', cls: 'match' },
  offline: { label: 'Offline', cls: 'offline' },
};

export class Social {
  /** onCreateRoom: called when the party leader presses "Create room for the party". */
  constructor({ network, getAccount, onCreateRoom }) {
    this.network = network;
    this.getAccount = getAccount;
    this.onCreateRoom = onCreateRoom;
    this.data = { friends: [], incoming: [], outgoing: [] };
    this.results = null;      // search results (null = no search yet)
    this.query = '';
    this.message = '';
    this.party = null;
    this.visible = false;
    this.refreshTimer = null;
    this.inviteTimer = null;

    network.on('friendsChanged', ({ note } = {}) => { if (note) this.toast(note); this.scheduleRefresh(); });
    network.on('party', (state) => { this.party = state; this.renderParty(); this.updatePlayTab(); });
    network.on('partyInvite', (inv) => this.onInvite(inv));
    network.on('notice', ({ message }) => { if (!$('screen-home').classList.contains('hidden')) this.toast(message); });

    $('friends-main').addEventListener('click', (e) => this.onMainClick(e));
    $('friends-main').addEventListener('submit', (e) => { e.preventDefault(); this.search(); });
    $('party-panel').addEventListener('click', (e) => this.onPartyClick(e));
    $('invite-accept').addEventListener('click', () => this.answerInvite(true));
    $('invite-decline').addEventListener('click', () => this.answerInvite(false));
  }

  /** The Friends tab is showing (or not). */
  setVisible(on) {
    this.visible = on;
    if (on) this.refresh();
  }

  /** Logged out or switched account: forget everything. */
  reset() {
    this.data = { friends: [], incoming: [], outgoing: [] };
    this.results = null; this.query = ''; this.message = ''; this.party = null;
    this.hideInvite();
    this.updateBadge();
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), 250);
  }

  async refresh() {
    if (!this.getAccount()) return;
    const res = await getFriends();
    if (res.error) return;
    this.data = res;
    this.updateBadge();
    if (this.visible) this.render();
  }

  updateBadge() {
    const n = this.data.incoming.length;
    const tab = document.querySelector('[data-tab=friends]');
    if (tab) tab.dataset.badge = n ? String(n) : '';
  }

  toast(message) {
    const el = $('social-toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
  }

  // ---------------------------------------------------------------- friends list

  render() {
    this.renderMain();
    this.renderParty();
  }

  renderMain() {
    const { friends, incoming, outgoing } = this.data;
    const me = this.party?.members.some((m) => m.id === this.getAccount()?.id);
    const inParty = (id) => this.party?.members.some((m) => m.id === id);
    const canInvite = (f) => f.status !== 'offline' && !inParty(f.id) && (!this.party || this.party.members.length < 5);
    const results = this.results === null ? '' : `
      <div class="detail-sub">Search results</div>
      ${this.results.length ? this.results.map((r) => `
        <div class="friend-row"><span class="friend-name">${esc(r.username)}</span>
          ${r.relation === 'none' ? `<button type="button" data-add="${esc(r.username)}">Add friend</button>`
            : `<span class="muted">${{ friend: 'Already friends', outgoing: 'Request sent', incoming: 'Wants to be your friend' }[r.relation]}</span>`}</div>`).join('') : '<div class="muted">No players found.</div>'}`;
    const requests = incoming.length || outgoing.length ? `
      <div class="detail-sub">Friend requests</div>
      ${incoming.map((r) => `<div class="friend-row"><span class="friend-name">${esc(r.username)}</span><span><button type="button" class="primary" data-accept="${r.id}">Accept</button> <button type="button" data-decline="${r.id}">Decline</button></span></div>`).join('')}
      ${outgoing.map((r) => `<div class="friend-row"><span class="friend-name">${esc(r.username)} <span class="muted">· waiting</span></span><button type="button" class="ghost" data-remove="${r.id}">Cancel</button></div>`).join('')}` : '';
    const list = friends.length ? friends.map((f) => {
      const st = STATUS[f.status];
      return `<div class="friend-row"><span class="friend-who"><span class="dot ${st.cls}"></span>${rankIcon(f.rankPoints, 22)}<span><span class="friend-name">${esc(f.username)}</span><span class="muted friend-status">${st.label}</span></span></span>
        <span>${canInvite(f) ? `<button type="button" data-invite="${f.id}">Invite to party</button> ` : inParty(f.id) ? '<span class="muted">In your party </span>' : ''}<button type="button" class="ghost" data-remove="${f.id}" title="Remove friend">Remove</button></span></div>`;
    }).join('') : '<div class="muted">No friends yet. Search for a username above.</div>';
    $('friends-main').innerHTML = `
      <div class="shop-head"><h2>Friends</h2><span class="muted">${friends.filter((f) => f.status !== 'offline').length} online</span></div>
      <form class="friend-search"><input id="friend-q" placeholder="Search by username" maxlength="16" autocomplete="off" value="${esc(this.query)}" /><button type="submit">Search</button></form>
      <p class="${this.messageIsError ? 'error' : 'shop-ok'}">${esc(this.message)}</p>
      ${results}${requests}
      <div class="detail-sub">Your friends</div>
      <div class="friend-list">${list}</div>`;
    void me;
  }

  async search() {
    this.query = $('friend-q')?.value.trim() || '';
    this.message = '';
    if (this.query.length < 1) { this.results = null; this.message = 'Type a username (or the start of one).'; this.messageIsError = true; this.renderMain(); return; }
    const res = await searchPlayers(this.query);
    this.messageIsError = !!res.error;
    this.message = res.error || '';
    this.results = res.results || [];
    this.renderMain();
  }

  async onMainClick(e) {
    const t = (attr) => e.target.closest(`[${attr}]`);
    let res = null;
    if (t('data-add')) {
      res = await sendFriendRequest(t('data-add').dataset.add);
      this.message = res.error || (res.accepted ? `You and ${res.username} are now friends!` : `Friend request sent to ${res.username}.`);
    } else if (t('data-accept')) res = await answerFriendRequest(Number(t('data-accept').dataset.accept), true);
    else if (t('data-decline')) res = await answerFriendRequest(Number(t('data-decline').dataset.decline), false);
    else if (t('data-remove')) {
      if (!confirm('Remove this friend (or cancel the request)?')) return;
      res = await removeFriend(Number(t('data-remove').dataset.remove));
    } else if (t('data-invite')) {
      const out = await this.network.request('partyInvite', Number(t('data-invite').dataset.invite));
      this.message = out.error || 'Invite sent. They have a minute to answer.';
      this.messageIsError = !!out.error;
      this.renderMain();
      return;
    } else return;
    if (res?.error) { this.message = res.error; this.messageIsError = true; } else if (!this.message || t('data-accept') || t('data-decline') || t('data-remove')) { this.messageIsError = false; if (!t('data-add')) this.message = ''; }
    else this.messageIsError = false;
    if (this.results) this.search(); else this.renderMain();
    this.refresh();
  }

  // ---------------------------------------------------------------- party

  renderParty() {
    const me = this.getAccount()?.id;
    const p = this.party;
    if (!p) {
      $('party-panel').innerHTML = `<div class="shop-head"><h2>Party</h2></div><p class="muted small-note">Invite a friend to start a party. The party leader creates a room and everyone joins it, on the same team.</p>`;
      return;
    }
    const leader = p.leader === me;
    $('party-panel').innerHTML = `
      <div class="shop-head"><h2>Party</h2><span class="muted">${p.members.length} / 5</span></div>
      ${p.members.map((m) => `<div class="friend-row"><span class="friend-who"><span class="dot ${STATUS[m.status].cls}"></span><span class="friend-name">${esc(m.username)}${m.id === p.leader ? ' <span class="crown" title="Party leader">♛</span>' : ''}${m.id === me ? ' <span class="muted">(you)</span>' : ''}</span></span><span class="muted">${STATUS[m.status].label}</span></div>`).join('')}
      ${leader ? `<button type="button" class="primary" data-party-room ${p.members.length < 2 ? 'disabled' : ''}>Create room for the party</button>` : '<p class="muted small-note">Waiting for the party leader to create a room.</p>'}
      <button type="button" class="ghost" data-party-leave>Leave party</button>`;
  }

  onPartyClick(e) {
    if (e.target.closest('[data-party-leave]')) this.network.request('partyLeave');
    else if (e.target.closest('[data-party-room]')) this.onCreateRoom();
  }

  /** The Play tab's create button follows the party. */
  updatePlayTab() {
    const btn = $('create-btn'), note = $('party-note');
    const me = this.getAccount()?.id, p = this.party;
    if (!p) { btn.textContent = 'Create room'; btn.disabled = false; note.textContent = ''; return; }
    if (p.leader === me) { btn.textContent = `Create room for the party (${p.members.length})`; btn.disabled = false; note.textContent = 'Your party joins the room with you.'; }
    else { btn.textContent = 'Create room'; btn.disabled = true; note.textContent = 'You are in a party: the leader creates the room. You can still join a room with a code.'; }
  }

  // ---------------------------------------------------------------- invite pop-up

  onInvite(inv) {
    if (inv.expired) { if (this.invite?.partyId === inv.partyId) this.hideInvite(); return; }
    this.invite = inv;
    $('invite-text').textContent = `${inv.from} invited you to their party`;
    $('party-invite').classList.remove('hidden');
    clearTimeout(this.inviteTimer);
    this.inviteTimer = setTimeout(() => this.hideInvite(), inv.expiresInMs || 60000);
  }

  hideInvite() {
    clearTimeout(this.inviteTimer);
    this.invite = null;
    $('party-invite').classList.add('hidden');
  }

  async answerInvite(accept) {
    const inv = this.invite;
    if (!inv) return;
    this.hideInvite();
    const res = await this.network.request('partyRespond', { partyId: inv.partyId, accept });
    if (res.error) this.toast(res.error);
    else if (accept) this.toast('You joined the party. The leader will create the room.');
  }
}
