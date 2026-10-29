// Friends, who is online, and parties.
//
// Friend requests and friendships live in the database (table `friendships`). Presence is
// worked out from the live connections, and parties are kept in memory only (a party lasts
// until its members leave or disconnect), so nothing here grows with time.

export const MAX_FRIENDS = 100;
export const MAX_PENDING = 20;       // outgoing friend requests waiting for an answer
export const PARTY_MAX = 5;          // a team has five players
export const INVITE_MS = 60 * 1000;  // how long a party invite stays open

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class Social {
  constructor(accounts) {
    this.accounts = accounts;
    this.db = accounts.db;
    this.parties = new Map();     // partyId -> { id, leader, members: [accountId] }
    this.partyOf = new Map();     // accountId -> party
    this.invites = new Map();     // invitee accountId -> { partyId, from, timer }
    this.nextPartyId = 1;
  }

  // ---------------------------------------------------------------- presence

  socketOf(id) { return this.accounts.online.get(id) || null; }

  /** 'offline' | 'menu' | 'lobby' | 'match' */
  statusOf(id) {
    const socket = this.socketOf(id);
    if (!socket) return 'offline';
    const room = socket.data.room;
    if (!room) return 'menu';
    return room.phase === 'match' ? 'match' : 'lobby';
  }

  emitTo(ids, event, payload) {
    for (const id of ids) this.socketOf(id)?.emit(event, payload);
  }

  /** Tell an account's friends to refresh their list (it went online or offline, or changed what it's doing). */
  async presenceChanged(id) {
    const party = this.partyOf.get(id);
    if (party) this.sendParty(party);          // party members see each other's status too
    try { this.emitTo(await this.friendIds(id), 'friendsChanged', {}); } catch (err) { console.error('Presence update failed:', err.message); }
  }

  // ---------------------------------------------------------------- friends

  async friendIds(id) {
    const { rows } = await this.db.query(
      `SELECT CASE WHEN requester = $1 THEN addressee ELSE requester END AS other FROM friendships WHERE status = 'accepted' AND (requester = $1 OR addressee = $1)`, [id]);
    return rows.map((r) => r.other);
  }

  async areFriends(a, b) {
    const { rows } = await this.db.query(
      `SELECT 1 FROM friendships WHERE status = 'accepted' AND LEAST(requester, addressee) = LEAST($1::bigint, $2::bigint) AND GREATEST(requester, addressee) = GREATEST($1::bigint, $2::bigint)`, [a, b]);
    return rows.length > 0;
  }

  /** Your friends (with what they're doing) and the requests waiting on you and on them. */
  async list(id) {
    const { rows } = await this.db.query(
      `SELECT f.status, f.requester, a.id AS other, a.username, a.rank_points, a.level
       FROM friendships f JOIN accounts a ON a.id = CASE WHEN f.requester = $1 THEN f.addressee ELSE f.requester END
       WHERE f.requester = $1 OR f.addressee = $1 ORDER BY a.username_lower`, [id]);
    const out = { friends: [], incoming: [], outgoing: [] };
    for (const r of rows) {
      const who = { id: r.other, username: r.username };
      if (r.status === 'accepted') out.friends.push({ ...who, rankPoints: r.rank_points, level: r.level, status: this.statusOf(r.other) });
      else if (r.requester === id) out.outgoing.push(who);
      else out.incoming.push(who);
    }
    const order = { menu: 0, lobby: 1, match: 1, offline: 2 };
    out.friends.sort((a, b) => order[a.status] - order[b.status] || a.username.localeCompare(b.username));
    return out;
  }

  /** Players whose username starts with q, and how each relates to you. */
  async search(id, q) {
    const text = String(q || '').trim().toLowerCase();
    if (text.length < 2) return [];
    const { rows } = await this.db.query(
      `SELECT id, username FROM accounts WHERE username_lower LIKE $1 ESCAPE '\\' AND id <> $2 ORDER BY username_lower LIMIT 8`, [`${escapeLike(text)}%`, id]);
    if (!rows.length) return [];
    const rel = await this.db.query(
      `SELECT status, requester, addressee FROM friendships WHERE (requester = $1 AND addressee = ANY($2::bigint[])) OR (addressee = $1 AND requester = ANY($2::bigint[]))`, [id, rows.map((r) => r.id)]);
    const relation = new Map();
    for (const f of rel.rows) {
      const other = f.requester === id ? f.addressee : f.requester;
      relation.set(other, f.status === 'accepted' ? 'friend' : f.requester === id ? 'outgoing' : 'incoming');
    }
    return rows.map((r) => ({ id: r.id, username: r.username, relation: relation.get(r.id) || 'none' }));
  }

  async request(id, username) {
    const name = String(username || '').trim().toLowerCase();
    if (!name) return { status: 400, error: 'Enter a username.' };
    const target = (await this.db.query('SELECT id, username FROM accounts WHERE username_lower = $1', [name])).rows[0];
    if (!target) return { status: 404, error: 'No player with that username.' };
    if (target.id === id) return { status: 400, error: 'You can\'t add yourself.' };
    const existing = (await this.db.query(
      `SELECT * FROM friendships WHERE LEAST(requester, addressee) = LEAST($1::bigint, $2::bigint) AND GREATEST(requester, addressee) = GREATEST($1::bigint, $2::bigint)`, [id, target.id])).rows[0];
    if (existing?.status === 'accepted') return { status: 409, error: `You are already friends with ${target.username}.` };
    if (existing && existing.requester === id) return { status: 409, error: `You already sent ${target.username} a request.` };
    if (existing) {
      // They already asked you: adding them back is saying yes
      await this.db.query(`UPDATE friendships SET status = 'accepted' WHERE id = $1`, [existing.id]);
      this.emitTo([target.id], 'friendsChanged', { note: `${this.nameOf(id)} accepted your friend request` });
      return { status: 200, ok: true, accepted: true, username: target.username };
    }
    const pending = (await this.db.query(`SELECT count(*)::int AS n FROM friendships WHERE requester = $1 AND status = 'pending'`, [id])).rows[0].n;
    if (pending >= MAX_PENDING) return { status: 429, error: 'You have too many requests waiting. Wait for answers or cancel some.' };
    if ((await this.friendIds(id)).length >= MAX_FRIENDS) return { status: 409, error: `You can have at most ${MAX_FRIENDS} friends.` };
    await this.db.query(`INSERT INTO friendships (requester, addressee) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, target.id]);
    this.emitTo([target.id], 'friendsChanged', { note: `${this.nameOf(id)} sent you a friend request` });
    return { status: 200, ok: true, username: target.username };
  }

  /** Accept or decline a request someone sent you. */
  async respond(id, otherId, accept) {
    const f = (await this.db.query(`SELECT * FROM friendships WHERE requester = $1 AND addressee = $2 AND status = 'pending'`, [otherId, id])).rows[0];
    if (!f) return { status: 404, error: 'That request is no longer there.' };
    if (accept) {
      if ((await this.friendIds(id)).length >= MAX_FRIENDS) return { status: 409, error: `You can have at most ${MAX_FRIENDS} friends.` };
      await this.db.query(`UPDATE friendships SET status = 'accepted' WHERE id = $1`, [f.id]);
      this.emitTo([otherId], 'friendsChanged', { note: `${this.nameOf(id)} accepted your friend request` });
    } else {
      await this.db.query('DELETE FROM friendships WHERE id = $1', [f.id]);
      this.emitTo([otherId], 'friendsChanged', {});
    }
    return { status: 200, ok: true };
  }

  /** Remove a friend, or cancel a request you sent. */
  async remove(id, otherId) {
    const { rows } = await this.db.query(
      `DELETE FROM friendships WHERE LEAST(requester, addressee) = LEAST($1::bigint, $2::bigint) AND GREATEST(requester, addressee) = GREATEST($1::bigint, $2::bigint) RETURNING id`, [id, otherId]);
    if (!rows.length) return { status: 404, error: 'You are not friends.' };
    this.emitTo([otherId], 'friendsChanged', {});
    // Friends only: they can't keep a party invite going once you're not friends
    const party = this.partyOf.get(id);
    if (party && this.partyOf.get(otherId) === party && party.leader === id) this.removeFromParty(otherId, 'removed');
    return { status: 200, ok: true };
  }

  nameOf(id) { return this.socketOf(id)?.data.account.username || 'Someone'; }

  // ---------------------------------------------------------------- parties

  partyState(party) {
    if (!party) return null;
    return {
      id: party.id, leader: party.leader,
      members: party.members.map((m) => ({ id: m, username: this.nameOf(m), status: this.statusOf(m) })),
    };
  }

  sendParty(party, memberIds = party?.members || []) {
    const state = this.partyState(party);
    this.emitTo(memberIds, 'party', state);
  }

  notice(id, message) { this.socketOf(id)?.emit('notice', { message }); }

  /** Invite an online friend. Starts a party with you in it if you aren't in one. */
  async invite(fromId, toId) {
    if (fromId === toId) return { error: 'You can\'t invite yourself.' };
    if (!(await this.areFriends(fromId, toId))) return { error: 'You can only invite friends.' };
    if (this.statusOf(toId) === 'offline') return { error: 'That player is offline.' };
    let party = this.partyOf.get(fromId);
    if (this.partyOf.get(toId)) return { error: this.partyOf.get(toId) === party ? `${this.nameOf(toId)} is already in your party.` : `${this.nameOf(toId)} is already in a party.` };
    if (party && party.members.length >= PARTY_MAX) return { error: `A party can have at most ${PARTY_MAX} players.` };
    if (!party) {
      party = { id: this.nextPartyId++, leader: fromId, members: [fromId] };
      this.parties.set(party.id, party);
      this.partyOf.set(fromId, party);
      this.sendParty(party);
    }
    this.clearInvite(toId);
    const timer = setTimeout(() => this.expireInvite(toId, party.id), INVITE_MS);
    timer.unref?.();
    this.invites.set(toId, { partyId: party.id, from: fromId, timer });
    this.emitTo([toId], 'partyInvite', { partyId: party.id, from: this.nameOf(fromId), expiresInMs: INVITE_MS });
    return { ok: true };
  }

  clearInvite(toId) {
    const inv = this.invites.get(toId);
    if (inv) { clearTimeout(inv.timer); this.invites.delete(toId); }
  }

  expireInvite(toId, partyId) {
    const inv = this.invites.get(toId);
    if (!inv || inv.partyId !== partyId) return;
    this.invites.delete(toId);
    this.emitTo([toId], 'partyInvite', { partyId, expired: true });
    this.cleanupSoloParty(this.parties.get(partyId));
  }

  respondInvite(toId, partyId, accept) {
    const inv = this.invites.get(toId);
    if (!inv || inv.partyId !== partyId) return { error: 'That invite has expired.' };
    this.clearInvite(toId);
    const party = this.parties.get(partyId);
    if (!party) return { error: 'That party no longer exists.' };
    if (!accept) {
      this.notice(inv.from, `${this.nameOf(toId)} declined your party invite.`);
      this.cleanupSoloParty(party);
      return { ok: true };
    }
    if (this.partyOf.get(toId)) return { error: 'You are already in a party. Leave it first.' };
    if (party.members.length >= PARTY_MAX) return { error: 'That party is full.' };
    party.members.push(toId);
    this.partyOf.set(toId, party);
    this.sendParty(party);
    return { ok: true };
  }

  /** A party of one that nobody is being invited to is not worth keeping. */
  cleanupSoloParty(party) {
    if (!party || party.members.length > 1) return;
    for (const inv of this.invites.values()) if (inv.partyId === party.id) return;
    this.disband(party);
  }

  disband(party) {
    for (const m of party.members) this.partyOf.delete(m);
    this.parties.delete(party.id);
    for (const [to, inv] of [...this.invites]) if (inv.partyId === party.id) this.clearInvite(to);
    this.emitTo(party.members, 'party', null);
  }

  removeFromParty(id, reason = 'left') {
    const party = this.partyOf.get(id);
    if (!party) return;
    party.members = party.members.filter((m) => m !== id);
    this.partyOf.delete(id);
    this.emitTo([id], 'party', null);
    if (reason === 'removed') this.notice(id, 'You were removed from the party.');
    if (party.members.length === 0) { this.disband(party); return; }
    if (party.leader === id) party.leader = party.members[0];
    if (party.members.length === 1) this.cleanupSoloParty(party);
    if (this.parties.has(party.id)) this.sendParty(party);
  }

  leaveParty(id) { this.removeFromParty(id); }

  /** The account closed the game: its party, invites and presence go with it. */
  onDisconnect(id) {
    this.clearInvite(id);
    this.removeFromParty(id);
    for (const [to, inv] of [...this.invites]) if (inv.from === id) this.cleanupSoloParty(this.parties.get(inv.partyId));
    this.presenceChanged(id);
  }

  /** What a socket should be told when it connects. */
  onConnect(id) {
    this.presenceChanged(id);
  }
}
