// Sending snapshots (the bandwidth work): each player gets their own copy, trimmed to what their client uses and
// with only what changed since the last one they were sent. GameState builds the full entries and decides what a
// team may know; this file turns them into the bytes on the wire. client/src/network.js puts them back together.
//
//   - Numbers are rounded: your own player keeps 4 decimals (it is replayed for prediction, and 0.0001 m is below the
//     collision code's tolerance, so rounding never puts you inside a wall). Everyone else is only drawn: 1 cm.
//   - Ammo, recoil, cooldowns and the input number are only sent to the player holding the gun. Others get which gun
//     it is and how far through a reload (for the animation). Health is only sent for your own team.
//   - Only fields that changed are sent, and nothing at all if nothing changed (a heartbeat goes once a second).
//     A field that disappears is sent as null. A full copy goes every 2 seconds anyway, so nothing can drift.
//   - A snapshot is only queued when the connection can take it (like Socket.IO's volatile), and the baseline is what
//     was actually queued, so a skipped one never leaves a client missing a change.

const KEYFRAME_MS = 2000;
const HEARTBEAT_MS = 1000;

// Fields only the player themself needs (input number, sprint/fire timers, speed numbers, Aegis's charge)
const OWN_ONLY = new Set(['seq', 'slow', 'sm', 'fd', 'jc', 'spr', 'ds']);
const r = (v, d) => { const k = 10 ** d; return Math.round(v * k) / k; };

/** A player entry as one viewer needs it. own: it is the viewer themself. */
export function trimEntry(e, own, mate) {
  const out = {};
  for (const k in e) {
    const v = e[k];
    if (v === undefined || (!own && OWN_ONLY.has(k))) continue;
    out[k] = v;
  }
  if (own) {
    if (!e.alive) return { id: e.id, alive: false, hp: 0, u: e.u };   // dead: the client needs nothing more about itself
    delete out.yaw; delete out.pitch;   // your own view direction is yours: the server's copy is never used
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'crouch', 'prone', 'lean']) out[k] = r(e[k], 4);
    if (e.ad !== undefined) out.ad = r(e.ad, 4);
    if (e.w) out.w = { ...e.w, cooldown: r(e.w.cooldown, 4), reload: r(e.w.reload, 4), bloom: r(e.w.bloom, 4) };
    return out;
  }
  for (const k of ['x', 'y', 'z']) out[k] = r(e[k], 2);
  for (const k of ['vx', 'vy', 'vz']) out[k] = r(e[k], 1);
  out.yaw = r(e.yaw, 3); out.pitch = r(e.pitch, 3);
  for (const k of ['crouch', 'prone', 'lean']) out[k] = r(e[k], 2);
  if (e.ad !== undefined) out.ad = r(e.ad, 2);
  if (e.w) out.w = e.w.reload > 0 ? { id: e.w.id, reload: r(e.w.reload, 1) } : { id: e.w.id };
  if (!mate) delete out.hp;
  if (!e.alive) { delete out.w; delete out.vt; delete out.rk; }
  return out;
}

/** A drone as one viewer needs it: their own (the one they fly) exactly, the rest only to draw. */
export function trimDrone(d, own) {
  if (own) return { ...d, x: r(d.x, 4), y: r(d.y, 4), z: r(d.z, 4), vx: r(d.vx, 4), vy: r(d.vy, 4), vz: r(d.vz, 4), yaw: r(d.yaw, 4), pitch: r(d.pitch, 4) };
  return { id: d.id, o: d.o, a: d.a, hp: d.hp, j: d.j, x: r(d.x, 2), y: r(d.y, 2), z: r(d.z, 2), yaw: r(d.yaw, 3), pitch: r(d.pitch, 3) };
}

const roundGrenade = (gr) => ({ ...gr, x: r(gr.x, 2), y: r(gr.y, 2), z: r(gr.z, 2) });
const same = (a, b) => a === b || (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** Only what changed in a player entry: changed fields, and null for each field that has gone. */
function diff(cur, prev) {
  const out = { id: cur.id };
  let changed = false;
  for (const k in cur) if (k !== 'id' && !same(cur[k], prev[k])) { out[k] = cur[k]; changed = true; }
  for (const k in prev) if (!(k in cur)) { out[k] = null; changed = true; }
  return changed ? out : null;
}

export class SnapshotSender {
  constructor(game) {
    this.game = game;
    this.sent = new Map();   // viewer id -> { players: Map(id -> entry), tops: { key: json }, at, keyAt }
    this.bytes = 0;          // what was queued, for measuring
  }

  forget(id) { this.sent.delete(id); }
  reset() { this.sent.clear(); }

  /**
   * players: the full entries; viewFor(team, entry): the entry as that team may see it; tops: per team
   * { cap, df, drones, grenades } (drones untrimmed).
   */
  send(t, players, viewFor, topsFor) {
    const g = this.game;
    // Everyone in the match with a connection (bots have none), and staff watching (they see both teams)
    const viewers = [];
    for (const [id, p] of g.players) if (!p.member.bot) viewers.push([id, p.member.team, g.io.sockets?.sockets?.get(id)]);
    for (const [id, socket] of g.room.spectators || []) viewers.push([id, 'spectator', socket]);
    for (const [id, team, socket] of viewers) {
      if (!socket?.connected) { this.sent.delete(id); continue; }
      if (socket.conn?.transport && !socket.conn.transport.writable) continue;   // busy: skip this one, like volatile
      const entries = players.map((e) => trimEntry(viewFor(team, e), e.id === id, team === 'spectator' || g.players.get(e.id)?.member.team === team));
      const top = topsFor(team);
      const tops = {
        cap: { p: r(top.cap.p, 3), c: top.cap.c },
        df: top.df,
        dr: top.drones.map((d) => trimDrone(d, d.o === id)),
        gr: top.grenades.map(roundGrenade),
      };
      const msg = this.encode(id, t, entries, tops);
      if (!msg) continue;
      const json = JSON.stringify(msg);
      this.bytes += json.length;
      socket.emit('snapshot', msg);
    }
  }

  /** The message for one viewer, or null when nothing changed and no heartbeat is due. */
  encode(id, t, entries, tops) {
    const last = this.sent.get(id);
    const now = t;
    const keyframe = !last || now - last.keyAt >= KEYFRAME_MS;
    const tj = {};
    for (const k in tops) tj[k] = tops[k] === undefined ? undefined : JSON.stringify(tops[k]);
    let msg;
    if (keyframe) {
      msg = { t, k: 1, p: entries, ...tops };
    } else {
      let changed = false;
      const p = entries.map((e) => {
        const prev = last.players.get(e.id);
        const d = prev ? diff(e, prev) : e;
        // Only the input number moved on (a player standing still in a pre-round screen): that alone isn't worth a
        // message. It goes with the next one, and the client just replays a few more inputs.
        if (d && !(e.id === id && Object.keys(d).length === 2 && 'seq' in d)) changed = true;
        return d || { id: e.id };
      });
      if (entries.length !== last.players.size) changed = true;
      msg = { t, p };
      for (const k in tops) if (tj[k] !== last.tops[k]) { msg[k] = tops[k]; changed = true; }
      if (!changed && now - last.at < HEARTBEAT_MS) return null;
    }
    this.sent.set(id, { players: new Map(entries.map((e) => [e.id, e])), tops: tj, at: now, keyAt: keyframe ? now : last.keyAt });
    return msg;
  }
}
