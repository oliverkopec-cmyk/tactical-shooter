// Chat, reports and punishments (Stage 2I).
//
// - In-match chat: all-chat and team-chat messages, length-limited and rate-limited, sent to the right
//   players and written to `chat_log` (kept 14 days) with the match they came from.
// - Reports: a player reports someone they were in a match with (reason + optional comment). The report keeps
//   the match id, so the owner can read that match's chat next to it.
// - Sanctions: warnings, suspensions (for a set time) and bans, in `sanctions`. A suspended or banned account
//   can't log in or stay connected. All of the owner's tools below check, on the server, that the caller is
//   the owner (from the username the server stored at login), so nobody else can use them, whatever the
//   client sends. Admins and testers have none of it.

import { isOwner } from './roles.js';

export const REPORT_REASONS = { cheating: 'Cheating', chat: 'Abusive chat', name: 'Offensive name', griefing: 'Griefing', other: 'Other' };
export const CHAT = { maxLength: 120, cooldownMs: 1200, burst: 5, burstMs: 10000, retentionDays: 14 };
const REPORT_LIMITS = { comment: 200, perWindow: 5, windowMs: 10 * 60 * 1000 };
const MAX_SUSPEND_MINUTES = 365 * 24 * 60;
const PAGE = 100;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** "2 days 3 hours", "45 minutes", "less than a minute": time left, for messages. */
export function describeSpan(ms) {
  const mins = Math.ceil(ms / 60000);
  if (mins < 1) return 'less than a minute';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const parts = [];
  if (d) parts.push(`${d} day${d === 1 ? '' : 's'}`);
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m && d === 0) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  return parts.slice(0, 2).join(' ');
}

export class Moderation {
  /** background: run the hourly chat-log clean-up here (the Node server; not in the Worker). */
  constructor({ db, accounts, io, background = true }) {
    this.db = db;
    this.accounts = accounts;
    this.io = io;
    this.lastChat = new Map();      // account id -> [times of recent messages]
    this.reportTimes = new Map();   // account id -> [times of recent reports]
    const sweep = () => this.db.query(`DELETE FROM chat_log WHERE created_at < now() - interval '${CHAT.retentionDays} days'`).catch((e) => console.error('Chat cleanup failed:', e.message));
    if (background) {
      sweep();
      setInterval(sweep, 60 * 60 * 1000).unref();
    }
  }

  owner(socket) { return isOwner(socket.data.account?.username); }

  // ---------------------------------------------------------------- chat

  /** A chat message from a player in a match: { scope: 'all' | 'team', text }. */
  chat(socket, { scope, text } = {}) {
    const room = socket.data.room, me = room?.members.get(socket.id);
    if (!room || !me || me.bot || room.phase !== 'match') return { error: 'You can only chat during a match.' };
    const msg = clean(text, CHAT.maxLength);
    if (!msg) return { error: '' };
    const id = socket.data.account.id, now = Date.now();
    const recent = (this.lastChat.get(id) || []).filter((t) => now - t < CHAT.burstMs);
    if (recent.length && now - recent.at(-1) < CHAT.cooldownMs) return { error: 'Slow down.' };
    if (recent.length >= CHAT.burst) return { error: 'You are sending messages too fast.' };
    recent.push(now);
    this.lastChat.set(id, recent);
    const scoped = scope === 'team' ? 'team' : 'all';
    const payload = { id: socket.id, name: me.name, owner: !!me.owner, tester: !!me.tester, team: me.team, scope: scoped, text: msg };
    if (scoped === 'team') {
      for (const m of room.members.values()) if (m.team === me.team && !m.bot) this.io.to(m.id).emit('chat', payload);
      this.io.to(room.spectatorChannel).emit('chat', payload);   // staff watching see everything
    } else this.io.to(room.channel).emit('chat', payload);
    this.db.query(
      'INSERT INTO chat_log (account_id, username, username_lower, room_code, match_id, team, scope, text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, me.name, me.name.toLowerCase(), room.code, room.matchId || null, me.team, scoped, msg],
    ).catch((e) => console.error('Chat log failed:', e.message));
    return { ok: true };
  }

  // ---------------------------------------------------------------- reports

