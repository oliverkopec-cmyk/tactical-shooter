// Authoritative simulation for one room's match.
// Clients send timestamped inputs; the server replays them through the shared
// movement and weapon code, resolves shots, and broadcasts snapshots. Input
// time is rationed against real time so a modified client can't move or fire
// faster by sending extra inputs.

import { getMap, findOpening } from '../shared/map.js';
import { createPlayerState, stepPlayer, weaponInput } from '../shared/movement.js';
import { WEAPONS, createWeaponState, stepWeapon, gunMobility, gunAimTime, shieldCover } from '../shared/weapons.js';
import { UTILITIES, ABILITY_STATS } from '../shared/utilities.js';
import { MIN_ROUNDS_TO_COUNT } from './progression.js';
import { OPERATORS, defaultOperator, operatorsFor, speedMultiplier, damageMultiplier } from '../shared/operators.js';
import { World } from '../shared/world.js';
import { maskKeys, attackSpawnPoint, inObjectiveZone, inBuilding } from '../shared/rules.js';
import {
  DRONE, DRONE_KEYS, createDroneState, stepDrone, droneEye,
} from '../shared/drone.js';
import { forwardVec, rightVec, getEyePosition } from '../shared/movement.js';
import { aimDirection } from '../shared/weapons.js';
import { raycastWorld } from '../shared/raycast.js';
import {
  SNAPSHOT_RATE, MAX_INPUT_DT, MAX_TIME_BUDGET, KEY_MASK, MAX_HEALTH, BASIC_CHARGES, PHASE, CAPTURE_TIME,
  SPOT_DURATION_MS, PING_COOLDOWN_MS, MELEE, BARRICADE, RUNOUT, KEY, INTRO_STEP, DOWNED,
} from '../shared/constants.js';
import { PoseHistory, resolveShot } from './combat.js';
import { Destruction } from './destruction.js';
import { Defuser } from './defuser.js';
import { KillcamRecorder } from './killcam.js';
import { BotBrains } from './bots.js';
import { VOICE_LINES, VOICE_COOLDOWN, PING_TYPES, PING } from '../shared/voiceLines.js';
import { RoundManager } from './rounds.js';
import { Gadgets } from './abilities.js';
import { Placing } from './placing.js';
import { SnapshotSender } from './snapshots.js';
import { DownedPlayers } from './downed.js';
import { PLACE_SLOW } from '../shared/placing.js';

const TICK_RATE = 60;
const MAX_QUEUED_INPUTS = 120;
// One batch holds every frame since the last one: about 1/7 s, so 35 frames at 240 fps
const MAX_BATCH_INPUTS = 64;
// Inputs arrive in batches about 7 times a second. They are played out at the pace they were made, so other players
// see smooth movement instead of a jump per batch. When they pile up (a batch came late), they are played a little
// faster until the backlog is gone. Neither ever plays a player faster than real time: the time budget (below) still
// decides how much may be simulated, exactly as before.
const PACE_BACKLOG = 0.16;      // seconds of queued input that count as normal (one batch, plus a little)
const PACE_CATCHUP = 2;         // extra speed per second of backlog above that
const PACE_MAX = 1.5;           // never more than this times real time
const PACE_CARRY = 0.1;         // the most pacing allowance that can build up while inputs are waiting
const MAX_PITCH = Math.PI / 2;

