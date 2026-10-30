// The Defuser mode (see shared/modes.js). One random attacker carries the defuser. If they die it
// drops where they fell and any attacker can pick it up by walking over it. The carrier plants it
// by holding the interact key still inside the objective zone for DEFUSER.plantS seconds; it then
// counts down DEFUSER.countdownS seconds. A defender disables it by holding the key still in the
// zone for DEFUSER.disableS seconds. The server alone decides all of it; the client only sends the
// held key and draws what it is told.

import { DEFUSER } from '../shared/modes.js';
import { KEY } from '../shared/constants.js';
import { inObjectiveZone } from '../shared/rules.js';

const HELD_MS = 250;                     // the key counts as held this long after the last input that had it

export class Defuser {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.carrier = null;                 // player id
    this.dropped = null;                 // [x, y, z] while lying on the floor
    this.planted = null;                 // { pos, detonateAt }
    this.acts = new Map();               // player id -> { kind: 'plant' | 'disable', start }
    this.live = false;
  }

  get zone() { return this.game.activeSite(); }
  emitAll(event, payload) { this.game.emitAll(event, payload); }
  emitTeam(team, event, payload) {
    for (const [id, p] of this.game.players) if (p.member.team === team) this.game.io.to(id).emit(event, payload);
  }

  /** The action phase begins: pick the carrier at random among the attackers. */
  beginAction() {
    this.reset();
    this.live = true;
    const attackers = [...this.game.players].filter(([, p]) => p.member.team === 'attack' && p.alive);
    if (!attackers.length) return;
    this.carrier = attackers[Math.floor(Math.random() * attackers.length)][0];
    this.emitTeam('attack', 'defuserEvent', { type: 'carrier', carrier: this.carrier });
  }

  /** The key bit seen in a player's latest input. */
  hold(p, now) { return now - (p.interactAt || 0) < HELD_MS; }

  still(p) { return Math.hypot(p.state.vx, p.state.vz) <= DEFUSER.stillSpeed && p.state.onGround; }

  /** A player died or left: a dying carrier drops the defuser; any plant or disable they were doing stops. */
  onGone(id, p) {
    if (!this.live) return;
    this.cancel(id);
    if (this.carrier === id) {
      this.carrier = null;
      this.dropped = [p.state.x, p.state.y + 0.05, p.state.z];
      this.emitTeam('attack', 'defuserEvent', { type: 'dropped', pos: this.dropped });
      this.emitTeam('defense', 'defuserEvent', { type: 'carrierDown' });
    }
  }

  cancel(id) {
    if (!this.acts.delete(id)) return;
    this.game.io.to(id).emit('defuserEvent', { type: 'actEnd' });
  }

  startAct(id, p, kind, now) {
    this.acts.set(id, { kind, start: now });
    const ms = (kind === 'plant' ? DEFUSER.plantS : DEFUSER.disableS) * 1000;
    this.game.io.to(id).emit('defuserEvent', { type: 'actStart', kind, ms });
    // The other side is warned
    const other = p.member.team === 'attack' ? 'defense' : 'attack';
    this.emitTeam(other, 'defuserEvent', { type: kind === 'plant' ? 'planting' : 'disabling', by: p.member.name });
  }

  /** Once a tick. Returns 'detonated' or 'disabled' when the round should end, else null. */
  update(now) {
    if (!this.live) return null;
    const players = this.game.players;

    // Pick up a dropped defuser
    if (this.dropped && !this.planted) {
      for (const [id, p] of players) {
        if (p.member.team !== 'attack' || !p.alive || p.spawned === false) continue;
        if (Math.hypot(p.state.x - this.dropped[0], p.state.z - this.dropped[2]) <= DEFUSER.pickupReach && Math.abs(p.state.y - this.dropped[1]) < 1.6) {
          this.carrier = id;
          this.dropped = null;
          this.emitTeam('attack', 'defuserEvent', { type: 'carrier', carrier: id, pickedUp: true });
          break;
        }
      }
    }

    // Planting: the carrier, in the zone, holding still
    if (!this.planted && this.carrier) {
      const p = players.get(this.carrier);
      const zone = this.zone;
      const ok = p && p.alive && this.hold(p, now) && this.still(p) && inObjectiveZone(zone, p.state);
      const act = this.acts.get(this.carrier);
      if (!ok) { if (act) this.cancel(this.carrier); }
      else if (!act) this.startAct(this.carrier, p, 'plant', now);
      else if (now - act.start >= DEFUSER.plantS * 1000) this.plant(p, now);
    }

    // Disabling: any defender, in the zone, holding still, once it is planted
    if (this.planted) {
      let done = false;
      for (const [id, p] of players) {
        if (p.member.team !== 'defense') continue;
        const ok = p.alive && this.hold(p, now) && this.still(p) && inObjectiveZone(this.zone, p.state);
        const act = this.acts.get(id);
        if (!ok) { if (act) this.cancel(id); continue; }
        if (!act) this.startAct(id, p, 'disable', now);
        else if (now - act.start >= DEFUSER.disableS * 1000) { done = true; p.stats.objSecs = (p.stats.objSecs || 0) + DEFUSER.disableS; }
      }
      if (done) { this.finish('disabled'); return 'disabled'; }
      if (now >= this.planted.detonateAt) { this.finish('detonated'); return 'detonated'; }
    }
    return null;
  }

  plant(p, now) {
    const zone = this.zone;
    this.acts.delete(this.carrier);
    const planter = this.carrier;
    this.carrier = null;
    this.planted = { pos: [zone.x, zone.y, zone.z], detonateAt: now + DEFUSER.countdownS * 1000 };
    p.stats.plants = (p.stats.plants || 0) + 1;
    this.game.io.to(planter).emit('defuserEvent', { type: 'actEnd' });
    this.emitAll('defuserEvent', { type: 'planted', pos: this.planted.pos, ms: DEFUSER.countdownS * 1000, by: p.member.name });
    // The round clock becomes the countdown
    this.game.rounds.endsAt = this.planted.detonateAt;
    this.game.emitAll('phase', this.game.rounds.info());
  }

  finish(type) {
    for (const id of [...this.acts.keys()]) this.cancel(id);
    this.emitAll('defuserEvent', { type, pos: this.planted?.pos });
    this.live = false;
  }

  /** What one team may know: attackers see who carries it and where it lies; everyone sees it once planted. */
  view(team, now = Date.now()) {
    return {
      c: team === 'attack' ? this.carrier : null,
      d: team === 'attack' || team === 'spectator' ? this.dropped : null,
      p: this.planted ? { pos: this.planted.pos, left: Math.max(0, this.planted.detonateAt - now) } : null,
    };
  }
}