  /** Report someone from your current or last match: { target (their socket id), reason, comment }. */
  async report(socket, { target, reason, comment } = {}) {
    const recent = socket.data.recent;
    const who = recent?.players.get(String(target));
    if (!who || !who.accountId) return { error: 'You can only report players from your last match.' };
    const me = socket.data.account;
    if (who.accountId === me.id) return { error: 'You can\'t report yourself.' };
    if (!REPORT_REASONS[reason]) return { error: 'Choose a reason.' };
    const now = Date.now();
    const times = (this.reportTimes.get(me.id) || []).filter((t) => now - t < REPORT_LIMITS.windowMs);
    if (times.length >= REPORT_LIMITS.perWindow) return { error: 'You have sent a lot of reports. Try again in a few minutes.' };
    const dupe = await this.db.query('SELECT 1 FROM reports WHERE reporter_id = $1 AND target_id = $2 AND match_id = $3', [me.id, who.accountId, recent.matchId]);
    if (dupe.rows.length) return { error: 'You already reported that player for this match.' };
    times.push(now);
    this.reportTimes.set(me.id, times);
    await this.db.query(
      'INSERT INTO reports (reporter_id, reporter_name, target_id, target_name, reason, comment, match_id, room_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [me.id, me.username, who.accountId, who.name, reason, clean(comment, REPORT_LIMITS.comment), recent.matchId, recent.roomCode],
    );
    return { ok: true };
  }

  // ---------------------------------------------------------------- sanctions: login checks

  /** The active ban or suspension on an account, or null: { kind, until (ms or null), reason }. */
  async blockOf(accountId) {
    const { rows } = await this.db.query(
      `SELECT kind, reason, until FROM sanctions
       WHERE account_id = $1 AND lifted_at IS NULL AND (kind = 'ban' OR (kind = 'suspend' AND until > now()))
       ORDER BY (kind = 'ban') DESC, until DESC NULLS FIRST LIMIT 1`,
      [accountId],
    );
    const r = rows[0];
    return r ? { kind: r.kind, reason: r.reason, until: r.until ? new Date(r.until).getTime() : null } : null;
  }

  /** What to tell a blocked player at the login screen. */
  blockMessage(b) {
    if (b.kind === 'ban') return `This account is banned.${b.reason ? ` Reason: ${b.reason}` : ''}`;
    return `This account is suspended for ${describeSpan(b.until - Date.now())} more.${b.reason ? ` Reason: ${b.reason}` : ''}`;
  }

  /** Warnings the player hasn't read yet (shown in the menu), oldest first. */
  async pendingWarnings(accountId) {
    const { rows } = await this.db.query("SELECT id, reason, created_at FROM sanctions WHERE account_id = $1 AND kind = 'warn' AND seen_at IS NULL ORDER BY id LIMIT 10", [accountId]);
    return rows.map((r) => ({ id: r.id, reason: r.reason, at: r.created_at }));
  }

  /** Send a player their unread warnings (only while they're in the menu, not in a room). */
  async deliverWarnings(socket) {
    if (socket.data.room || socket.data.spectating) return { warnings: [] };
    return { warnings: await this.pendingWarnings(socket.data.account.id) };
  }

