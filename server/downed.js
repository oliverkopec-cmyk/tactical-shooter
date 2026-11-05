// Knocked down by Aegis's shield bash (Stage Q). A downed player is still alive, with 1 health, so any damage from an
// enemy finishes them through the normal damage code. They lie on the floor and crawl (shared/movement.js), can't shoot
// or use anything (GameState.handleAction), and bleed out unless a teammate holds the interact key next to them or a
// Medic lands a stim dart. They don't hold a site or keep a round going (rounds.js census).

import { DOWNED, PHASE, PRONE_TRANSITION } from '../shared/constants.js';
import { raycastWorld } from '../shared/raycast.js';

const HOLD_GRACE_MS = 500;   // the key still counts as held between input packets: a lag spike doesn't throw away a revive
const r2 = (v) => Math.round(v * 100) / 100;

export class DownedPlayers {
  constructor(game) {
    this.game = game;
  }

  knockDown(id, p, byId) {
    if (p.downed || !p.alive) return;
    const g = this.game, s = p.state, by = g.players.get(byId);
    p.downed = { until: Date.now() + DOWNED.bleedMs, by: byId, progress: 0, reviver: null };
    p.health = 1;
    p.interactAt = 0;
    Object.assign(s, { downed: 1, ads: 0, sprinting: false, dash: 0, vaultT: 0, rap: 0, rapFlip: 0, rapSide: 0 });
    g.placing.cancel(id, 'You were knocked down.');
    g.gadgets.exitCamera(id, p);
    g.rosterDirty = true;
    if (g.withBots && p.member.bot) g.bots.onHurt(id, byId);
    g.io.to(byId).emit('hitConfirm', { victim: id, damage: 0, head: false, killed: false });
    g.io.to(id).emit('damaged', { attacker: byId, damage: 0, health: 1, from: by ? [r2(by.state.x), r2(by.state.z)] : [r2(s.x), r2(s.z)] });
    g.emitAll('downed', { id, by: byId, pos: [r2(s.x), r2(s.y + 0.4), r2(s.z)] });
  }

  revive(id, p, byId) {
    const g = this.game, s = p.state;
    p.downed = null;
    s.downed = 0;
    p.health = DOWNED.reviveHealth;
    g.rosterDirty = true;
    g.emitAll('revived', { id, by: byId, pos: [r2(s.x), r2(s.y + 0.4), r2(s.z)] });
    g.io.to(id).emit('healed', { health: p.health });
  }

  /** Is this teammate holding the key next to them, with nothing between them? */
  canRevive(r, q, now) {
    if (!r.alive || r.downed || r.spawned === false || r.member.team !== q.member.team) return false;
    if (now - (r.interactAt || 0) > HOLD_GRACE_MS || r.state.sprinting || r.camView >= 0 || r.state.rap) return false;
    if (this.game.placing.isPlacing(r.member.id)) return false;
    const a = r.state, b = q.state, dy = b.y - a.y;
    if (Math.hypot(b.x - a.x, b.z - a.z) > DOWNED.reviveRange || Math.abs(dy) > 1.5) return false;
    const from = [a.x, a.y + 1, a.z], v = [b.x - a.x, b.y + 0.35 - from[1], b.z - a.z], d = Math.hypot(...v);
    if (d < 0.05) return true;
    const wall = raycastWorld(this.game.world, from, v.map((c) => c / d), d);
    return !wall || wall.t >= d - 0.15;
  }

  /** Once a tick: bleeding out and reviving. */
  update(now, dt, phase) {
    const players = this.game.players;
    let anyone = false;
    for (const p of players.values()) if (p.downed || p.reviving) { anyone = true; break; }
    if (!anyone) return;

    const busy = new Map();   // reviver id -> the teammate they are reviving
    if (phase === PHASE.ACTION) {
      for (const [id, q] of players) {
        if (!q.downed) continue;
        const d = q.downed;
        // They go down whether or not their inputs are arriving (a lagging player doesn't get to stay on their feet)
        if (!q.queue.length && q.state.prone < 1 && q.state.onGround) q.state.prone = Math.min(1, q.state.prone + PRONE_TRANSITION * dt);
        // Whoever was already at it carries on; otherwise the nearest one holding the key
        let reviver = null, nearest = Infinity;
        for (const [rid, r] of players) {
          if (rid === id || busy.has(rid) || !this.canRevive(r, q, now)) continue;
          const dist = rid === d.reviver ? -1 : Math.hypot(r.state.x - q.state.x, r.state.z - q.state.z);
          if (dist < nearest) { nearest = dist; reviver = rid; }
        }
        if (reviver !== d.reviver) d.progress = 0;
        d.reviver = reviver;
        if (reviver) {
          busy.set(reviver, id);
          d.progress += dt * 1000;
          d.until += dt * 1000;   // the clock waits while someone is working on them
          if (d.progress >= DOWNED.reviveMs) { this.revive(id, q, reviver); continue; }
        }
        if (now >= d.until) {
          const killer = players.has(d.by) ? d.by : id;   // credit whoever knocked them down, if they're still here
          this.game.kill(id, q, killer, 'bleedout', false);
        }
      }
    }
    // A reviver kneels with their hands full, like placing something: no shooting, and they move slowly
    for (const [id, r] of players) {
      const target = busy.get(id) ?? null;
      if (target === r.reviving) continue;
      if (target && !r.reviving) r.placing = 1;
      if (!target && !this.game.placing.isPlacing(id)) r.placing = 0;
      r.reviving = target;
    }
  }
}
