// Server-side destruction: panel damage from bullets, breach charges and
// wall reinforcement. The shared World holds which panels stand; this class
// owns the rules and tells clients what changed.

import {
  BREACH, BARRICADE, CHARGE_REACH, REINFORCE_REACH, REINFORCE_TIME_MS, TEAM_REINFORCEMENTS, PHASE,
} from '../shared/constants.js';
import { PANEL_HP } from '../shared/world.js';
import { HATCH } from '../shared/constants.js';
import { getEyePosition } from '../shared/movement.js';
import { aimDirection } from '../shared/weapons.js';
import { raycastWorld } from '../shared/raycast.js';

export class Destruction {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.panelHp = this.freshHp();
    this.charges = new Map();      // id -> { id, owner, type, pos, normal }
    this.nextChargeId = 1;
    this.reinforcing = new Map();  // playerId -> { sectionId, doneAt }
    this.reinforcementsLeft = TEAM_REINFORCEMENTS;
    this.pendingDestroyed = [];
  }

  /** Full health for every panel (hatch covers are sturdier than plaster). */
  freshHp() {
    return Float32Array.from(this.world.panels, (p) => (p.hatch ? HATCH.hp : PANEL_HP));
  }

  /** New round: every wall intact again, no charges, full reinforcement pool. */
  reset() {
    this.panelHp = this.freshHp();
    this.charges.clear();
    this.reinforcing.clear();
    this.reinforcementsLeft = TEAM_REINFORCEMENTS;
    this.pendingDestroyed = [];
  }

  emitAll(event, payload) { this.game.emitAll(event, payload); }
  emitTo(id, event, payload) { this.game.io.to(id).emit(event, payload); }
  error(id, msg) { this.emitTo(id, 'actionError', { msg }); }

  // ---------------------------------------------------------------- panels

  /** Bullet damage. Reinforced panels shrug it off. */
  damagePanel(panelId, amount) {
    if (!this.world.alive[panelId] || this.world.isReinforcedPanel(panelId)) return;
    this.panelHp[panelId] -= amount;
    if (this.panelHp[panelId] <= 0) this.destroy([panelId]);
  }

  destroy(ids) {
    const removed = this.world.destroyPanels(ids);
    this.pendingDestroyed.push(...removed);
    return removed;
  }

  /** Called once per tick: batch all bullet-destroyed panels into one message. */
  flush() {
    if (!this.pendingDestroyed.length) return;
    this.emitAll('panelsDestroyed', { ids: this.pendingDestroyed });
    this.pendingDestroyed = [];
  }

  /** The panel a player is looking at within reach, or null. */
  aimedPanel(p, reach, allowBarricade = false) {
    const eye = getEyePosition(p.state, this.world);
    const origin = [eye.x, eye.y, eye.z];
    const dir = aimDirection(p.state.yaw, p.state.pitch);
    const hit = raycastWorld(this.world, origin, dir, reach);
    if (!hit || (hit.box.kind !== 'panel' && !(allowBarricade && hit.box.kind === 'barricade'))) return null;
    return { hit, panel: hit.box };
  }

  // ---------------------------------------------------------------- breach charges

  /** G: plant a charge on the wall you're looking at, or detonate the one you planted. */
  useBreach(id, p, type = 'basic') {
    if (!p.alive) return;
    if (this.game.rounds.phase !== PHASE.ACTION) return this.error(id, 'Breach charges work once the action phase starts.');
    const slot = type === 'heavy' ? 'placedHeavy' : 'placedCharge';
    if (p[slot] && this.charges.has(p[slot])) {
      const planted = this.charges.get(p[slot]);
      if (this.game.gadgets.isJammed(planted.pos)) return this.error(id, 'A signal jammer has disabled your charge.');
      this.detonate(p[slot]);
      return;
    }
    if (p.member.team !== 'attack') return this.error(id, 'Only attackers carry breach charges.');
    if ((type === 'heavy' ? p.ability?.charges : p.charges) <= 0) return this.error(id, 'No breach charges left.');
    const aim = this.aimedPanel(p, CHARGE_REACH, true);
    if (!aim) return this.error(id, 'Aim at a destructible wall within 2 m.');
    const cfg = BREACH[type];
    if (aim.panel.kind === 'panel' && this.world.isReinforcedPanel(aim.panel.id) && !cfg.breaksReinforced) {
      return this.error(id, 'That wall is reinforced. Only a heavy charge breaks it.');
    }

    const { point, normal } = aim.hit;
    if (this.game.gadgets.isJammed(point)) return this.error(id, 'A signal jammer blocks breach charges here.');
    const charge = {
      id: this.nextChargeId++, owner: id, type,
      pos: [point[0] + normal[0] * 0.04, point[1] + normal[1] * 0.04, point[2] + normal[2] * 0.04],
      normal,
    };
    this.charges.set(charge.id, charge);
    if (type === 'heavy') p.ability.charges--; else p.charges--;
    p[slot] = charge.id;
    p.stats.plants++;
    this.emitAll('chargePlaced', charge);
    this.game.sendLoadout(id, p);
  }

  detonate(chargeId) {
    const charge = this.charges.get(chargeId);
    if (!charge) return;
    this.charges.delete(chargeId);
    const cfg = BREACH[charge.type];
    const owner = this.game.players.get(charge.owner);
    if (owner && owner.placedCharge === chargeId) owner.placedCharge = null;
    if (owner && owner.placedHeavy === chargeId) owner.placedHeavy = null;

    const targets = this.world.panelsNear(charge.pos, cfg.radius)
      .filter((pid) => cfg.breaksReinforced || !this.world.isReinforcedPanel(pid));
    const removed = this.world.destroyPanels(targets);
    this.game.gadgets.blastBarricades(charge.pos, cfg.radius + BARRICADE.blastExtra);
    this.emitAll('chargeExploded', { id: charge.id, pos: charge.pos, normal: charge.normal, panels: removed });

    // Blast damage to the owner and enemies nearby (walls don't shield; it's a breach charge)
    const ownerTeam = owner?.member.team;
    for (const [pid, p] of this.game.players) {
      if (!p.alive) continue;
      if (pid !== charge.owner && p.member.team === ownerTeam) continue;
      const dx = p.state.x - charge.pos[0], dy = p.state.y + 1.0 - charge.pos[1], dz = p.state.z - charge.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d >= cfg.damageRadius) continue;
      this.game.applyDamage(pid, charge.owner, cfg.damage * (1 - d / cfg.damageRadius), {
        weapon: 'breach', from: [charge.pos[0], charge.pos[2]],
      });
    }
    if (owner) this.game.sendLoadout(charge.owner, owner);
  }

  removeChargesOf(playerId) {
    for (const [cid, c] of this.charges) {
      if (c.owner !== playerId) continue;
      this.charges.delete(cid);
      this.emitAll('chargeRemoved', { id: cid });
    }
  }

  // ---------------------------------------------------------------- reinforcement

  /** V: defenders reinforce the wall section they're looking at. */
  startReinforce(id, p, personal = false) {
    if (!p.alive) return;
    if (p.member.team !== 'defense') return this.error(id, 'Only defenders can reinforce walls.');
    if (this.game.rounds.phase !== PHASE.PREP) return this.error(id, 'Walls can only be reinforced during the prep phase.');
    if (this.reinforcing.has(id)) return;
    if (personal ? p.ability?.charges <= 0 : this.reinforcementsLeft <= 0) {
      return this.error(id, personal ? 'You have no extra reinforcements left.' : 'Your team has no reinforcements left.');
    }
    const aim = this.aimedPanel(p, REINFORCE_REACH);
    if (!aim) return this.error(id, 'Aim at a destructible wall within 2 m.');
    const section = this.world.sections[aim.panel.sectionId];
    if (!section.reinforceable) return this.error(id, 'That piece of wall is too small to reinforce.');
    if (this.world.reinforced[section.id]) return this.error(id, 'Already reinforced.');
    if (!this.world.sectionIntact(section.id)) return this.error(id, 'Damaged walls can\'t be reinforced.');
    for (const r of this.reinforcing.values()) {
      if (r.sectionId === section.id) return this.error(id, 'A teammate is already reinforcing that wall.');
    }
    this.reinforcing.set(id, { sectionId: section.id, doneAt: Date.now() + REINFORCE_TIME_MS, personal });
    this.emitTo(id, 'reinforceStart', { section: section.id, ms: REINFORCE_TIME_MS });
  }

  cancelReinforce(id, reason) {
    if (!this.reinforcing.delete(id)) return;
    this.emitTo(id, 'reinforceCancel', { reason });
  }

  update(now) {
    for (const [id, r] of this.reinforcing) {
      if (now < r.doneAt) continue;
      const p = this.game.players.get(id);
      this.reinforcing.delete(id);
      const section = this.world.sections[r.sectionId];
      if (!p || !p.alive) continue;
      if (distanceToBox(p.state, section) > REINFORCE_REACH + 0.6) { this.emitTo(id, 'reinforceCancel', { reason: 'Moved too far away.' }); continue; }
      if (!this.world.sectionIntact(section.id)) { this.emitTo(id, 'reinforceCancel', { reason: 'The wall was damaged.' }); continue; }
      if (this.world.reinforced[section.id] || (r.personal ? !(p.ability?.charges > 0) : this.reinforcementsLeft <= 0)) { this.emitTo(id, 'reinforceCancel', { reason: '' }); continue; }

      this.world.reinforce(section.id);
      p.stats.reinforced++;
      if (r.personal) { p.ability.charges--; this.game.sendLoadout(id, p); } else this.reinforcementsLeft--;
      for (const pid of section.panelIds) this.panelHp[pid] = this.world.panels[pid].hatch ? HATCH.hp : PANEL_HP;
      this.emitAll('reinforced', { section: section.id, left: this.reinforcementsLeft });
    }
    this.flush();
  }

  snapshot() {
    return {
      world: this.world.snapshot(),
      charges: [...this.charges.values()],
      reinforcementsLeft: this.reinforcementsLeft,
    };
  }
}

function distanceToBox(s, box) {
  const px = s.x, py = s.y + 1, pz = s.z;
  const dx = Math.max(box.min[0] - px, 0, px - box.max[0]);
  const dy = Math.max(box.min[1] - py, 0, py - box.max[1]);
  const dz = Math.max(box.min[2] - pz, 0, pz - box.max[2]);
  return Math.hypot(dx, dy, dz);
}