  async markWarningsSeen(socket, ids) {
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite).slice(0, 20);
    if (list.length) await this.db.query("UPDATE sanctions SET seen_at = now() WHERE account_id = $1 AND kind = 'warn' AND id = ANY($2::bigint[])", [socket.data.account.id, list]);
    return { ok: true };
  }

  // ---------------------------------------------------------------- the owner's tools

  /** Reports, newest first. status: 'open' (default) | 'resolved' | 'all'. */
  async reports(socket, { status } = {}) {
    if (!this.owner(socket)) return { error: 'Not allowed.' };
    const where = status === 'resolved' ? "WHERE r.status = 'resolved'" : status === 'all' ? '' : "WHERE r.status = 'open'";
    const { rows } = await this.db.query(
      `SELECT r.*, (SELECT count(*) FROM reports x WHERE x.target_id = r.target_id) AS times_reported,
              (SELECT count(*) FROM sanctions s WHERE s.account_id = r.target_id) AS sanctions
       FROM reports r ${where} ORDER BY r.created_at DESC LIMIT ${PAGE}`,
    );
    return { reports: rows.map((r) => ({ ...r, reason_label: REPORT_REASONS[r.reason] || r.reason, times_reported: Number(r.times_reported), sanctions: Number(r.sanctions) })) };
  }

  /** One report with the chat of its match (oldest first), and the reported player's current standing. */
  async reportDetail(socket, { id } = {}) {
    if (!this.owner(socket)) return { error: 'Not allowed.' };
    const { rows } = await this.db.query('SELECT * FROM reports WHERE id = $1', [Number(id)]);
    const report = rows[0];
    if (!report) return { error: 'No such report.' };
    const chat = report.match_id ? (await this.db.query('SELECT username, team, scope, text, created_at FROM chat_log WHERE match_id = $1 ORDER BY id LIMIT 500', [report.match_id])).rows : [];
    const block = await this.blockOf(report.target_id);
    return { report, chat, block };
  }

  async resolve(socket, { id } = {}) {
    if (!this.owner(socket)) return { error: 'Not allowed.' };
    await this.db.query("UPDATE reports SET status = 'resolved', resolved_by = $2, resolved_at = now() WHERE id = $1 AND status = 'open'", [Number(id), socket.data.account.username]);
    return { ok: true };
  }

  /**
   * Warn, suspend or ban. { kind: 'warn' | 'suspend' | 'ban', reportId or accountId, minutes (suspend), reason }.
   * Acting on a report also resolves it.
   */
  async sanction(socket, { kind, reportId, accountId, minutes, reason } = {}) {
    if (!this.owner(socket)) return { error: 'Not allowed.' };
    if (!['warn', 'suspend', 'ban'].includes(kind)) return { error: 'Unknown action.' };
    let target = Number(accountId);
    if (reportId) {
      const r = await this.db.query('SELECT target_id FROM reports WHERE id = $1', [Number(reportId)]);
      if (!r.rows[0]) return { error: 'No such report.' };
      target = r.rows[0].target_id;
    }
    const acc = await this.db.query('SELECT id, username FROM accounts WHERE id = $1', [target]);
    const who = acc.rows[0];
    if (!who) return { error: 'No such player.' };
    if (isOwner(who.username)) return { error: 'You can\'t punish the owner account.' };
    let until = null;
    if (kind === 'suspend') {
      const m = Math.floor(Number(minutes));
      if (!(m >= 1) || m > MAX_SUSPEND_MINUTES) return { error: 'Choose how long (1 minute up to a year).' };
      until = new Date(Date.now() + m * 60000);
    }
    const why = clean(reason, 200);
    await this.db.query(
      'INSERT INTO sanctions (account_id, username, kind, reason, created_by, report_id, until) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [who.id, who.username, kind, why, socket.data.account.username, reportId ? Number(reportId) : null, until],
    );
    if (reportId) await this.db.query("UPDATE reports SET status = 'resolved', action = $2, resolved_by = $3, resolved_at = now() WHERE id = $1", [Number(reportId), kind, socket.data.account.username]);
    const sock = this.accounts.online.get(who.id);
    if (sock && kind !== 'warn') {
      sock.emit('sanctioned', { message: this.blockMessage({ kind, until: until?.getTime() ?? null, reason: why }) });
      setTimeout(() => sock.disconnect(true), 150);
    } else if (sock && kind === 'warn' && !sock.data.room && !sock.data.spectating) {
      sock.emit('warnings', { warnings: await this.pendingWarnings(who.id) });   // in the menu: now; in a match: at the next menu
    }
    return { ok: true, username: who.username };
  }

  /** End a suspension or ban early. */
  async lift(socket, { id } = {}) {
    if (!this.owner(socket)) return { error: 'Not allowed.' };
    await this.db.query('UPDATE sanctions SET lifted_at = now(), lifted_by = $2 WHERE id = $1 AND lifted_at IS NULL', [Number(id), socket.data.account.username]);
    return { ok: true };
  }

  /** Everyone currently suspended or banned. */
  async blocked(socket) {
    if (!this.owner(socket)) return { error: 'Not allowed.' };
    const { rows } = await this.db.query(
      `SELECT id, account_id, username, kind, reason, created_by, created_at, until FROM sanctions
       WHERE lifted_at IS NULL AND (kind = 'ban' OR (kind = 'suspend' AND until > now())) ORDER BY created_at DESC`,
    );
    return { blocked: rows };
  }

  /** The chat of every match, newest first, searchable by username: { q, before (message id) }. */
  async chatLog(socket, { q, before } = {}) {
    if (!this.owner(socket)) return { error: 'Not allowed.' };
    const params = [], where = [];
    const name = clean(q, 32).toLowerCase();
    if (name) { params.push(`%${name.replace(/[%_\\]/g, '\\$&')}%`); where.push(`username_lower LIKE $${params.length}`); }
    if (Number(before) > 0) { params.push(Number(before)); where.push(`id < $${params.length}`); }
    const { rows } = await this.db.query(
      `SELECT id, username, room_code, match_id, team, scope, text, created_at FROM chat_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${PAGE}`,
      params,
    );
    return { messages: rows, more: rows.length === PAGE };
  }
}