export class GameState {
  constructor(room) {
    this.room = room;
    this.map = getMap(room.mapId);   // the map the host chose in the lobby
    this.world = new World(this.map);
    this.destruction = new Destruction(this);
    this.mode = room.mode || 'standard';
    this.killcam = new KillcamRecorder();   // last few seconds of everyone, for the killcam
    this.snapshots = new SnapshotSender(this);   // each player's trimmed copy of the snapshot (server/snapshots.js)
    this.bots = new BotBrains(this);        // drives any bot players (server/bots.js)
    this.withBots = room.hasBots;
    this.defuser = new Defuser(this);
    this.rounds = new RoundManager(this);
    this.gadgets = new Gadgets(this);
    this.placing = new Placing(this);   // Stage 27: placing things takes time
    this.downed = new DownedPlayers(this);   // Stage Q: knocked down, bleeding out, revived
    this.players = new Map(); // id -> ServerPlayer
    this.history = new PoseHistory();
    this.drones = new Map();   // id -> { id, owner, state, hp, alive }
    this.site = null;          // index into this.map.sites, chosen by the defenders' vote
    this.siteFound = false;    // attackers learn the site only once they've found it
    this.siteVotes = new Map();// defender id -> site index
    // Which enemy players each team has seen this round (so their operator may be shown). The server
    // alone decides this; an enemy's operator and gun are not sent to a team that hasn't seen them.
    this.revealed = { attack: new Set(), defense: new Set() };
    this.rosterDirty = true;
    this.lastRoster = 0;
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
    if (this.withBots) this.bots.onEvent(event, payload);     // bots hear explosions and notice deaths
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
      // What the rewards and daily quests count; the server tallies these itself
      stats: { rounds: 0, headshots: 0, plants: 0, reinforced: 0, barricades: 0, utilities: 0, objSecs: 0 },
      operator: this.startingOperator(member),
      opConfirmed: false,     // picked on the select screen this round
      ability: null,          // { charges, cdUntil, shieldId } for the current operator
      utilityChoice: null,    // the utility picked on the select screen (kept between rounds)
      utility: null,          // { id, charges } for this round
      utilityReadyAt: 0,
      camView: -1,            // index of the camera a defender is watching, or -1
      camId: null,
      stunUntil: 0,
      downed: null,           // { until, by, progress, reviver } while knocked down
      reviving: null,         // the id of the teammate this player is reviving
      bashReadyAt: 0,
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

  /** The operator a player starts select with: the one their account equipped for this side, else the Recruit. */
  startingOperator(member) {
    const pick = member.preferred?.[member.team];
    return OPERATORS[pick]?.team === member.team && this.owns(member, pick) ? pick : defaultOperator(member.team);
  }

  /** Does this player own the operator? (Free operators are owned by everyone.) Without account data, only the free ones. */
  owns(member, opId) {
    const op = OPERATORS[opId];
    return !!op && (!op.price || (member.owned || []).includes(opId));
  }

  removePlayer(id) {
    const leaving = this.players.get(id);
    // Walking out of a match that is still going counts as a forfeit (no reward, rank points lost)
    const started = this.rounds.round > 1 || this.rounds.phase !== PHASE.INTRO;
    if (leaving && !this.settled && started && leaving.stats.rounds >= 1 && leaving.member.accountId && !this.room.hasBots) {
      this.room.progression?.forfeit(leaving.member.accountId).catch((err) => console.error('Forfeit failed:', err.message));
    }
    if (leaving) this.defuser.onGone(id, leaving);
    this.killcam.forget(id);
    this.snapshots.forget(id);
    this.bots.forget(id);   // a leaving carrier drops the defuser
    this.players.delete(id);
    this.revealed.attack.delete(id);
    this.revealed.defense.delete(id);
    this.rosterDirty = true;
    for (const d of [...this.drones.values()]) if (d.owner === id) this.drones.delete(d.id);
    this.destruction.removeChargesOf(id);
    this.placing.active.delete(id);
  }

  /** A held action's key went up: if it was placing something, that stops (Stage 27). */
  handleActionEnd(id, type) {
    this.placing.release(id, String(type));
  }

  /** Discrete actions that aren't part of the movement input stream. */
  handleAction(id, type) {
    const p = this.players.get(id);
    if (!p || p.downed) return;   // knocked down: no gadgets, no melee
    if (type === 'breach') this.destruction.useBreach(id, p);
    else if (type === 'reinforce') this.destruction.startReinforce(id, p);
    else if (type === 'droneNext') this.cycleDrone(p);
    else if (type === 'ping') this.pingFromDrone(id, p, Date.now());
    else if (type === 'ability' || type === 'utility') {
      // Speak only if it actually happened (charges, cooldown or utility count changed)
      const before = `${p.ability?.charges}|${p.ability?.cdUntil}|${p.ability?.deployed}|${p.utility?.charges}`;
      if (type === 'ability') this.gadgets.use(id, p); else this.gadgets.useUtility(id, p);
      if (before !== `${p.ability?.charges}|${p.ability?.cdUntil}|${p.ability?.deployed}|${p.utility?.charges}`) this.voice(id, p, type);
    }
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
        if (OPERATORS[p.operator]?.ability?.id === 'shockDrone') drone.zaps = ABILITY_STATS.zap.perDrone;   // Wasp's shock drones
        this.drones.set(drone.id, drone);
        if (p.activeDrone === null) p.activeDrone = drone.id;
      }
      if (OPERATORS[p.operator]?.ability?.id === 'shockDrone') { p.ability.charges = count * ABILITY_STATS.zap.perDrone; this.sendLoadout(id, p); }
    }
  }

  /** Prep is over: drones are recalled. */
  clearDrones() {
    this.drones.clear();
    for (const [id, p] of this.players) {
      p.activeDrone = null;
      if (OPERATORS[p.operator]?.ability?.id === 'shockDrone' && p.ability?.charges) { p.ability.charges = 0; this.sendLoadout(id, p); }
    }
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
    if (owner && drone.zaps > 0 && owner.ability) { owner.ability.charges = Math.max(0, owner.ability.charges - drone.zaps); this.sendLoadout(drone.owner, owner); }
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
    if (hit) this.voice(id, p, 'spot');
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

  // ---------------------------------------------------------------- voice lines and team pings

  /**
   * An operator says a line (see shared/voiceLines.js): their team hears it, from where they stand.
   * Each player waits a little between lines and longer before repeating the same kind, so it never spams.
   */
  voice(id, p, key, now = Date.now()) {
    if (!VOICE_LINES[key] || !p?.alive) return;
    p.voiceAt ||= {};
    if (now < (p.voiceAt.any || 0) || now < (p.voiceAt[key] || 0)) return;
    p.voiceAt.any = now + VOICE_COOLDOWN.any;
    p.voiceAt[key] = now + VOICE_COOLDOWN.sameKey;
    const payload = { id, key, op: p.operator, pos: [round2(p.state.x), round2(p.state.y + 1.6), round2(p.state.z)] };
    for (const [qid, q] of this.players) if (q.member.team === p.member.team) this.io.to(qid).emit('voice', payload);
  }

  /**
   * The ping key: mark where the player aims, for their team, for a few seconds. The server traces the
   * aim itself. An enemy in view under the crosshair is marked briefly for the team; a gadget or wall
   * under it is named. type: 'auto' (a quick tap) or one of the wheel's choices.
   */
  teamPing(id, type, now = Date.now()) {
    const p = this.players.get(id);
    const phase = this.rounds.phase;
    if (!p || !p.alive || !PING_TYPES[type] || (phase !== PHASE.PREP && phase !== PHASE.ACTION)) return;
    if (now < (p.teamPingAt || 0)) return;
    p.teamPingAt = now + PING.cooldownMs;
    const drone = phase === PHASE.PREP ? this.activeDroneOf(p) : null;
    if (!drone && p.spawned === false) return;
    const eye = drone ? droneEye(drone.state) : (() => { const e = getEyePosition(p.state, this.world); return [e.x, e.y, e.z]; })();
    const aim = drone ? aimDirection(drone.state.yaw, drone.state.pitch) : aimDirection(p.state.yaw, p.state.pitch);
    const wall = raycastWorld(this.world, eye, aim, PING.range);
    let dist = wall ? wall.t : PING.range;
    let enemy = null;
    // An enemy close to the aim line, in plain view
    for (const [qid, q] of this.players) {
      if (!q.alive || q.spawned === false || q.member.team === p.member.team) continue;
      for (const h of [1.55, 1.0, 0.4]) {
        const v = [q.state.x - eye[0], q.state.y + h - eye[1], q.state.z - eye[2]];
        const d = Math.hypot(...v);
        if (d > PING.range || d < 0.2) continue;
        const dir = v.map((c) => c / d);
        if (Math.acos(Math.min(1, dir[0] * aim[0] + dir[1] * aim[1] + dir[2] * aim[2])) > 0.06) continue;
        const block = raycastWorld(this.world, eye, dir, d);
        if (block && block.t < d - 0.3) continue;
        if (!enemy || d < enemy.d) enemy = { id: qid, q, d, h };
      }
    }
    let label = null, pos, enemyId = null;
    if (enemy) {
      enemy.q.spottedUntil = Math.max(enemy.q.spottedUntil || 0, now + PING.markMs);
      pos = [enemy.q.state.x, enemy.q.state.y + 1.9, enemy.q.state.z];
      label = 'Enemy';
      enemyId = enemy.id;
    } else {
      pos = eye.map((c, i) => c + aim[i] * Math.max(0, dist - 0.05));
      label = this.pingLabel(p, pos, wall);
    }
    const t = PING_TYPES[type];
    const effective = type === 'auto' && enemy ? 'enemy' : type;
    const text = type === 'auto' ? label || t.label : `${t.label}${label && label !== 'Here' ? ` · ${label}` : ''}`;
    p.pingCount = (p.pingCount || 0) + 1;
    const ping = { id: `${id}:${p.pingCount}`, from: id, by: p.member.name, type: effective, text, pos: pos.map(round2), ms: PING.ms, enemy: enemyId };
    for (const [qid, q] of this.players) if (q.member.team === p.member.team) this.io.to(qid).emit('teamPing', ping);
    this.voice(id, p, enemy ? 'pingEnemy' : PING_TYPES[effective].voice, now);
  }

  /** What a ping landed on, as the pinger's team may know it. */
  pingLabel(p, pos, wall) {
    const near = (q, r) => Math.hypot(q[0] - pos[0], q[1] - pos[1], q[2] - pos[2]) <= r;
    const g = this.gadgets;
    if (p.member.team === 'defense') for (const c of g.cameras.values()) if (near(c.pos, 0.7)) return 'Camera';   // attackers never learn of hidden cameras this way
    for (const c of g.claymores.values()) if (near(c.pos, 0.7)) return 'Claymore';
    for (const j of g.jammers.values()) if (near(j.pos, 0.8)) return 'Jammer';
    for (const s of g.shocks?.values?.() || []) if (near(s.pos, 0.8)) return 'Shock trap';
    for (const w of g.wires.values()) if (Math.hypot(w.x - pos[0], w.z - pos[2]) <= 1.2 && Math.abs(w.y - pos[1]) < 1) return 'Barbed wire';
    for (const c of this.destruction.charges.values()) if (near(c.pos, 0.6)) return 'Breach charge';
    const kind = wall?.box.kind;
    if (kind === 'shield' || String(wall?.box.id).startsWith('shield')) return 'Shield';
    if (kind === 'barricade') return 'Barricade';
    if (kind === 'panel') {
      const panel = this.world.panels[wall.box.id];
      if (panel?.hatch) return this.world.isReinforcedPanel(panel.id) ? 'Reinforced hatch' : 'Hatch';
      return this.world.isReinforcedPanel(wall.box.id) ? 'Reinforced wall' : 'Soft wall';
    }
    if (kind === 'exterior' || kind === 'hardwall') return 'Wall';
    return 'Here';
  }

  /** Give a player their operator's weapon, ratings and ability stock. */
  applyOperator(p) {
    this.rosterDirty = true;
    const op = OPERATORS[p.operator];
    p.weapon = createWeaponState(op.weapons.primary, op.weapons.secondary, p.member.attachments);
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
    if (!p || !this.canPick(p)) return;
    if (!OPERATORS[p.operator].utilities.includes(utilityId)) return;
    p.utilityChoice = utilityId;
    p.utility = { id: utilityId, charges: UTILITIES[utilityId].charges };
    this.sendLoadout(id, p);
  }

  /**
   * Picking an operator or utility: in the loadout step for everyone, and for attackers again in
   * prep until shortly before the action (Stage F).
   */
  canPick(p) {
    const r = this.rounds;
    if (r.phase === PHASE.INTRO) return r.step === INTRO_STEP.LOADOUT;
    return p.member.team === 'attack' && r.canRepick();
  }

  pickOperator(id, opId) {
    const p = this.players.get(id);
    const op = OPERATORS[opId];
    if (!p || !op) return;
    if (!this.canPick(p)) return this.gadgets.error(id, this.rounds.phase === PHASE.PREP ? 'Too late to change operator now.' : 'Operators are picked in the loadout step.');
    const repick = this.rounds.phase === PHASE.PREP;
    if (op.team !== p.member.team) return this.gadgets.error(id, 'That operator is on the other team.');
    if (!this.owns(p.member, opId)) return this.gadgets.error(id, `You don't own ${op.name} yet. Buy them in the Operators tab.`);
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
    if (repick && p.operator === opId) return;
    p.operator = opId;
    p.opConfirmed = true;
    this.applyOperator(p);
    if (repick) this.retuneDrones(id, p);
    this.sendPicks();
  }

  /** An attacker changed operator in prep: their drones become the new operator's (count, shock tasers); the ones out stay where they are. */
  retuneDrones(id, p) {
    const op = OPERATORS[p.operator], shock = op.ability?.id === 'shockDrone';
    const mine = [...this.drones.values()].filter((d) => d.owner === id && d.alive);
    const want = 1 + (op.extraDrones || 0);
    // Too many (from Hawk): the extra ones are recalled, never the one being driven
    const spare = mine.filter((d) => d.id !== p.activeDrone);
    while (mine.length > want && spare.length) { const d = spare.pop(); this.drones.delete(d.id); mine.splice(mine.indexOf(d), 1); }
    // Too few: new ones roll out next to the one being driven
    const at = this.activeDroneOf(p) || mine[0];
    for (let i = mine.length; i < want && at; i++) {
      const s = at.state;
      const drone = { id: this.nextDroneId++, owner: id, hp: DRONE.hp, alive: true, state: createDroneState(s.x + 0.4 * i, s.y, s.z + 0.4, s.yaw) };
      this.drones.set(drone.id, drone);
      mine.push(drone);
    }
    for (const d of mine) {
      if (shock) d.zaps ??= ABILITY_STATS.zap.perDrone;   // taser shots already used stay used
      else delete d.zaps;
    }
    if (shock) p.ability.charges = mine.reduce((n, d) => n + d.zaps, 0);
    if (p.activeDrone === null || !this.drones.has(p.activeDrone)) this.cycleToFirstDrone(p);
    this.sendLoadout(id, p);
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

  /**
   * Who may damage soft walls and barricades (bullets, melee, grenades): everyone in the
   * action phase, and defenders in prep so they can open sight lines before the round.
   */
  canBreakWalls(p) {
    const phase = this.rounds.phase;
    return phase === PHASE.ACTION || (phase === PHASE.PREP && p.member.team === 'defense');
  }

  /** Right click: a quick strike at whatever is right in front of you. */
  melee(id, p, now) {
    const phase = this.rounds.phase;
    if (!p.alive || p.spawned === false || p.camView >= 0 || (phase !== PHASE.PREP && phase !== PHASE.ACTION)) return;
    if (now < (p.meleeReadyAt || 0)) return;
    p.meleeReadyAt = now + MELEE.cooldown * 1000;
    // Melee with a drawn shield is a bash (Stage Q). It has its own cooldown; while that runs the shield can still
    // knock out walls and gadgets, but it doesn't do anything to people.
    const shieldUp = !!WEAPONS[p.weapon.id]?.shield && (p.state.prone || 0) < 0.5;
    const bash = shieldUp && now >= p.bashReadyAt;
    this.emitAll('melee', { id, bash: bash || undefined });

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
      return wall && wall.t < dist - 0.2 ? null : dist;   // this is also what stops a bash going through a wall
    };

    let best = null;
    for (const [qid, q] of this.players) {
      if (qid === id || !q.alive || q.spawned === false || q.member.team === p.member.team) continue;
      for (const h of q.downed ? [0.3] : [1.45, 0.95]) {
        const d = inFront([q.state.x, q.state.y + h, q.state.z], MELEE.reach + (q.downed ? 0.6 : 0.35));
        if (d !== null && (!best || d < best.d)) best = { id: qid, d };
      }
    }
    if (best && shieldUp && !bash) { this.io.to(id).emit('actionError', { msg: 'Your shield bash is recharging.' }); best = null; }
    if (bash && (best || !this.meleeThings(id, p, origin, aim, inFront))) this.startBashCooldown(id, p, now);
    if (best) {
      // A ballistic shield turned towards the swing takes it
      const q = this.players.get(best.id);
      if (shieldFaces(q, p.state.x, p.state.z)) { this.emitAll('shieldHit', { pos: [round2(q.state.x), round2(q.state.y + 1.1), round2(q.state.z)] }); return; }
      if (bash && !q.downed) this.downed.knockDown(best.id, q, id);
      else this.applyDamage(best.id, id, MELEE.damage, { weapon: 'melee', from: [p.state.x, p.state.z] });
      return;
    }
    if (!bash) this.meleeThings(id, p, origin, aim, inFront);
  }

  startBashCooldown(id, p, now) {
    p.bashReadyAt = now + DOWNED.bashCooldownMs;
    this.io.to(id).emit('bashCd', { ms: DOWNED.bashCooldownMs });
  }

  /** A swing that met nobody: cameras, claymores, barricades and soft walls. Returns whether it hit one of them. */
  meleeThings(id, p, origin, aim, inFront) {
    if (p.member.team === 'attack') {
      for (const c of [...this.gadgets.cameras.values()]) {
        if (inFront(c.pos, MELEE.reach + 0.4) !== null) { this.gadgets.destroyCamera(c.id); return true; }
      }
    }
    for (const c of [...this.gadgets.claymores.values()]) {
      if (c.team !== p.member.team && inFront(c.pos, MELEE.reach + 0.3) !== null) { this.gadgets.destroyClaymore(c.id); return true; }
    }
    if (!this.canBreakWalls(p)) return false;
    const wall = raycastWorld(this.world, origin, aim, MELEE.reach);
    // Aiming at a barricade, even where it already has a hole: the swing is judged against the opening itself
    const opening = findOpening(this.map, origin, aim, MELEE.reach);
    const barricade = opening && this.gadgets.barricadeAt(opening.id);
    const planeT = barricade ? (opening.fixed - origin[opening.axis === 'x' ? 2 : 0]) / aim[opening.axis === 'x' ? 2 : 0] : 0;
    if (barricade && (!wall || wall.box.kind === 'barricade' || wall.t >= planeT - 0.1)) {
      this.gadgets.meleeBarricade(barricade.id, origin.map((v, k) => v + aim[k] * planeT));
      return true;
    }
    if (wall?.box.kind === 'armor') { this.gadgets.hitArmor(wall.box.armorId, 'melee', id); return true; }
    if (wall?.box.kind === 'barricade') { this.gadgets.meleeBarricade(wall.box.barricadeId, wall.point); return true; }
    if (wall?.box.kind === 'panel') {
      // Each melee hit knocks out one wall panel. Reinforced walls shrug it off.
      if (this.world.isReinforcedPanel(wall.box.id)) this.io.to(id).emit('actionError', { msg: 'Reinforced walls can\'t be broken by melee.' });
      else this.destruction.destroy([wall.box.id]);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- who has seen whom

  /** Can a player on `viewerTeam` know this player's operator? (Their own team always; enemies once seen.) */
  canSee(viewerTeam, p) {
    return viewerTeam === 'spectator' || p.member.team === viewerTeam || this.revealed[viewerTeam].has(p.member.id);   // admin spectators see everything
  }

  reveal(viewerTeam, playerId) {
    const set = this.revealed[viewerTeam];
    if (set.has(playerId)) return;
    set.add(playerId);
    this.rosterDirty = true;
  }

  /**
   * An enemy is revealed to a team when one of its living players has a clear line of sight to them
   * inside their view, a defender camera sees them, or they are marked (drone ping, Hawk, Tremor, a
   * Volt trap, a Picket sensor). Run a few times a second.
   */
  updateVision(now) {
    for (const team of ['attack', 'defense']) {
      const enemies = [...this.players.values()].filter((q) => q.member.team !== team && q.alive && q.spawned !== false && !this.revealed[team].has(q.member.id));
      if (!enemies.length) continue;
      const viewers = [...this.players.values()].filter((q) => q.member.team === team && q.alive && q.spawned !== false);
      const cameras = team === 'defense' ? [...this.gadgets.cameras.values()] : [];
      for (const e of enemies) {
        let seen = e.spottedUntil > now;
        const targets = [[e.state.x, e.state.y + 1.1, e.state.z], [e.state.x, e.state.y + 1.55, e.state.z]];
        const visibleFrom = (origin, facing, maxDist, cone) => targets.some((t) => {
          const v = [t[0] - origin[0], t[1] - origin[1], t[2] - origin[2]];
          const dist = Math.hypot(...v);
          if (dist > maxDist || dist < 0.05) return false;
          const d = [v[0] / dist, v[1] / dist, v[2] / dist];
          if (d[0] * facing[0] + d[1] * facing[1] + d[2] * facing[2] < cone) return false;
          const wall = raycastWorld(this.world, origin, d, dist);
          return !wall || wall.t >= dist - 0.3;
        });
        for (let i = 0; i < viewers.length && !seen; i++) {
          const a = viewers[i];
          const eye = getEyePosition(a.state, this.world);
          seen = visibleFrom([eye.x, eye.y, eye.z], aimDirection(a.state.yaw, a.state.pitch), 70, 0.5);
        }
        for (const c of cameras) { if (!seen) seen = visibleFrom(c.pos, c.dir, 30, 0.45); }
        if (seen) this.reveal(team, e.member.id);
      }
    }
  }

  /** The operator icons list one team sees: everyone's alive state, and operators only where known. */
  rosterFor(team) {
    return [...this.players.values()].map((p) => ({
      id: p.member.id, team: p.member.team, alive: p.alive,
      dn: p.downed && (team === 'spectator' || p.member.team === team) ? 1 : undefined,   // teammates see who is downed
      op: this.canSee(team, p) ? p.operator : null,
    }));
  }

  sendRoster() {
    this.rosterDirty = false;
    this.lastRoster = Date.now();
    const lists = { attack: this.rosterFor('attack'), defense: this.rosterFor('defense') };
    for (const [id, p] of this.players) this.io.to(id).emit('roster', lists[p.member.team]);
    if (this.room.spectators.size) this.io.to(this.room.spectatorChannel).emit('roster', this.rosterFor('spectator'));
  }

  sendLoadout(id, p) {
    const ab = p.ability, cfg = OPERATORS[p.operator]?.ability;
    this.io.to(id).emit('loadout', {
      op: p.operator, charges: p.charges, placed: !!p.placedCharge,
      utility: p.utility ? { id: p.utility.id, charges: p.utility.charges } : null,
      ability: cfg ? {
        id: cfg.id, charges: ab.charges, cdLeft: Math.max(0, ab.cdUntil - Date.now()),
        deployed: !!(ab.shieldId || p.placedHeavy || ab.volley),
      } : null,
    });
  }

  pickSpawn(team, random = false) {
    const spawns = this.map.spawns[team];
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
    this.placing.clear();
    this.world.reset();
    this.destruction.reset();
    this.defuser.reset();
    this.killcam.reset();
    this.history.frames.length = 0;
    this.revealed.attack.clear();
    this.revealed.defense.clear();
    this.rosterDirty = true;
    this.clearDrones();
    this.site = null;
    this.siteFound = false;
    this.siteVotes.clear();
    const used = { attack: 0, defense: 0 };
    for (const p of this.players.values()) {
      const team = p.member.team;
      const spawns = this.map.spawns[team];
      p.state = createPlayerState(spawns[used[team] % spawns.length]);
      if (team === 'attack') p.spawnChoice = (used[team] % this.map.spawns.attack.length) + 1;
      used[team]++;
      p.spawned = true;
      p.health = MAX_HEALTH;
      p.alive = true;
      p.stats.rounds++;
      p.queue.length = 0;
      p.timeBudget = 0;
      p.charges = team === 'attack' ? BASIC_CHARGES : 0;
      p.placedCharge = null;
      p.placedHeavy = null;
      p.spottedUntil = 0;
      p.stunUntil = 0;
      p.shockUntil = 0;
      p.downed = null; p.reviving = null; p.bashReadyAt = 0;
      p.camView = -1;
      p.outT = 0; p.inT = 0; p.detected = false; p.runoutSent = '';
      p.opConfirmed = false;
      if (OPERATORS[p.operator]?.team !== team) p.operator = this.startingOperator(p.member);   // sides swapped
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
        p.state = createPlayerState(attackSpawnPoint(this.map, choice, i, list.length));
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
    // The operator each player takes into the action counts as played this match (the badges on the select screen)
    for (const p of this.players.values()) if (p.alive) (p.opsPlayed ||= new Set()).add(p.operator);
    if (this.mode === 'defuser') this.defuser.beginAction();
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
    if (!p || p.member.team !== 'attack' || (this.rounds.phase !== PHASE.PREP && this.rounds.phase !== PHASE.INTRO)) return;
    if (n < 1 || n > this.map.spawns.attack.length) return;
    p.spawnChoice = n;
    this.io.to(id).emit('spawnChoice', { choice: n });
    this.sendSpawnPicks();
  }

  /** Every attacker's spawn point, for their teammates' maps: { playerId: 1-based choice }. */
  spawnPicks() {
    const out = {};
    for (const [id, p] of this.players) if (p.member.team === 'attack') out[id] = p.spawnChoice;
    return out;
  }

  sendSpawnPicks() {
    const picks = this.spawnPicks();
    for (const [id, p] of this.players) if (p.member.team === 'attack') this.io.to(id).emit('spawnPicks', picks);
  }

  // ---------------------------------------------------------------- objective sites

  /** The site that counts this round (before the vote ends, the first one). */
  activeSite() {
    return this.map.sites[this.site ?? 0];
  }

  voteSite(id, index) {
    const p = this.players.get(id);
    const i = Number(index) | 0;
    if (!p || p.member.team !== 'defense' || this.rounds.phase !== PHASE.INTRO || this.rounds.step !== INTRO_STEP.LOCATION || i < 0 || i >= this.map.sites.length) return;
    this.siteVotes.set(id, i);
    this.sendSiteVotes();
  }

  siteCounts() {
    const counts = this.map.sites.map(() => 0);
    for (const v of this.siteVotes.values()) counts[v]++;
    return counts;
  }

  /** Only defenders see the vote: the counts, their own vote, and who voted for what (votes: { playerId: site }). */
  sendSiteVotes() {
    const counts = this.siteCounts(), votes = Object.fromEntries(this.siteVotes);
    for (const [id, p] of this.players) {
      if (p.member.team === 'defense') this.io.to(id).emit('siteVotes', { counts, mine: this.siteVotes.get(id) ?? null, votes });
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
    const spawns = this.map.siteSpawns[this.site];
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
    const site = this.map.sites[this.site];
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

  /**
   * The match is over: pay every player who was in it long enough, then send each their summary.
   * winnerSquad is 'A' or 'B'. Called once, from the round manager.
   */
  settleMatch(winnerSquad) {
    if (this.settled) return;
    this.settled = true;
    const progression = this.room.progression;
    if (!progression) return;
    const scores = this.rounds.squadScores;
    for (const [id, p] of this.players) {
      const accountId = p.member.accountId;
      if (!accountId) continue;
      if (p.stats.rounds < MIN_ROUNDS_TO_COUNT) {
        this.io.to(id).emit('matchSummary', { none: true, reason: 'You joined too late for this match to count towards rewards or rank.' });
        continue;
      }
      const squad = p.member.squad, other = squad === 'A' ? 'B' : 'A';
      const match = {
        won: squad === winnerSquad, rounds: p.stats.rounds, roundsWon: Math.min(scores[squad], p.stats.rounds),
        kills: p.kills, deaths: p.deaths, headshots: p.stats.headshots, plants: p.stats.plants, reinforced: p.stats.reinforced,
        barricades: p.stats.barricades, utilities: p.stats.utilities, objSecs: p.stats.objSecs,
        score: { yours: scores[squad], theirs: scores[other] },
        operators: [...(p.opsPlayed || [])],
        withBots: this.room.hasBots,          // bots in the match: half Money, no rank points
        withAdmins: [...this.room.matchPlayers.values()].some((m) => m.admin),   // an admin played in it: no win bonus
      };
      progression.settle(accountId, match)
        .then((summary) => { if (summary) this.io.to(id).emit('matchSummary', summary); })
        .catch((err) => console.error('Match payout failed:', err.message));
    }
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
    for (const raw of batch.slice(0, MAX_BATCH_INPUTS)) {
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
    if (this.withBots) this.bots.update(wallNow, realDt);   // bots write their inputs first, then everyone is simulated alike
    for (const [id, p] of this.players) {
      if (!p.alive) continue;
      p.timeBudget = Math.min(MAX_TIME_BUDGET, p.timeBudget + realDt);
      let queued = 0;
      for (const q of p.queue) queued += q.dt;
      const pace = Math.min(PACE_MAX, 1 + Math.max(0, queued - PACE_BACKLOG) * PACE_CATCHUP);
      p.paceAllow = Math.min(PACE_CARRY, (p.paceAllow || 0) + realDt * pace);
      while (p.alive && p.queue.length && p.queue[0].dt <= Math.min(p.timeBudget, p.paceAllow) + 1e-6) {
        const input = p.queue.shift();
        p.timeBudget -= input.dt;
        p.paceAllow -= input.dt;
        const drone = phase === PHASE.PREP ? this.activeDroneOf(p) : null;
        if (drone) {
          // Piloting a drone: inputs steer it, the operator's body stays put.
          if (!drone.jammed) stepDrone(drone.state, { ...input, keys: input.keys & DRONE_KEYS }, input.dt, this.world.droneView);
        } else {
          input.keys = maskKeys(input.keys, p.member.team, phase, p.camView >= 0);
          if (p.placing) input.keys &= ~KEY.FIRE;   // placing something: hands full, no shooting
          if (input.keys & KEY.INTERACT && !p.downed) p.interactAt = wallNow;
          // Defenders can't leave the building during prep
          const solid = phase === PHASE.PREP && p.member.team === 'defense' ? this.world.barrierView : this.world;
          p.state.gunMul = gunMobility(p.weapon);
          p.state.aimMul = gunAimTime(p.weapon, p.member.attachments);
          stepPlayer(p.state, input, input.dt, solid);
          if (p.state.swing >= 0) this.onSwingIn(id, p);
          const wasReloading = p.weapon.reload > 0;
          if (stepWeapon(p.weapon, weaponInput(p.state, input), input.dt, p.member.attachments)) this.fire(id, p, input, wallNow);
          if (!wasReloading && p.weapon.reload > 0) this.voice(id, p, 'reload', wallNow);
        }
        p.lastSeq = input.seq;
      }
      if (!p.queue.length) p.paceAllow = Math.min(p.paceAllow, realDt);   // waiting for the next batch: no saving up
    }

    this.placing.update(wallNow);
    this.downed.update(wallNow, realDt, phase);
    this.rounds.update(wallNow, realDt);
    this.updateRunOut(realDt, phase);
    this.gadgets.update(realDt, wallNow);
    if ((phase === PHASE.PREP || phase === PHASE.ACTION) && this.tick % 6 === 0) this.updateSiteReveal();
    this.destruction.update(wallNow);
    this.history.record(wallNow, this.players);
    this.killcam.record(wallNow, this.players);
    if (this.tick % 12 === 0 && (phase === PHASE.PREP || phase === PHASE.ACTION)) this.updateVision(wallNow);
    if (this.rosterDirty && wallNow - this.lastRoster >= 100) this.sendRoster();
    if (this.tick % Math.round(TICK_RATE / SNAPSHOT_RATE) === 0) this.broadcastSnapshot();
  }

  /** A rappelling player swung in through a window or door: its barricade breaks, and everyone hears it. */
  onSwingIn(id, p) {
    const opening = p.state.swing;
    p.state.swing = -1;
    this.gadgets.breakOpeningBarricade(opening);
    this.emitAll('swingIn', { id, pos: [p.state.x, p.state.y + 1, p.state.z] });
  }

  /**
   * Defenders who stay outside the building too long are detected. Action phase only. Leaving starts a
   * countdown (RUNOUT.countdownS seconds of being outside); at zero the defender is detected, which shows them
   * to every attacker through walls. Staying inside for RUNOUT.graceS seconds resets it all.
   */
  updateRunOut(dt, phase) {
    for (const [id, p] of this.players) {
      if (p.member.team !== 'defense') continue;
      const active = phase === PHASE.ACTION && p.alive && p.spawned !== false;
      if (!active) {
        if (p.outT || p.detected) { p.outT = 0; p.inT = 0; p.detected = false; this.sendRunOut(id, p, true); }
        continue;
      }
      if (inBuilding(this.map, p.state.x, p.state.z)) {
        p.inT = (p.inT || 0) + dt;
        if (p.inT >= RUNOUT.graceS && (p.outT > 0 || p.detected)) { p.outT = 0; p.detected = false; }
      } else {
        p.inT = 0;
        p.outT = Math.min(RUNOUT.countdownS, (p.outT || 0) + dt);
        if (p.outT >= RUNOUT.countdownS) p.detected = true;
      }
      this.sendRunOut(id, p);
    }
  }

  /** Tell a defender about their countdown (only when it changes: once per displayed number). */
  sendRunOut(id, p, force = false) {
    const left = p.outT > 0 && !p.detected ? Math.ceil(RUNOUT.countdownS - p.outT) : null;
    const key = `${left}|${p.detected ? 1 : 0}`;
    if (!force && key === p.runoutSent) return;
    p.runoutSent = key;
    this.io.to(id).emit('runout', { left, detected: !!p.detected });
    this.rosterDirty = true;
  }

  fire(shooterId, shooter, input, now) {
    const shot = resolveShot({
      shooterId, shooter, input, world: this.world, players: this.players, history: this.history, now,
      drones: [...this.drones.values()],      // arrays, not iterators: every pellet checks them
      cameras: [...this.gadgets.cameras.values()],
      claymores: [...this.gadgets.claymores.values()],
      jammers: [...this.gadgets.jammers.values()],
      gadgets: this.gadgets.shootable(),
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
    // The gun is named only to teams that know who the shooter is (otherwise it would give the operator away)
    const ends = shot.pellets.map((p) => p.end.map(round2));
    this.killcam.shot(shooterId, now, ends);
    if (this.withBots) this.bots.onShot(shooterId, shooter);
    for (const [pid, q] of this.players) {
      if (pid === shooterId) continue;
      this.io.to(pid).emit('shot', { id: shooterId, w: this.canSee(q.member.team, shooter) ? shooter.weapon.id : null, ends });
    }

    const w = shooter.weapon.id;
    const breaksWalls = this.canBreakWalls(shooter);
    for (const pellet of shot.pellets) {
      if (pellet.panelId !== null && breaksWalls) this.destruction.damagePanel(pellet.panelId, pellet.panelDamage);
    }
    for (const pellet of shot.pellets) if (pellet.cameraId) this.gadgets.destroyCamera(pellet.cameraId);
    for (const pellet of shot.pellets) if (pellet.claymoreId) this.gadgets.destroyClaymore(pellet.claymoreId);
    for (const pellet of shot.pellets) if (pellet.gadget) this.gadgets.destroyGadget(pellet.gadget.kind, pellet.gadget.id);
    // Bullets that hit a ballistic shield spark off it (one spark burst per shot)
    const blocked = shot.pellets.find((pl) => pl.shield);
    if (blocked) this.emitAll('shieldHit', { pos: blocked.end.map(round2) });
    // A jammer takes one hit per shot (a shotgun's pellets count once)
    for (const jid of new Set(shot.pellets.map((p) => p.jammerId).filter((j) => j !== null))) this.gadgets.hitJammer(jid);
    // Barricades break like soft walls: defenders may already open them from inside during prep
    if (breaksWalls) {
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

  applyDamage(victimId, attackerId, amount, { head = false, weapon, from, lethal = false }) {
    const victim = this.players.get(victimId);
    if (!victim || !victim.alive || victim.spawned === false) return;
    const dealt = lethal ? victim.health : Math.max(1, Math.round(amount * damageMultiplier(OPERATORS[victim.operator])));   // lethal: kills outright, armour or not
    victim.health = Math.max(0, victim.health - dealt);
    if (this.withBots && victim.member.bot) this.bots.onHurt(victimId, attackerId);
    const killed = victim.health === 0;
    if (!killed) this.placing.cancel(victimId, 'You were hit.');   // getting hurt stops a placement
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
    victim.downed = null; victim.state.downed = 0;
    this.reveal(opposite(victim.member.team), victimId);   // a kill shows the other team who it was
    this.rosterDirty = true;
    victim.queue.length = 0;
    this.gadgets.exitCamera(victimId, victim);
    this.placing.cancel(victimId);
    this.defuser.onGone(victimId, victim);
    this.emitAll('kill', { killer: killerId, victim: victimId, weapon: weaponId, head });
    // Then the victim gets a replay of the last seconds from the killer's eyes (after the kill, so their client knows they died)
    const killerP = this.players.get(killerId);
    if (killerP && killerId !== victimId && weaponId !== 'bleedout') this.io.to(victimId).emit('killcam', this.killcam.build(Date.now(), killerId, killerP, victimId, victim));
    victim.deaths++;
    const killer = this.players.get(killerId);
    if (killer && killerId !== victimId) {
      killer.kills++;
      if (killer.member.team !== victim.member.team) this.voice(killerId, killer, 'kill');
      if (head) killer.stats.headshots++;
    }
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
        // vaulting and rappelling: sent only while they matter (the client needs them to predict and to animate)
        vt: s.vaultT > 0 ? [round2(s.vaultT), round2(s.vax), round2(s.vay), round2(s.vaz), round2(s.vbx), round2(s.vby), round2(s.vbz), round2(s.vtop)] : undefined,
        rk: s.rap || s.rapPrev || s.rapCd > 0 || s.rapFlip > 0 ? [s.rap, round2(s.rapSide), round2(s.rapFlip), s.rapPrev, round2(s.rapCd)] : undefined,
        ad: s.ads > 0 ? Math.round(s.ads * 1000) / 1000 : undefined,   // aiming down sights
        ds: s.dash > 0 ? [round2(s.dash), round2(s.dashX), round2(s.dashZ)] : undefined,   // Aegis's shield charge
        sh: shieldCover(w, s) || undefined,   // what a ballistic shield covers (shown even before the operator is known)
        pl: p.placing || undefined,   // placing something: 1 kneeling at the floor, 2 reaching forward (Stage 27)
        det: p.detected ? 1 : undefined,
        // knocked down: seconds left to bleed out, how far a revive has got (0 to 1), who is doing it (Stage Q)
        dn: p.downed ? Math.max(0.1, round2((p.downed.until - Date.now()) / 1000)) : undefined,
        rv: p.downed?.reviver ? round2(p.downed.progress / DOWNED.reviveMs) : undefined,
        rb: p.downed?.reviver || undefined,
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
    // Each team may only know what it has seen: an enemy's operator and gun are left out until then, and detected
    // defenders are marked for the attackers only. Each player, and each member of staff watching, then gets their
    // own trimmed copy with only what changed (server/snapshots.js).
    const t = Date.now(), grenades = this.gadgets.snapshotGrenades();
    const viewFor = (team, e) => {   // ('spectator' sees everything)
      const q = this.players.get(e.id);
      let shown = this.canSee(team, q) ? e : { ...e, o: undefined, w: undefined };
      if (e.dn && team !== 'spectator' && q.member.team !== team) shown = { ...shown, dn: 1, rv: undefined, rb: undefined };   // the other side sees them on the floor, not how long they have
      return team !== 'defense' || !e.det ? shown : { ...shown, det: undefined };
    };
    const tops = {};
    const topsFor = (team) => (tops[team] ||= { cap, df: this.mode === 'defuser' ? this.defuser.view(team, t) : undefined, drones, grenades });   // team may be 'spectator'
    this.snapshots.send(t, players, viewFor, topsFor);
  }

  /** Everything a client needs to (re)build the round. Hidden gadgets are filtered by team. */
  startPayload(team = 'attack') {
    return {
      stats: this.statsPayload(),
      // Defenders always know the site; attackers only once it has been found
      site: this.site !== null && (team === 'defense' || team === 'spectator' || this.siteFound) ? this.site : null,
      siteVotes: team === 'defense' && this.rounds.phase === PHASE.INTRO ? { counts: this.siteCounts(), mine: null, votes: Object.fromEntries(this.siteVotes) } : null,
      spawnPicks: team === 'attack' ? this.spawnPicks() : null,
      barricadesLeft: this.gadgets.barricadesLeft,
      gadgets: this.gadgets.list(team),
      picks: this.picksFor(team),
      mapId: this.map.id, mapName: this.map.name,
      mode: this.mode,
      defuser: this.mode === 'defuser' ? this.defuser.view(team) : null,
      players: [...this.players.entries()].map(([id, p]) => ({
        id, name: p.member.name, owner: !!p.member.owner, tester: !!p.member.tester, bot: !!p.member.bot, team: p.member.team, skins: p.member.skins || {}, charms: p.member.charms || {}, attachments: p.member.attachments || {}, owned: p.member.owned || [], opMatches: p.member.opMatches || {}, state: p.state,
        weapon: this.canSee(team, p) ? p.weapon : null, health: p.health, alive: p.alive,
        charges: p.charges, placed: !!p.placedCharge, spawnChoice: p.spawnChoice, operator: this.canSee(team, p) ? p.operator : null,
      })),
      roster: this.rosterFor(team),
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

/** Is this player's ballistic shield between them and the point (x, z)? A drawn one covers 60° either side of where they face, one held to the side only the left of that. */
function shieldFaces(q, x, z) {
  const cover = shieldCover(q.weapon, q.state);
  if (!cover) return false;
  const [fx, fz] = forwardVec(q.state.yaw), [rx, rz] = rightVec(q.state.yaw);
  const dx = x - q.state.x, dz = z - q.state.z, d = Math.hypot(dx, dz) || 1;
  const ahead = (dx * fx + dz * fz) / d > 0.5;
  return cover === 1 ? ahead : ahead && dx * rx + dz * rz < 0;
}
