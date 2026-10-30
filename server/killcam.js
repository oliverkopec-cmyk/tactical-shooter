// Killcam: the last few seconds of every player's movement and shots, so a player who dies can be
// shown their death from the killer's eyes. Only KILLCAM.keepMs of samples are kept per player
// (about 90 small arrays each), so memory stays tiny.

const r2 = (v) => Math.round(v * 100) / 100;

export const KILLCAM = { ms: 4000, keepMs: 4500, sampleMs: 50 };

export class KillcamRecorder {
  constructor() {
    this.trails = new Map();   // id -> [[t, x, y, z, yaw, pitch, crouch, prone, lean], ...]
    this.shots = new Map();    // id -> [{ t, ends }]
    this.last = 0;
  }

  reset() { this.trails.clear(); this.shots.clear(); }
  forget(id) { this.trails.delete(id); this.shots.delete(id); }

  /** Called every tick; samples 20 times a second. */
  record(now, players) {
    if (now - this.last < KILLCAM.sampleMs) return;
    this.last = now;
    const cutoff = now - KILLCAM.keepMs;
    for (const [id, p] of players) {
      if (!p.alive || p.spawned === false) continue;
      const s = p.state;
      let list = this.trails.get(id);
      if (!list) this.trails.set(id, list = []);
      list.push([now, r2(s.x), r2(s.y), r2(s.z), r2(s.yaw), r2(s.pitch), r2(s.crouch), r2(s.prone || 0), r2(s.lean), s.rapFlip ? r2(s.rapFlip) : 0]);
      while (list.length && list[0][0] < cutoff) list.shift();
    }
  }

  shot(id, now, ends) {
    let list = this.shots.get(id);
    if (!list) this.shots.set(id, list = []);
    list.push({ t: now, ends });
    while (list.length && list[0].t < now - KILLCAM.keepMs) list.shift();
  }

  /** What the victim's client needs to replay the kill. Times are relative to `now` (ms before the kill). */
  build(now, killerId, killer, victimId, victim) {
    const from = now - KILLCAM.ms;
    const rel = (list) => (list || []).filter((s) => s[0] >= from).map(([t, ...rest]) => [t - now, ...rest]);
    const w = killer.weapon?.id;
    return {
      killer: killerId, name: killer.member.name, op: killer.operator,
      weapon: w, skin: killer.member.skins?.[w] || null, charm: killer.member.charms?.[w] || null,
      health: Math.max(0, Math.round(killer.health)), team: killer.member.team,
      trail: rel(this.trails.get(killerId)),
      victimTrail: rel(this.trails.get(victimId)),
      victimOp: victim.operator, victimTeam: victim.member.team,
      shots: (this.shots.get(killerId) || []).filter((s) => s.t >= from).map((s) => ({ t: s.t - now, ends: s.ends })),
    };
  }
}
