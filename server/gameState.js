// Authoritative simulation for one room's match.
// Clients send timestamped inputs; the server replays them through the shared
// movement and weapon code, resolves shots, and broadcasts snapshots. Input
// time is rationed against real time so a modified client can't move or fire
// faster by sending extra inputs.

import { MAP } from '../shared/map.js';
import { createPlayerState, stepPlayer, weaponInput } from '../shared/movement.js';
import { createWeaponState, stepWeapon, gunMobility } from '../shared/weapons.js';
import { UTILITIES } from '../shared/utilities.js';
import { OPERATORS, defaultOperator, operatorsFor, speedMultiplier, damageMultiplier } from '../shared/operators.js';
import { World } from '../shared/world.js';
import { maskKeys, attackSpawnPoint, inObjectiveZone } from '../shared/rules.js';
import {
  DRONE, DRONE_KEYS, createDroneState, stepDrone, droneEye,
} from '../shared/drone.js';
import { forwardVec, rightVec, getEyePosition } from '../shared/movement.js';
import { aimDirection } from '../shared/weapons.js';
import { raycastWorld } from '../shared/raycast.js';
import {
  SNAPSHOT_RATE, MAX_INPUT_DT, MAX_TIME_BUDGET, KEY_MASK, MAX_HEALTH, BASIC_CHARGES, PHASE, CAPTURE_TIME,
  SPOT_DURATION_MS, PING_COOLDOWN_MS, MELEE, BARRICADE,
} from '../shared/constants.js';
import { PoseHistory, resolveShot } from './combat.js';
import { Destruction } from './destruction.js';
import { RoundManager } from './rounds.js';
import { Gadgets } from './abilities.js';

const TICK_RATE = 60;
const MAX_QUEUED_INPUTS = 120;
const MAX_PITCH = Math.PI / 2;

export class GameState {
  constructor(room) {
    this.room = room;
    this.world = new World();
    this.destruction = new Destruction(this);
    this.rounds = new RoundManager(this);
    this.gadgets = new Gadgets(this);
    this.players = new Map(); // id -> ServerPlayer
    this.history = new PoseHistory();
    this.drones = new Map();   // id -> { id, owner, state, hp, alive }
    this.site = null;          // index into MAP.sites, chosen by the defenders' vote
    this.siteFound = false;    // attackers learn the site only once they've found it
    this.siteVotes = new Map();// defender id -> site index
    this.nextDroneId = 1;
    this.timer = null;
    this.tick = 0;
    this.lastTickTime = 0;
  }

  get io() {
    return this.room.io;
  }

  emitAll(event, payload) {
    this.io.to(this.room.channel).emit(event, payload);
  }

  addPlayer(member) {
    // Score follows the squad, which is fixed for the whole match.
    member.squad = this.rounds.squadOf(member.team);
    member.startTeam = this.rounds.swapped ? opposite(member.team) : member.team;
    // Joining mid-round: sit out until the next round starts.
    const joinsAlive = this.rounds.round === 0 || this.rounds.phase === PHASE.INTRO;
    this.players.set(member.id, {
      member,                          // shared with the room (name, team, squad)
      state: createPlayerState(this.pickSpawn(member.team)),
      weapon: createWeaponState('rifle'),
      health: MAX_HEALTH,
      alive: joinsAlive,
      charges: member.team === 'attack' ? BASIC_CHARGES : 0,
      placedCharge: null,
      kills: 0,
      deaths: 0,
      operator: defaultOperator(member.team),
      opConfirmed: false,     // picked on the select screen this round
      ability: null,          // { charges, cdUntil, shieldId } for the current operator
      utilityChoice: null,    // the utility picked on the select screen (kept between rounds)
      utility: null,          // { id, charges } for this round
      utilityReadyAt: 0,
      camView: -1,            // index of the camera a defender is watching, or -1
      camId: null,
      stunUntil: 0,
      placedHeavy: null,
      spawned: true,          // attackers have no body during prep
      spawnChoice: 1,         // which outside entry point (1-3) they appear at
      activeDrone: null,
      spottedUntil: 0,
      queue: [],
      lastSeq: -1,
      timeBudget: 0,
    });
    this.applyOperator(this.players.get(member.id));
  }

