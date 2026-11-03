// Placing takes time (Stage 27): the server times every placement, so it can't be skipped.
//
// A placement starts when its key goes down (after a quick check that the spot is valid) and
// finishes when the time is up, by calling the gadget's own code, which checks everything again and
// uses up the item. Letting go of the key, getting hit, sprinting, switching weapons, dying or the
// phase ending cancels it and nothing is used up. While placing you walk slowly and can't shoot.

import { PLACE, placementTarget } from '../shared/placing.js';

export class Placing {
  constructor(game) {
    this.game = game;
    this.active = new Map();   // playerId -> { kind, action, label, ms, doneAt, slot, phase, pose, target, finish }
  }

  isPlacing(id) { return this.active.has(id); }
  get(id) { return this.active.get(id) || null; }

  /**
   * Start placing `kind` (a key of PLACE). opts: { action: the key's action (letting it go cancels),
   * finish(rec): places the item (its own checks; return false if it didn't happen), target: anything
   * the finish needs to remember, check(target): extra refusal message or null }.
   * Returns true if placing started.
   */
  start(id, p, kind, { action, finish, target = null, check = null, ms = null, label = null }) {
    if (this.active.has(id)) return false;
    const P = PLACE[kind];
    const aim = placementTarget(kind, this.game.world, this.game.map, p.state);
    if (!aim.ok) { this.game.gadgets.error(id, aim.reason); return false; }
    const why = check?.(aim);
    if (why) { this.game.gadgets.error(id, why); return false; }
    const now = Date.now();
    const rec = {
      kind, action, label: label || P.label, ms: ms ?? P.ms, doneAt: now + (ms ?? P.ms), slot: p.weapon.slot,
      phase: this.game.rounds.phase, pose: aim.pose, target, aim, finish,
    };
    this.active.set(id, rec);
    p.placing = rec.pose === 'floor' ? 1 : 2;   // sent in snapshots: everyone sees you kneel or reach forward
    this.game.io.to(id).emit('placeStart', { kind, label: rec.label, ms: rec.ms });
    return true;
  }

  /** Stop without placing anything. reason: shown to the player (empty for letting go). */
  cancel(id, reason = '') {
    const rec = this.active.get(id);
    if (!rec) return;
    this.active.delete(id);
    const p = this.game.players.get(id);
    if (p) p.placing = 0;
    this.game.io.to(id).emit('placeEnd', { done: false, reason });
  }

  /** The key for `action` went up: if that's what is being placed, stop. */
  release(id, action) {
    if (this.active.get(id)?.action === action) this.cancel(id);
  }

  update(now) {
    for (const [id, rec] of [...this.active]) {
      const p = this.game.players.get(id);
      if (!p || !p.alive || p.spawned === false) { this.cancel(id); continue; }
      if (this.game.rounds.phase !== rec.phase) { this.cancel(id); continue; }
      if (p.state.sprinting) { this.cancel(id, 'Sprinting stopped you placing it.'); continue; }
      if (p.weapon.slot !== rec.slot) { this.cancel(id, 'Switching weapons stopped you placing it.'); continue; }
      if (now < rec.doneAt) continue;
      this.active.delete(id);
      p.placing = 0;
      const done = rec.finish(rec) !== false;
      this.game.io.to(id).emit('placeEnd', { done, kind: rec.kind });
    }
  }

  clear() {
    for (const id of [...this.active.keys()]) this.cancel(id);
  }
}