  removePlayer(id) {
    this.players.delete(id);
    for (const d of [...this.drones.values()]) if (d.owner === id) this.drones.delete(d.id);
    this.destruction.removeChargesOf(id);
    this.destruction.reinforcing.delete(id);
    this.gadgets.barricading.delete(id);
  }

  /** Discrete actions that aren't part of the movement input stream. */
  handleAction(id, type) {
    const p = this.players.get(id);
    if (!p) return;
    if (type === 'breach') this.destruction.useBreach(id, p);
    else if (type === 'reinforce') this.destruction.startReinforce(id, p);
    else if (type === 'droneNext') this.cycleDrone(p);
    else if (type === 'ping') this.pingFromDrone(id, p, Date.now());
    else if (type === 'ability') this.gadgets.use(id, p);
    else if (type === 'utility') this.gadgets.useUtility(id, p);
    else if (type === 'barricade') this.gadgets.startBarricade(id, p);
    else if (type === 'melee') this.melee(id, p, Date.now());
    else if (type === 'camView') this.gadgets.cycleCamera(id, p);
  }

  // ---------------------------------------------------------------- drones

  /** Prep phase begins: every living attacker gets their drone(s) a few metres ahead. */
  spawnDrones() {
    this.drones.clear();
    for (const [id, p] of this.players) {
      p.activeDrone = null;
      if (!p.alive || p.member.team !== 'attack') continue;
      const [fx, fz] = forwardVec(p.state.yaw), [rx, rz] = rightVec(p.state.yaw);
      const count = 1 + (OPERATORS[p.operator]?.extraDrones || 0);
      for (let i = 0; i < count; i++) {
        const side = (i - (count - 1) / 2) * 0.7;
        const drone = {
          id: this.nextDroneId++, owner: id, hp: DRONE.hp, alive: true,
          state: createDroneState(
            p.state.x + fx * DRONE.spawnOffset + rx * side, p.state.y,
            p.state.z + fz * DRONE.spawnOffset + rz * side, p.state.yaw,
          ),
        };
        this.drones.set(drone.id, drone);
        if (p.activeDrone === null) p.activeDrone = drone.id;
      }
    }
  }

  /** Prep is over: drones are recalled. */
  clearDrones() {
    this.drones.clear();
    for (const p of this.players.values()) p.activeDrone = null;
  }

  activeDroneOf(p) {
    const d = p.activeDrone !== null ? this.drones.get(p.activeDrone) : null;
    return d && d.alive ? d : null;
  }

  cycleDrone(p) {
    const mine = [...this.drones.values()].filter((d) => d.owner === p.member.id && d.alive);
    if (mine.length < 2) return;
    const i = mine.findIndex((d) => d.id === p.activeDrone);
    p.activeDrone = mine[(i + 1) % mine.length].id;
  }

  damageDrone(droneId, attackerId, amount) {
    const drone = this.drones.get(droneId);
    if (!drone || !drone.alive) return;
    drone.hp -= amount;
    const killed = drone.hp <= 0;
    this.io.to(attackerId).emit('hitConfirm', { victim: droneId, damage: Math.round(amount), head: false, killed });
    if (!killed) return;
    drone.alive = false;
    this.drones.delete(droneId);
    const owner = this.players.get(drone.owner);
    if (owner && owner.activeDrone === droneId) {
      owner.activeDrone = null;
      this.cycleToFirstDrone(owner);
    }
    this.emitAll('droneDestroyed', { id: droneId, owner: drone.owner, pos: [drone.state.x, drone.state.y + 0.15, drone.state.z] });
  }

  cycleToFirstDrone(p) {
    const next = [...this.drones.values()].find((d) => d.owner === p.member.id && d.alive);
    p.activeDrone = next ? next.id : null;
  }

  /**
   * Drone pilot left-click: mark the enemy under the crosshair (small aim tolerance)
   * if the drone has a clear line of sight. The mark lasts a few seconds for the
   * whole attacking team.
   */
  pingFromDrone(id, p, now) {
    if (!p.alive || this.rounds.phase !== PHASE.PREP || now < (p.pingReadyAt || 0)) return;
    const drone = this.activeDroneOf(p);
    if (!drone || drone.jammed) return;
    p.pingReadyAt = now + PING_COOLDOWN_MS;
    const hit = this.pingFrom(p, droneEye(drone.state), aimDirection(drone.state.yaw, drone.state.pitch), now);
    this.io.to(id).emit('pingResult', { hit });
  }

  /**
   * Mark the enemy nearest the aim line (small tolerance) if there is a clear
   * line of sight from `eye`. Shared by drone pilots and Hawk's own eyes.
   * The mark lasts a few seconds for the whole attacking team.
   */
  pingFrom(p, eye, aim, now) {
    let best = null;
    for (const q of this.players.values()) {
      if (!q.alive || q.spawned === false || q.member.team !== 'defense') continue;
      for (const h of [1.55, 1.0, 0.4]) {
        const v = [q.state.x - eye[0], q.state.y + h - eye[1], q.state.z - eye[2]];
        const dist = Math.hypot(v[0], v[1], v[2]);
        if (dist > DRONE.pingRange || dist < 0.1) continue;
        const dir = [v[0] / dist, v[1] / dist, v[2] / dist];
        const angle = Math.acos(Math.min(1, dir[0] * aim[0] + dir[1] * aim[1] + dir[2] * aim[2]));
        if (angle > DRONE.pingCone || (best && angle >= best.angle)) continue;
        const wall = raycastWorld(this.world, eye, dir, dist);
        if (wall && wall.t < dist - 0.25) continue;
        best = { q, angle };
      }
    }
    if (best) best.q.spottedUntil = now + SPOT_DURATION_MS;
    return !!best;
  }

  // ---------------------------------------------------------------- operators

  /** Give a player their operator's weapon, ratings and ability stock. */
  applyOperator(p) {
    const op = OPERATORS[p.operator];
    p.weapon = createWeaponState(op.weapons.primary, op.weapons.secondary);
    p.state.speedMul = speedMultiplier(op);
    p.ability = op.ability ? { charges: op.ability.charges ?? 0, cdUntil: 0, shieldId: null } : null;
    p.placedHeavy = null;
    // Keep last round's utility if this operator offers it, else the first one
    if (!op.utilities.includes(p.utilityChoice)) p.utilityChoice = op.utilities[0];
    p.utility = { id: p.utilityChoice, charges: UTILITIES[p.utilityChoice].charges };
    p.utilityReadyAt = 0;
    this.sendLoadout(p.member.id, p);
  }

  /** The select screen: choose which of the operator's two utilities to bring this round. */
  pickUtility(id, utilityId) {
    const p = this.players.get(id);
    if (!p || this.rounds.phase !== PHASE.INTRO) return;
    if (!OPERATORS[p.operator].utilities.includes(utilityId)) return;
    p.utilityChoice = utilityId;
    p.utility = { id: utilityId, charges: UTILITIES[utilityId].charges };
    this.sendLoadout(id, p);
  }

  pickOperator(id, opId) {
    const p = this.players.get(id);
    const op = OPERATORS[opId];
    if (!p || !op || this.rounds.phase !== PHASE.INTRO) return;
    if (op.team !== p.member.team) return this.gadgets.error(id, 'That operator is on the other team.');
    if (op.unique) {
      const holder = [...this.players.values()].find((q) => q !== p && q.operator === opId && q.opConfirmed && q.member.team === p.member.team);
      if (holder) return this.gadgets.error(id, `${op.name} is already taken by ${holder.member.name}.`);
      // A teammate's unconfirmed carry-over from last round gives way
      for (const q of this.players.values()) {
        if (q !== p && q.operator === opId && q.member.team === p.member.team) {
          q.operator = defaultOperator(q.member.team);
          this.applyOperator(q);
        }
      }
    }
    p.operator = opId;
    p.opConfirmed = true;
    this.applyOperator(p);
    this.sendPicks();
  }

  allPicked() {
    return this.players.size > 0 && [...this.players.values()].every((p) => p.opConfirmed || !p.alive);
  }

  /** Select time is over: anyone who didn't choose keeps last round's operator if free, else gets a free one. */
  finalizeOperators() {
    for (const team of ['attack', 'defense']) {
      const mates = [...this.players.values()].filter((p) => p.member.team === team);
      const taken = new Set(mates.filter((p) => p.opConfirmed).map((p) => p.operator));
      for (const p of mates.filter((q) => !q.opConfirmed)) {
        const op = OPERATORS[p.operator];
        if (op.unique && taken.has(p.operator)) {
          const free = operatorsFor(team).find((o) => o.unique && !taken.has(o.id));
          p.operator = free ? free.id : defaultOperator(team);
        }
        if (OPERATORS[p.operator].unique) taken.add(p.operator);
        p.opConfirmed = true;
        this.applyOperator(p);
      }
    }
    this.sendPicks(true);
  }

  picksFor(team) {
    const out = {};
    for (const [id, p] of this.players) {
      if (p.member.team === team) out[id] = { op: p.operator, confirmed: p.opConfirmed };
    }
    return out;
  }

  /** Teammates see each other's picks; the other team's choices stay hidden. */
  sendPicks(final = false) {
    for (const [id, p] of this.players) {
      this.io.to(id).emit('opPicks', { picks: this.picksFor(p.member.team), final });
    }
  }

  /** Right click: a quick strike at whatever is right in front of you. */
  melee(id, p, now) {
    const phase = this.rounds.phase;
    if (!p.alive || p.spawned === false || p.camView >= 0 || (phase !== PHASE.PREP && phase !== PHASE.ACTION)) return;
    if (now < (p.meleeReadyAt || 0)) return;
    p.meleeReadyAt = now + MELEE.cooldown * 1000;
    this.emitAll('melee', { id });

    const eye = getEyePosition(p.state, this.world);
    const origin = [eye.x, eye.y, eye.z];
    const aim = aimDirection(p.state.yaw, p.state.pitch);
    const inFront = (target, reach) => {
      const v = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
      const dist = Math.hypot(...v);
      if (dist > reach || dist < 0.05) return null;
      const dir = v.map((c) => c / dist);
      if (dir[0] * aim[0] + dir[1] * aim[1] + dir[2] * aim[2] < MELEE.cone) return null;
      const wall = raycastWorld(this.world, origin, dir, dist);
      return wall && wall.t < dist - 0.2 ? null : dist;
    };

    let best = null;
    for (const [qid, q] of this.players) {
      if (qid === id || !q.alive || q.spawned === false || q.member.team === p.member.team) continue;
      for (const h of [1.45, 0.95]) {
        const d = inFront([q.state.x, q.state.y + h, q.state.z], MELEE.reach + 0.35);
        if (d !== null && (!best || d < best.d)) best = { id: qid, d };
      }
    }
    if (best) {
      this.applyDamage(best.id, id, MELEE.damage, { weapon: 'melee', from: [p.state.x, p.state.z] });
      return;
    }
    if (p.member.team === 'attack') {
      for (const c of [...this.gadgets.cameras.values()]) {
        if (inFront(c.pos, MELEE.reach + 0.4) !== null) { this.gadgets.destroyCamera(c.id); return; }
      }
    }
    if (phase === PHASE.ACTION) {
      const wall = raycastWorld(this.world, origin, aim, MELEE.reach);
      if (wall?.box.kind === 'barricade') this.gadgets.damageBarricadePanel(wall.box.barricadeId, wall.box.panelIndex, BARRICADE.meleeDamage);
      else if (wall?.box.kind === 'panel') {
        // Each melee hit knocks out one wall panel. Reinforced walls shrug it off.
        if (this.world.isReinforcedPanel(wall.box.id)) this.io.to(id).emit('actionError', { msg: 'Reinforced walls can\'t be broken by melee.' });
        else this.destruction.destroy([wall.box.id]);
      }
    }
  }

  sendLoadout(id, p) {
    const ab = p.ability, cfg = OPERATORS[p.operator]?.ability;
    this.io.to(id).emit('loadout', {
      op: p.operator, charges: p.charges, placed: !!p.placedCharge,
      utility: p.utility ? { id: p.utility.id, charges: p.utility.charges } : null,
      ability: cfg ? {
        id: cfg.id, charges: ab.charges, cdLeft: Math.max(0, ab.cdUntil - Date.now()),
        deployed: !!(ab.shieldId || p.placedHeavy),
      } : null,
    });
  }

  pickSpawn(team, random = false) {
    const spawns = MAP.spawns[team];
    if (random) return spawns[Math.floor(Math.random() * spawns.length)];
    const used = [...this.players.values()].filter((p) => p.member.team === team).length;
    return spawns[used % spawns.length];
  }

  start() {
    this.lastTickTime = performance.now();
    this.timer = setInterval(() => this.update(), 1000 / TICK_RATE);
    this.rounds.start();
  }

  /** Put everyone back at their spawn with full health and a fresh map. */
  resetRound() {
    this.world.reset();
    this.destruction.reset();
    this.history.frames.length = 0;
    this.clearDrones();
    this.site = null;
    this.siteFound = false;
    this.siteVotes.clear();
    const used = { attack: 0, defense: 0 };
    for (const p of this.players.values()) {
      const team = p.member.team;
      const spawns = MAP.spawns[team];
      p.state = createPlayerState(spawns[used[team] % spawns.length]);
      if (team === 'attack') p.spawnChoice = (used[team] % MAP.spawns.attack.length) + 1;
      used[team]++;
      p.spawned = true;
      p.health = MAX_HEALTH;
      p.alive = true;
      p.queue.length = 0;
      p.timeBudget = 0;
      p.charges = team === 'attack' ? BASIC_CHARGES : 0;
      p.placedCharge = null;
      p.placedHeavy = null;
      p.spottedUntil = 0;
      p.stunUntil = 0;
      p.camView = -1;
      p.opConfirmed = false;
      if (OPERATORS[p.operator]?.team !== team) p.operator = defaultOperator(team);   // sides swapped
      this.applyOperator(p);
    }
    this.gadgets.reset();
    this.placeAttackers();
  }

  /** Put attackers at their chosen entry points, spread out where several share one. */
  placeAttackers() {
    const groups = new Map();
    for (const p of this.players.values()) {
      if (p.member.team !== 'attack') continue;
      if (!groups.has(p.spawnChoice)) groups.set(p.spawnChoice, []);
      groups.get(p.spawnChoice).push(p);
    }
    for (const [choice, list] of groups) {
      list.forEach((p, i) => {
        p.state = createPlayerState(attackSpawnPoint(choice, i, list.length));
        p.state.speedMul = speedMultiplier(OPERATORS[p.operator]);
      });
    }
  }

  /** Prep: attacker bodies vanish (so nobody can camp them); they fly drones. */
  beginPrep() {
    for (const p of this.players.values()) if (p.member.team === 'attack') p.spawned = false;
    this.spawnDrones();
  }

  /** Action: drones are recalled and attackers appear where they chose. */
  beginAction() {
    this.clearDrones();
    this.placeAttackers();
    for (const [id, p] of this.players) {
      if (p.member.team !== 'attack' || p.spawned) continue;
      p.spawned = true;
      p.queue.length = 0;
      this.io.to(id).emit('attackerSpawn', { state: p.state });
    }
  }

  setSpawnChoice(id, choice) {
    const p = this.players.get(id);
    const n = Number(choice) | 0;
    if (!p || p.member.team !== 'attack' || this.rounds.phase !== PHASE.PREP) return;
    if (n < 1 || n > MAP.spawns.attack.length) return;
    p.spawnChoice = n;
    this.io.to(id).emit('spawnChoice', { choice: n });
  }

  // ---------------------------------------------------------------- objective sites

  /** The site that counts this round (before the vote ends, the first one). */
  activeSite() {
    return MAP.sites[this.site ?? 0];
  }

  voteSite(id, index) {
    const p = this.players.get(id);
    const i = Number(index) | 0;
    if (!p || p.member.team !== 'defense' || this.rounds.phase !== PHASE.INTRO || i < 0 || i >= MAP.sites.length) return;
    this.siteVotes.set(id, i);
    this.sendSiteVotes();
  }

  siteCounts() {
    const counts = MAP.sites.map(() => 0);
    for (const v of this.siteVotes.values()) counts[v]++;
    return counts;
  }

  /** Only defenders see the vote. */
  sendSiteVotes() {
    const counts = this.siteCounts();
    for (const [id, p] of this.players) {
      if (p.member.team === 'defense') this.io.to(id).emit('siteVotes', { counts, mine: this.siteVotes.get(id) ?? null });
    }
  }

  /** Select time is over: most votes wins, ties and no votes are settled at random. Defenders are told. */
  finalizeSite() {
    const counts = this.siteCounts();
    const top = Math.max(...counts);
    const tied = counts.map((c, i) => (c === top ? i : -1)).filter((i) => i >= 0);
    this.site = tied[Math.floor(Math.random() * tied.length)];
    this.siteFound = false;
    for (const [id, p] of this.players) {
      if (p.member.team === 'defense') this.io.to(id).emit('siteChosen', { site: this.site });
    }
    this.placeDefenders();
  }

  /** Defenders start in or right next to the site they voted for, facing it. */
  placeDefenders() {
    const spawns = MAP.siteSpawns[this.site];
    let i = 0;
    for (const [id, p] of this.players) {
      if (p.member.team !== 'defense') continue;
      p.state = createPlayerState(spawns[i++ % spawns.length]);
      p.state.speedMul = speedMultiplier(OPERATORS[p.operator]);
      p.queue.length = 0;
      this.io.to(id).emit('defenderSpawn', { state: p.state });
    }
  }

  /**
   * Attackers find the objective with a drone that gets close with a clear view of
   * it, or by walking into its zone. Everyone is then told which site it is.
   */
  updateSiteReveal() {
    if (this.siteFound || this.site === null) return;
    const site = MAP.sites[this.site];
    const centre = [site.x, site.y + site.size / 2, site.z];
    let found = false;
    for (const d of this.drones.values()) {
      const owner = this.players.get(d.owner);
      if (!d.alive || owner?.activeDrone !== d.id) continue;
      const eye = droneEye(d.state);
      const v = [centre[0] - eye[0], centre[1] - eye[1], centre[2] - eye[2]];
      const dist = Math.hypot(...v);
      if (dist > 6) continue;
      const wall = raycastWorld(this.world, eye, v.map((c) => c / dist), dist);
      if (!wall || wall.t > dist - 0.6) { found = true; break; }
    }
    if (!found) {
      for (const p of this.players.values()) {
        if (p.member.team === 'attack' && p.alive && p.spawned !== false && inObjectiveZone(site, p.state)) { found = true; break; }
      }
    }
    if (!found) return;
    this.siteFound = true;
    this.emitAll('siteFound', { site: this.site });
  }

  /** Halftime: everyone changes sides. */
  swapSides() {
    for (const p of this.players.values()) p.member.team = opposite(p.member.team);
  }

  hasBothSides() {
    const sides = new Set([...this.players.values()].map((p) => p.member.team));
    return sides.has('attack') && sides.has('defense');
  }

  finishMatch() {
    this.room.endMatch();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  queueInputs(id, batch) {
    const p = this.players.get(id);
    if (!p || !Array.isArray(batch)) return;
    for (const raw of batch.slice(0, 30)) {
      const input = sanitizeInput(raw);
      if (!input || input.seq <= p.lastSeq) continue;
      if (!p.alive) { p.lastSeq = input.seq; continue; } // dead: acknowledge and drop
      if (p.queue.length >= MAX_QUEUED_INPUTS) break;
      p.queue.push(input);
    }
  }

  update() {
    const now = performance.now();
    const realDt = Math.min(0.25, (now - this.lastTickTime) / 1000);
    this.lastTickTime = now;
    this.tick++;
    const wallNow = Date.now();

    const phase = this.rounds.phase;
    for (const [id, p] of this.players) {
      if (!p.alive) continue;
      p.timeBudget = Math.min(MAX_TIME_BUDGET, p.timeBudget + realDt);
      while (p.alive && p.queue.length && p.queue[0].dt <= p.timeBudget + 1e-6) {
        const input = p.queue.shift();
        p.timeBudget -= input.dt;
        const drone = phase === PHASE.PREP ? this.activeDroneOf(p) : null;
        if (drone) {
          // Piloting a drone: inputs steer it, the operator's body stays put.
          if (!drone.jammed) stepDrone(drone.state, { ...input, keys: input.keys & DRONE_KEYS }, input.dt, this.world);
        } else {
          input.keys = maskKeys(input.keys, p.member.team, phase, p.camView >= 0);
          // Defenders can't leave the building during prep
          const solid = phase === PHASE.PREP && p.member.team === 'defense' ? this.world.barrierView : this.world;
          p.state.gunMul = gunMobility(p.weapon);
          stepPlayer(p.state, input, input.dt, solid);
          if (stepWeapon(p.weapon, weaponInput(p.state, input), input.dt)) this.fire(id, p, input, wallNow);
        }
        p.lastSeq = input.seq;
      }
    }

    this.rounds.update(wallNow, realDt);
    this.gadgets.update(realDt, wallNow);
    if ((phase === PHASE.PREP || phase === PHASE.ACTION) && this.tick % 6 === 0) this.updateSiteReveal();
    this.destruction.update(wallNow);
    this.history.record(wallNow, this.players);
    if (this.tick % Math.round(TICK_RATE / SNAPSHOT_RATE) === 0) this.broadcastSnapshot();
  }

  fire(shooterId, shooter, input, now) {
    const shot = resolveShot({
      shooterId, shooter, input, world: this.world, players: this.players, history: this.history, now,
      drones: [...this.drones.values()],      // arrays, not iterators: every pellet checks them
      cameras: [...this.gadgets.cameras.values()],
    });

    // Total damage per victim across pellets
    const damageById = new Map();
    for (const pellet of shot.pellets) {
      if (!pellet.hitId) continue;
      const entry = damageById.get(pellet.hitId) || { damage: 0, head: false };
      entry.damage += pellet.damage;
      entry.head = entry.head || pellet.head;
      damageById.set(pellet.hitId, entry);
    }

    // Others see a tracer; the shooter already drew its own predicted one.
    const shooterSocket = this.io.sockets.sockets.get(shooterId);
    const shotMsg = { id: shooterId, w: shooter.weapon.id, ends: shot.pellets.map((p) => p.end.map(round2)) };
    if (shooterSocket) shooterSocket.to(this.room.channel).emit('shot', shotMsg);
    else this.emitAll('shot', shotMsg);

    const w = shooter.weapon.id;
    for (const pellet of shot.pellets) {
      if (pellet.panelId !== null && this.rounds.phase === PHASE.ACTION) this.destruction.damagePanel(pellet.panelId, pellet.panelDamage);
    }
    for (const pellet of shot.pellets) if (pellet.cameraId) this.gadgets.destroyCamera(pellet.cameraId);
    if (this.rounds.phase === PHASE.ACTION) {
      for (const pellet of shot.pellets) {
        if (pellet.barricade) this.gadgets.damageBarricadePanel(pellet.barricade.id, pellet.barricade.index, pellet.panelDamage);
      }
    }
    const droneDamage = new Map();
    for (const pellet of shot.pellets) {
      if (pellet.droneId !== null) droneDamage.set(pellet.droneId, (droneDamage.get(pellet.droneId) || 0) + pellet.droneDamage);
    }
    for (const [droneId, amount] of droneDamage) this.damageDrone(droneId, shooterId, amount);
    for (const [victimId, { damage, head }] of damageById) {
      this.applyDamage(victimId, shooterId, damage, { head, weapon: w, from: [shot.origin[0], shot.origin[2]] });
    }
  }

  applyDamage(victimId, attackerId, amount, { head = false, weapon, from }) {
    const victim = this.players.get(victimId);
    if (!victim || !victim.alive || victim.spawned === false) return;
    const dealt = Math.max(1, Math.round(amount * damageMultiplier(OPERATORS[victim.operator])));
    victim.health = Math.max(0, victim.health - dealt);
    const killed = victim.health === 0;
    this.gadgets.exitCamera(victimId, victim);   // getting shot pulls you out of a camera feed

    if (attackerId !== victimId) this.io.to(attackerId).emit('hitConfirm', { victim: victimId, damage: dealt, head, killed });
    this.io.to(victimId).emit('damaged', {
      attacker: attackerId, damage: dealt, health: victim.health,
      from: [round2(from[0]), round2(from[1])],
    });
    if (killed) this.kill(victimId, victim, attackerId, weapon, head);
  }

  kill(victimId, victim, killerId, weaponId, head) {
    victim.alive = false;
    victim.queue.length = 0;
    this.gadgets.exitCamera(victimId, victim);
    this.gadgets.cancelBarricade(victimId, 'You were eliminated.');
    this.destruction.cancelReinforce(victimId, 'You were eliminated.');
    this.emitAll('kill', { killer: killerId, victim: victimId, weapon: weaponId, head });
    victim.deaths++;
    const killer = this.players.get(killerId);
    if (killer && killerId !== victimId) killer.kills++;
    this.emitAll('stats', this.statsPayload());
  }

  /** Kills and deaths for the whole match, shown on the Tab scoreboard. */
  statsPayload() {
    const out = {};
    for (const [id, p] of this.players) out[id] = { k: p.kills, d: p.deaths };
    return out;
  }

  broadcastSnapshot() {
    const players = [];
    for (const [id, p] of this.players) {
      const s = p.state, w = p.weapon;
      players.push({
        id, seq: p.lastSeq, alive: p.alive, u: p.spawned === false ? 1 : 0, hp: p.health, o: p.operator, slow: p.state.slow, sm: p.state.speedMul, fd: p.state.fireDelay, jc: round2(p.state.jumpCd || 0), spr: p.state.sprinting ? 1 : 0, sp: p.spottedUntil > Date.now() ? 1 : 0,
        x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz,
        yaw: s.yaw, pitch: s.pitch, crouch: s.crouch, prone: s.prone || 0, lean: s.lean, onGround: s.onGround,
        w: { id: w.id, ammo: w.ammo, reserve: w.reserve, cooldown: w.cooldown, reload: w.reload, bloom: w.bloom, trigger: w.trigger, slot: w.slot, other: w.other },
      });
    }
    const cap = { p: Math.min(1, this.rounds.capture / CAPTURE_TIME), c: this.rounds.contested };
    const drones = [];
    for (const d of this.drones.values()) {
      const s = d.state, owner = this.players.get(d.owner);
      drones.push({
        id: d.id, o: d.owner, a: owner?.activeDrone === d.id ? 1 : 0, hp: d.hp, j: d.jammed ? 1 : 0,
        x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, yaw: s.yaw, pitch: s.pitch, g: s.onGround, jc: round2(s.jumpCd || 0),
      });
    }
    this.io.to(this.room.channel).volatile.emit('snapshot', { t: Date.now(), players, cap, drones, grenades: this.gadgets.snapshotGrenades() });
  }

  /** Everything a client needs to (re)build the round. Hidden gadgets are filtered by team. */
  startPayload(team = 'attack') {
    return {
      stats: this.statsPayload(),
      // Defenders always know the site; attackers only once it has been found
      site: this.site !== null && (team === 'defense' || this.siteFound) ? this.site : null,
      siteVotes: team === 'defense' && this.rounds.phase === PHASE.INTRO ? { counts: this.siteCounts(), mine: null } : null,
      barricadesLeft: this.gadgets.barricadesLeft,
      gadgets: this.gadgets.list(team),
      picks: this.picksFor(team),
      mapName: MAP.name,
      players: [...this.players.entries()].map(([id, p]) => ({
        id, name: p.member.name, team: p.member.team, state: p.state,
        weapon: p.weapon, health: p.health, alive: p.alive,
        charges: p.charges, placed: !!p.placedCharge, spawnChoice: p.spawnChoice, operator: p.operator,
      })),
      destruction: this.destruction.snapshot(),
      round: this.rounds.info(),
    };
  }
}

const round2 = (v) => Math.round(v * 100) / 100;
const opposite = (team) => (team === 'attack' ? 'defense' : 'attack');

function sanitizeInput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seq = Number(raw.seq), dt = Number(raw.dt), yaw = Number(raw.yaw), pitch = Number(raw.pitch);
  if (!Number.isInteger(seq) || !Number.isFinite(dt) || !Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  if (dt <= 0 || dt > MAX_INPUT_DT) return null;
  const wsel = Number(raw.wsel) === 2 ? 2 : Number(raw.wsel) === 1 ? 1 : 0;
  const rt = Number(raw.rt);
  return {
    seq,
    dt,
    keys: (raw.keys | 0) & KEY_MASK,
    yaw: yaw % (Math.PI * 2),
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch)),
    wsel,      // 1 = primary, 2 = secondary
    rt: Number.isFinite(rt) ? rt : 0,
  };
}
