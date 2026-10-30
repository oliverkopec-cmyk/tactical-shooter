// Server-side bots. A bot is a room member with no connection: each tick its "brain" writes one input
// (keys, yaw, pitch) into the same queue a real player's inputs go into, so bots move, shoot and
// collide by exactly the same rules as everyone else. Discrete things (reinforce, barricade, breach,
// utility, ability, melee, voting, operator pick) go through the same handlers real players use.
//
// How a brain works:
//   - It THINKS about 10 times a second: what it can see (field of view and a clear line), what it can
//     hear (footsteps, shots, explosions, drones), what its team knows (shared contacts), and what to do.
//   - It STEERS every tick: where to look (a smooth, spring-like aim that settles onto the target, never a
//     snap), which way to walk (it can walk one way while looking another, so it pre-aims corners), and
//     when to pull the trigger (bursts at range, keeping its spread down).
//   - Each team shares contacts: what one bot sees or hears, its teammates know (and move to help).
// Movement uses the shared walking grid in server/nav.js. Difficulty sets reaction time, aim settling,
// head aim, turn speed and hearing; Normal and Hard share the same movement and tactics.

import { PHASE, KEY, MAX_INPUT_DT } from '../shared/constants.js';
import { OPERATORS, operatorsFor } from '../shared/operators.js';
import { WEAPONS, aimDirection } from '../shared/weapons.js';
import { getEyePosition, findRope, eyeHeight, bodyHeight } from '../shared/movement.js';
import { raycastWorld } from '../shared/raycast.js';
import { inObjectiveZone } from '../shared/rules.js';
import { droneEye } from '../shared/drone.js';
import { navFor } from './nav.js';


export const BOT_DIFFICULTIES = {
  //          reaction (ms)   aim error (rad) start -> rest, settle (ms)   spring  max turn  head  hearing  field of view
  easy: { label: 'Easy', react: [750, 1100], aimStart: 0.16, aimRest: 0.035, settleMs: 750, spring: 7, turn: 4, head: 0, hear: 0.6, fov: 1.75, suppressMs: 0, wallbang: false, tactics: false, utility: 0.3, bloomCap: 0.7 },
  normal: { label: 'Normal', react: [450, 600], aimStart: 0.11, aimRest: 0.014, settleMs: 450, spring: 12, turn: 7.5, head: 0.3, hear: 1, fov: 2.1, suppressMs: 600, wallbang: true, tactics: true, utility: 0.7, bloomCap: 0.45 },
  hard: { label: 'Hard', react: [200, 300], aimStart: 0.07, aimRest: 0.004, settleMs: 230, spring: 19, turn: 12, head: 0.85, hear: 1.25, fov: 2.45, suppressMs: 900, wallbang: true, tactics: true, utility: 1, bloomCap: 0.25 },
};

const THINK_MS = 100;
const SIGHT = 75;
const CONTACT_MS = 7000;            // how long the team remembers where an enemy was
const DRONE_CONTACT_MS = 45000;     // ...and what a drone saw in prep
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);            // yaw 0 looks down -z
const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const key3 = (p) => `pt:${p.map((v) => v.toFixed(1)).join(',')}`;

export class BotBrains {
  constructor(game) {
    this.game = game;
    this.brains = new Map();     // player id -> brain state
    this.intel = { attack: this.freshIntel(), defense: this.freshIntel() };
    this.noises = [];            // recent loud things: { pos, t, radius, team }
  }

  freshIntel() { return { contacts: new Map(), staged: new Set(), push: false, firstStaged: 0, breached: false }; }
  get nav() { return navFor(this.game.map); }

  brain(id, p) {
    let b = this.brains.get(id);
    if (!b) {
      b = { id, diff: BOT_DIFFICULTIES[p.member.bot] || BOT_DIFFICULTIES.normal, seq: 0, round: -1, yaw: p.state.yaw, pitch: 0, yawVel: 0, pitchVel: 0 };
      this.brains.set(id, b);
    }
    return b;
  }

  forget(id) { this.brains.delete(id); }

  // ---------------------------------------------------------------- events from the game (sounds, deaths, hits)

  /** Something loud happened somewhere: anyone in earshot on the other side hears it. */
  noise(pos, radius, team, kind) {
    this.noises.push({ pos, t: Date.now(), radius, team, kind });
    if (this.noises.length > 40) this.noises.shift();
  }

  onShot(shooterId, shooter) {
    const s = shooter.state;
    this.noise([s.x, s.y + 1.4, s.z], 55, shooter.member.team, 'shot');
  }

  /** Everything broadcast to the room passes through here: explosions, breaches and deaths matter to bots. */
  onEvent(event, payload) {
    const g = this.game;
    if (event === 'chargeExploded' || event === 'grenadeExploded' || event === 'claymoreBlast') this.noise(payload.pos, 50, null, 'boom');
    else if (event === 'barricadeBroken' || event === 'panelsDestroyed') {
      const first = payload.pos || (payload.ids && g.world.panels[payload.ids[0]]?.center);
      if (first) this.noise(first, 30, null, 'break');
    } else if (event === 'kill') {
      const victim = g.players.get(payload.victim), killer = g.players.get(payload.killer);
      // A teammate went down: everyone on their side now knows where the killer is (and is ready to trade)
      if (victim && killer && payload.killer !== payload.victim) {
        const ks = killer.state;
        this.contact(victim.member.team, payload.killer, [ks.x, ks.y, ks.z], false, 4000);
        for (const [id, b] of this.brains) {
          const q = g.players.get(id);
          if (q?.alive && q.member.team === victim.member.team && dist2([q.state.x, 0, q.state.z], [ks.x, 0, ks.z]) < 30) {
            b.alert = { pos: [ks.x, ks.y + 1.4, ks.z], t: Date.now(), trade: true };
          }
        }
      }
      if (this.brains.has(payload.killer)) this.brains.get(payload.killer).relocate = Date.now();   // move after a kill
    }
  }

  /** A bot was hit: it now knows roughly where from, and will look for cover. */
  onHurt(victimId, attackerId) {
    const b = this.brains.get(victimId);
    const a = this.game.players.get(attackerId);
    if (!b || !a || attackerId === victimId) return;
    b.hurtAt = Date.now();
    b.alert = { pos: [a.state.x, a.state.y + 1.4, a.state.z], t: Date.now(), trade: true };
    this.contact(this.game.players.get(victimId)?.member.team, attackerId, [a.state.x, a.state.y, a.state.z], false, 3000);
  }

  /** Record where an enemy is (or was) for a whole team. */
  contact(team, enemyId, pos, seen, ttl = CONTACT_MS) {
    if (!team) return;
    const c = this.intel[team].contacts.get(enemyId);
    const now = Date.now();
    if (c && c.seen && !seen && now - c.t < 800) return;        // a sighting beats a sound
    this.intel[team].contacts.set(enemyId, { pos, t: now, seen, until: now + ttl });
  }

  /** The freshest contacts a team has, nearest first. */
  contactsFor(team, from) {
    const now = Date.now(), out = [];
    for (const [id, c] of this.intel[team].contacts) {
      if (now > c.until) { this.intel[team].contacts.delete(id); continue; }
      const q = this.game.players.get(id);
      if (!q?.alive) { this.intel[team].contacts.delete(id); continue; }
      out.push({ id, ...c, d: from ? dist2(from, c.pos) : 0 });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  // ---------------------------------------------------------------- every tick

  /** Called at the start of every server tick, before inputs are processed. */
  update(now, dt) {
    const g = this.game;
    for (const [id, p] of g.players) {
      if (!p.member.bot) continue;
      const b = this.brain(id, p);
      if (b.round !== g.rounds.round) this.newRound(b, p);
      if (g.rounds.phase === PHASE.INTRO) { this.intro(b, id, p, now); continue; }
      if (!p.alive) continue;
      if (now >= (b.nextThink || 0)) { b.nextThink = now + THINK_MS; this.think(b, id, p, now); }
      const keys = this.steer(b, id, p, now, dt);
      // One input per tick (split if the tick was long), exactly like a client would send. rt = now: a bot has no
      // network delay, so its shots are checked against where players are now (not rewound into the past).
      let left = Math.min(dt, 0.25);
      while (left > 1e-4 && p.queue.length < 20) {
        const step = Math.min(left, MAX_INPUT_DT);
        left -= step;
        p.queue.push({ seq: ++b.seq, dt: step, keys, yaw: b.yaw, pitch: b.pitch, wsel: 0, rt: now });
        b.keysOnce = 0;
      }
    }
  }

  newRound(b, p) {
    if (this.lastRound !== this.game.rounds.round) {
      this.lastRound = this.game.rounds.round;
      this.intel = { attack: this.freshIntel(), defense: this.freshIntel() };
      this.noises = [];
    }
    Object.assign(b, {
      round: this.game.rounds.round, tasks: null, target: null, reactAt: 0, voted: false, utilPicked: false,
      plan: null, rp: null, explore: null, spot: null, entrance: null, stuckT: 0, unstuck: 0, trail: [],
      fireUntil: 0, shotsLeft: 0, nextAbility: Date.now() + rand(12000, 25000), spawnPicked: false, keysOnce: 0,
      droneSite: null, alert: null, lastSeen: 0, lastSeenPos: null, cover: null, relocate: 0, hurtAt: 0,
      staged: false, flashed: false, threw: 0, breach: null, strafeUntil: 0, strafeKey: 0, crouchUntil: 0, wallbangUntil: 0,
      direct: null, look: null, goal: null, way: null, hold: false, smoked: false,
    });
    b.yaw = p.state.yaw; b.pitch = 0; b.yawVel = 0; b.pitchVel = 0;
  }

  // ---------------------------------------------------------------- operator select

  intro(b, id, p, now) {
    const g = this.game;
    if (!p.opConfirmed && now >= (b.nextPick || 0)) {
      b.nextPick = now + 600;
      const taken = new Set(Object.entries(g.picksFor(p.member.team)).filter(([pid, x]) => pid !== id && x.confirmed).map(([, x]) => x.op));
      const choices = operatorsFor(p.member.team).filter((o) => !taken.has(o.id));
      if (choices.length) g.pickOperator(id, pick(choices).id);
    }
    // A sensible utility: attackers want flashes and grenades, defenders claymores
    if (p.opConfirmed && !b.utilPicked) {
      b.utilPicked = true;
      const order = p.member.team === 'attack' ? ['flash', 'frag', 'impact', 'smoke', 'claymore'] : ['claymore', 'frag', 'impact', 'flash', 'smoke'];
      const own = OPERATORS[p.operator]?.utilities || [];
      const best = order.find((u) => own.includes(u));
      if (best) g.pickUtility(id, best);
    }
    if (p.member.team === 'defense' && !b.voted) { b.voted = true; g.voteSite(id, Math.floor(Math.random() * g.map.sites.length)); }
  }

  // ---------------------------------------------------------------- thinking (10 times a second)

  think(b, id, p, now) {
    const g = this.game, team = p.member.team, phase = g.rounds.phase;
    const eye = getEyePosition(p.state, g.world);
    const origin = [eye.x, eye.y, eye.z];
    b.eye = origin;
    const blind = (p.blindUntil || 0) > now || (p.stunUntil || 0) > now;

    // ---- seeing
    let best = null;
    if (!blind && p.spawned !== false) {
      for (const [qid, q] of g.players) {
        if (q.member.team === team || !q.alive || q.spawned === false) continue;
        const qs = q.state;
        const head = [qs.x, qs.y + eyeHeight(qs.crouch, qs.prone || 0), qs.z];
        const v = head.map((c, i) => c - origin[i]);
        const dist = Math.hypot(...v);
        if (dist > SIGHT) continue;
        const ang = Math.abs(wrap(yawTo(v[0], v[2]) - b.yaw));
        if (ang > b.diff.fov / 2 && dist > 3) continue;
        // Visible if the head or the chest has a clear line
        let clear = false;
        for (const y of [head[1], qs.y + bodyHeight(qs.crouch, qs.prone || 0) * 0.55]) {
          const w = [qs.x - origin[0], y - origin[1], qs.z - origin[2]];
          const d = Math.hypot(...w);
          const hit = raycastWorld(g.world, origin, w.map((c) => c / d), d);
          if (!hit || hit.t >= d - 0.3) { clear = true; break; }
        }
        if (!clear) continue;
        this.contact(team, qid, [qs.x, qs.y, qs.z], true);
        if (!best || dist < best.dist) best = { id: qid, dist, drone: false };
      }
      // Defenders also shoot drones they can see close by
      if (!best && team === 'defense') {
        for (const d of g.drones.values()) {
          const e = droneEye(d.state);
          const v = [e[0] - origin[0], e[1] - 0.1 - origin[1], e[2] - origin[2]];
          const dist = Math.hypot(...v);
          if (dist > 22) continue;
          if (Math.abs(wrap(yawTo(v[0], v[2]) - b.yaw)) > b.diff.fov / 2) continue;
          const hit = raycastWorld(g.world, origin, v.map((c) => c / dist), dist);
          if (!hit || hit.t >= dist - 0.2) { best = { id: d.id, dist, drone: true }; break; }
        }
      }
    }
    if (best) {
      if (!b.target || b.target.id !== best.id) {
        // Reaction time; quicker if we were already looking that way (a pre-aimed angle, a teammate's call)
        const pre = b.alert && now - b.alert.t < 4000 ? 0.65 : 1;
        b.reactAt = now + rand(...b.diff.react) * pre;
        b.acquired = now;
        const a = Math.random() * Math.PI * 2;
        b.errDir = [Math.cos(a), Math.sin(a) * 0.6];
      }
      b.target = best;
      b.lastSeen = now;
      b.lastSeenPos = this.targetPos(best);
    } else if (b.target && now - b.lastSeen > 250) b.target = null;

    // ---- hearing: enemy footsteps nearby, recent shots and explosions
    if (!b.target) {
      let heard = null;
      for (const [qid, q] of g.players) {
        if (q.member.team === team || !q.alive || q.spawned === false) continue;
        const qs = q.state, speed = Math.hypot(qs.vx, qs.vz);
        if (speed < 1) continue;
        const range = (qs.sprinting ? 38 : qs.crouch > 0.5 || qs.prone > 0.5 ? 3 : 13) * b.diff.hear;
        const d = Math.hypot(qs.x - origin[0], qs.y - origin[1], qs.z - origin[2]);
        if (d > range) continue;
        const fuzz = d * 0.08;
        const pos = [qs.x + rand(-fuzz, fuzz), qs.y, qs.z + rand(-fuzz, fuzz)];
        this.contact(team, qid, pos, false, 3500);
        if (!heard || d < heard.d) heard = { pos: [pos[0], pos[1] + 1.4, pos[2]], d, steps: true, id: qid };
      }
      for (const n of this.noises) {
        if (now - n.t > 1500 || n.team === team) continue;
        const d = Math.hypot(n.pos[0] - origin[0], n.pos[1] - origin[1], n.pos[2] - origin[2]);
        if (d < n.radius * b.diff.hear && (!heard || d < heard.d)) heard = { pos: n.pos, d };
      }
      // Defenders hear drones driving about
      if (team === 'defense') {
        for (const d of g.drones.values()) {
          const dd = Math.hypot(d.state.x - origin[0], d.state.y - origin[1], d.state.z - origin[2]);
          if (dd < 10 * b.diff.hear && (!heard || dd < heard.d)) heard = { pos: [d.state.x, d.state.y + 0.2, d.state.z], d: dd };
        }
      }
      if (heard && (!b.alert || now - b.alert.t > 600 || heard.d < (b.alert.d ?? 99))) b.alert = { pos: heard.pos, t: now, d: heard.d, steps: heard.steps, id: heard.id };
    }
    if (b.alert && now - b.alert.t > 5000) b.alert = null;

    // ---- health, ammo and cover
    const w = WEAPONS[p.weapon.id];
    const lowAmmo = p.weapon.ammo === 0 || (p.weapon.ammo < Math.max(2, w.magSize * 0.25) && !b.target);
    const hurt = p.health < 35 || now - b.hurtAt < 600;
    if (b.diff.tactics && phase === PHASE.ACTION && !b.hold && !p.state.rap && (lowAmmo || (hurt && !b.target) || b.relocate > now - 300)) {
      if (!b.cover || now > b.cover.until) {
        const threat = b.lastSeenPos || b.alert?.pos || this.contactsFor(team, origin)[0]?.pos;
        const spot = threat ? this.findCover(p, threat, b.relocate > now - 300 ? 5 : 4) : null;
        if (spot) b.cover = { pos: spot, until: now + (lowAmmo ? 3500 : 2500), reload: lowAmmo };
        b.relocate = 0;
      }
    }
    if (b.cover && (now > b.cover.until || (b.cover.reload && p.weapon.reload <= 0 && p.weapon.ammo > w.magSize * 0.6 && now > b.cover.until - 1500))) b.cover = null;

    // ---- utility, ability, melee
    if (phase === PHASE.ACTION && !blind) this.useGadgets(b, id, p, now);
    if (b.target && !b.target.drone && b.target.dist < 1.6 && now > b.reactAt) g.handleAction(id, 'melee');

    // ---- a barricade in the way: smash it
    if (phase === PHASE.ACTION && !b.target && (b.wantMove || b.stuckT > 0.3) && !p.state.rap && now > (b.nextMelee || 0)) {
      const ahead = raycastWorld(g.world, [origin[0], origin[1] - 0.5, origin[2]], aimDirection(b.moveYaw ?? b.yaw, 0), 1.4);
      if (ahead?.box.kind === 'barricade') { b.nextMelee = now + 850; b.faceFor = { yaw: b.moveYaw ?? b.yaw, until: now + 900 }; g.handleAction(id, 'melee'); }
    }
    // ---- progress check over the last second: stuck -> hop (vaults low things), then sidestep
    const pos = [p.state.x, p.state.z];
    b.trail = (b.trail || []).concat([[now, ...pos]]).filter((e) => now - e[0] < 1300);
    const first = b.trail[0];
    b.stuckT = b.wantMove && now - first[0] > 1000 && Math.hypot(pos[0] - first[1], pos[1] - first[2]) < 0.5 ? b.stuckT + THINK_MS / 1000 : 0;

    // ---- what to do this phase
    b.hold = false; b.direct = b.rp?.stage === 'roof' ? b.direct : null;
    if (phase === PHASE.PREP) {
      if (team === 'attack') this.prepAttacker(b, id, p, now);
      else this.prepDefender(b, id, p, now);
    } else if (phase === PHASE.ACTION) {
      if (b.cover) b.goal = { key: key3(b.cover.pos), x: b.cover.pos[0], y: b.cover.pos[1], z: b.cover.pos[2], r: 0.4, point: true };
      else if (team === 'attack') this.actionAttacker(b, id, p, now);
      else this.actionDefender(b, id, p, now);
    } else b.goal = null;
    this.route(b, p);
  }

  /** Where to aim on a target: the head for good bots (most of the time), else the chest. */
  targetPos(t) {
    const g = this.game;
    if (t.drone) { const d = g.drones.get(t.id); return d ? [d.state.x, d.state.y + 0.12, d.state.z] : null; }
    const q = g.players.get(t.id);
    if (!q) return null;
    const s = q.state;
    return [s.x, s.y + eyeHeight(s.crouch, s.prone || 0) - 0.05, s.z, s.y + bodyHeight(s.crouch, s.prone || 0) * 0.6];
  }

  /** A walkable spot within `r` metres, as near as possible, where `threat` can't see us. */
  findCover(p, threat, r = 4) {
    const nav = this.nav;
    if (!nav.ready) return null;
    const g = this.game, s = p.state;
    const cands = nav.around(s.x, s.y, s.z, r);
    let best = null;
    for (let i = 0; i < cands.length; i += 3) {
      const n = cands[i];
      const pos = [nav.x[n], nav.y[n], nav.z[n]];
      const d = dist2(pos, [s.x, 0, s.z]);
      if (best && d >= best.d) continue;
      const eye = [pos[0], pos[1] + 1.1, pos[2]];       // crouched head height
      const v = [threat[0] - eye[0], threat[1] + 0.3 - eye[1], threat[2] - eye[2]];
      const dd = Math.hypot(...v);
      const hit = raycastWorld(g.world, eye, v.map((c) => c / dd), dd);
      if (hit && hit.t < dd - 0.5) best = { pos, d };
    }
    return best?.pos || null;
  }

  /** The next point towards the goal on the walking grid (10 times a second is plenty). */
  route(b, p) {
    const g = this.game, goal = b.goal;
    b.way = null;
    if (!goal || !this.nav.ready) return;
    const drone = g.rounds.phase === PHASE.PREP && p.member.team === 'attack' ? g.activeDroneOf(p) : null;
    const body = drone ? drone.state : p.state;
    const nav = this.nav;
    const field = nav.field(goal.key, () => (goal.point ? [nav.nearest(goal.x, goal.y, goal.z)] : nav.around(goal.x, goal.y, goal.z, goal.r)));
    const node = nav.nearest(body.x, body.y, body.z);
    b.way = node >= 0 ? nav.next(node, field, 3) : null;
    b.wayDist = node >= 0 ? field[node] : -1;
    if (!b.way && Math.hypot(body.x - goal.x, body.z - goal.z) > goal.r + 0.3) b.way = { x: goal.x, y: goal.y, z: goal.z };   // off the grid: head straight there
  }

  // ---------------------------------------------------------------- gadgets at sensible moments

  useGadgets(b, id, p, now) {
    const g = this.game, team = p.member.team, util = p.utility;
    const d = b.diff;
    // Ability: in a fight, or now and then while pushing
    if (now > b.nextAbility && (b.target || b.alert || Math.random() < 0.05)) { b.nextAbility = now + rand(14000, 28000); g.handleAction(id, 'ability'); }
    if (!util || util.charges <= 0 || now < b.threw || Math.random() > d.utility) return;
    const type = util.id;
    const contacts = this.contactsFor(team, b.eye);
    const hidden = contacts.find((c) => c.d > 5 && c.d < 18 && (!b.target || b.target.id !== c.id) && now - c.t < 3000);
    // Frag / impact at an enemy we know is behind cover
    if ((type === 'frag' || type === 'impact') && hidden) {
      b.throwAt = { pos: [hidden.pos[0], hidden.pos[1] + 0.5, hidden.pos[2]], type, until: now + 900, arc: type === 'frag' };
      return;
    }
    // Flash into the room before going in (attackers pushing, close to a contact or the site)
    if (type === 'flash' && team === 'attack' && !b.flashed && (b.pushing || hidden)) {
      const at = hidden?.pos || (b.siteIdx !== undefined ? [g.map.sites[b.siteIdx].x, g.map.sites[b.siteIdx].y + 1, g.map.sites[b.siteIdx].z] : null);
      if (at && dist2(at, b.eye) < 14) { b.flashed = true; b.throwAt = { pos: at, type, until: now + 900 }; }
      return;
    }
    // Smoke to cover a plant
    if (type === 'smoke' && team === 'attack' && b.hold && !b.smoked) {
      const c = contacts[0];
      const dir = c ? [c.pos[0] - b.eye[0], c.pos[2] - b.eye[2]] : [Math.sin(b.yaw), Math.cos(b.yaw)];
      const len = Math.hypot(...dir) || 1;
      b.smoked = true;
      b.throwAt = { pos: [b.eye[0] + dir[0] / len * 4, b.eye[1] - 0.6, b.eye[2] + dir[1] / len * 4], type, until: now + 900 };
    }
  }

  // ---------------------------------------------------------------- goals

  /** Head for a site: the one the team knows about, else look through them one by one. */
  siteGoal(b, p) {
    const g = this.game;
    const known = p.member.team === 'defense' || g.siteFound ? g.site : null;
    if (known !== null && known !== undefined) return known;
    if (b.explore === null || b.explore === undefined) b.explore = Math.floor(Math.random() * g.map.sites.length);
    const s = g.map.sites[b.explore];
    if (Math.hypot(p.state.x - s.x, p.state.z - s.z) < 2 && Math.abs(p.state.y - s.y) < 2) b.explore = (b.explore + 1) % g.map.sites.length;
    return b.explore;
  }

  goSite(b, index, radius = 1.5) {
    const s = this.game.map.sites[index];
    b.siteIdx = index;
    b.goal = { key: `site${index}:${radius}`, x: s.x, y: s.y, z: s.z, r: radius };
  }

  goPoint(b, pos, r = 0.5) {
    b.goal = { key: key3(pos), x: pos[0], y: pos[1], z: pos[2], r, point: true };
  }

  timeLeft() { return (this.game.rounds.endsAt - Date.now()) / 1000; }

  // ---------------------------------------------------------------- prep

  prepAttacker(b, id, p) {
    const g = this.game;
    if (!b.spawnPicked) { b.spawnPicked = true; g.setSpawnChoice(id, 1 + Math.floor(Math.random() * g.map.spawns.attack.length)); }
    // Drive the drone to a site; whatever it sees, the team remembers
    if (b.droneSite === null) b.droneSite = Math.floor(Math.random() * g.map.sites.length);
    const s = g.map.sites[b.droneSite];
    b.goal = { key: `site${b.droneSite}:4`, x: s.x, y: s.y, z: s.z, r: 4, drone: true };
    const drone = g.activeDroneOf(p);
    if (drone) {
      const e = droneEye(drone.state);
      for (const [qid, q] of g.players) {
        if (q.member.team !== 'defense' || !q.alive) continue;
        const v = [q.state.x - e[0], q.state.y + 1.2 - e[1], q.state.z - e[2]];
        const d = Math.hypot(...v);
        if (d > 25) continue;
        const hit = raycastWorld(g.world, e, v.map((c) => c / d), d);
        if (!hit || hit.t >= d - 0.3) this.contact('attack', qid, [q.state.x, q.state.y, q.state.z], false, DRONE_CONTACT_MS);
      }
    }
  }

  prepDefender(b, id, p, now) {
    const g = this.game;
    if (!b.tasks) b.tasks = this.defenderTasks(b, p);
    let t = b.tasks[0];
    while (t && now > t.deadline) { b.tasks.shift(); t = b.tasks[0]; }
    if (!t) return this.holdAngle(b, p, now);
    if (!t.started) { t.started = true; t.deadline = now + 9000; }
    this.goPoint(b, t.stand);
    if (Math.hypot(p.state.x - t.stand[0], p.state.z - t.stand[2]) < 0.7) {
      b.goal = null;
      b.look = t.look;
      const e = b.eye, dx = t.look[0] - e[0], dy = t.look[1] - e[1], dz = t.look[2] - e[2];
      if (!t.sent && Math.abs(wrap(b.yaw - yawTo(dx, dz))) < 0.06 && Math.abs(b.pitch - Math.atan2(dy, Math.hypot(dx, dz))) < 0.06) {
        t.sent = true;
        g.handleAction(id, t.action);
        t.deadline = Math.min(t.deadline, now + 1800);
      }
    } else b.look = null;
  }

  /** The doors and windows around the site, on its floor: what defenders watch. */
  entrances() {
    const g = this.game, s = g.activeSite();
    if (this.entranceCache?.site === g.site) return this.entranceCache.list;
    const list = g.map.openings.filter((o) => Math.abs((o.window ? o.y0 - 1 : o.y0) - s.y) < 1)
      .map((o) => ({ o, c: o.axis === 'x' ? [(o.from + o.to) / 2, (o.window ? o.y0 - 1 : o.y0), o.fixed] : [o.fixed, (o.window ? o.y0 - 1 : o.y0), (o.from + o.to) / 2] }))
      .filter(({ c }) => dist2(c, [s.x, 0, s.z]) < 13)
      .sort((a, b) => dist2(a.c, [s.x, 0, s.z]) - dist2(b.c, [s.x, 0, s.z]));
    this.entranceCache = { site: g.site, list };
    return list;
  }

  /** My index among my team's living bots (to share out entrances). */
  rank(id, team) {
    let i = 0;
    for (const [qid, q] of this.game.players) { if (qid === id) return i; if (q.member.team === team && q.member.bot) i++; }
    return i;
  }

  /** In prep: barricade a doorway, place a claymore inside it, and reinforce walls near the site. */
  defenderTasks(b, p) {
    const g = this.game, s = g.activeSite(), out = [];
    const ents = this.entrances();
    const mine = ents.length ? ents[this.rank(p.member.id, 'defense') % ents.length] : null;
    if (mine && !g.gadgets.barricadeAt(mine.o.id)) {
      const { o, c } = mine;
      const side = o.axis === 'x' ? Math.sign(s.z - o.fixed) || 1 : Math.sign(s.x - o.fixed) || 1;
      const stand = o.axis === 'x' ? [c[0], s.y, o.fixed + side * 1.2] : [o.fixed + side * 1.2, s.y, c[2]];
      out.push(this.aimTask(stand, [c[0], (o.y0 + o.y1) / 2, c[2]], 'barricade'));
    }
    if (mine && p.utility?.id === 'claymore') {
      const { o, c } = mine;
      const side = o.axis === 'x' ? Math.sign(s.z - o.fixed) || 1 : Math.sign(s.x - o.fixed) || 1;
      const stand = o.axis === 'x' ? [c[0] + 0.6, s.y, o.fixed + side * 2.4] : [o.fixed + side * 2.4, s.y, c[2] + 0.6];
      const floor = o.axis === 'x' ? [c[0], s.y + 0.02, o.fixed + side * 1.0] : [o.fixed + side * 1.0, s.y + 0.02, c[2]];
      out.push(this.aimTask(stand, floor, 'utility'));
    }
    const walls = g.world.sections.filter((sec) => sec.reinforceable && !g.world.reinforced[sec.id] && Math.abs(sec.min[1] - s.y) < 1.5)
      .map((sec) => ({ sec, c: sec.min.map((v, i) => (v + sec.max[i]) / 2) }))
      .filter(({ c }) => Math.hypot(c[0] - s.x, c[2] - s.z) < 9)
      .sort(() => Math.random() - 0.5).slice(0, 2);
    for (const { sec, c } of walls) {
      const thinX = sec.max[0] - sec.min[0] < sec.max[2] - sec.min[2];
      const side = thinX ? Math.sign(s.x - c[0]) || 1 : Math.sign(s.z - c[2]) || 1;
      const stand = thinX ? [c[0] + side * 1.1, s.y, c[2]] : [c[0], s.y, c[2] + side * 1.1];
      out.push(this.aimTask(stand, [c[0], s.y + 1.2, c[2]], 'reinforce'));
    }
    return out;
  }

  aimTask(stand, at, action) { return { stand, look: at, action, deadline: Infinity }; }

  // ---------------------------------------------------------------- holding angles (defenders)

  /**
   * A hard-to-see spot watching my entrance: 3.5 to 8 m back from it, inside, with a clear view of
   * the doorway, preferably tucked against a wall and off the straight line through the door.
   */
  pickSpot(b, p) {
    const g = this.game, nav = this.nav, s = g.activeSite();
    if (!nav.ready) return null;
    const ents = this.entrances();
    if (!ents.length) return [s.x, s.y, s.z];
    const ent = ents[(this.rank(p.member.id, 'defense') + (b.spotShift || 0)) % ents.length];
    b.entrance = ent;
    const { o, c } = ent;
    const look = [c[0], c[1] + 1.3, c[2]];
    const n = o.axis === 'x' ? [0, Math.sign(s.z - o.fixed) || 1] : [Math.sign(s.x - o.fixed) || 1, 0];   // into the room
    const cands = nav.around(c[0] + n[0] * 5, s.y, c[2] + n[1] * 5, 4.5);
    let best = null;
    for (let i = 0; i < cands.length && i < 400; i += 4) {
      const k = cands[i];
      const pos = [nav.x[k], nav.y[k], nav.z[k]];
      const off = [pos[0] - c[0], pos[2] - c[2]];
      const d = Math.hypot(...off);
      if (d < 3.5 || d > 8.5 || off[0] * n[0] + off[1] * n[1] < 1) continue;     // inside the room, not on the doorstep
      const eye = [pos[0], pos[1] + 1.1, pos[2]];
      const v = look.map((x, j) => x - eye[j]);
      const dd = Math.hypot(...v);
      const hit = raycastWorld(g.world, eye, v.map((x) => x / dd), dd);
      if (hit && hit.t < dd - 0.6) continue;                                    // must see the doorway
      let tucked = 0;
      for (let dIdx = 0; dIdx < 8; dIdx++) if (nav.adj[k * 8 + dIdx] < 0) tucked++;
      const straight = Math.abs((off[0] * n[1] - off[1] * n[0]) / d);           // 0 = right in line with the door
      const score = Math.abs(d - 5.5) - tucked * 0.5 - Math.min(0.6, straight) * 2 + Math.random() * 0.6;
      if (!best || score < best.score) best = { pos, score };
    }
    return best ? best.pos : [s.x, s.y, s.z];
  }

  holdAngle(b, p, now) {
    if (!b.spot || b.relocate > now - 300) {
      if (b.relocate) b.spotShift = (b.spotShift || 0) + (Math.random() < 0.5 ? 1 : 0);   // after a kill, maybe watch another way
      b.spot = this.pickSpot(b, p);
      b.relocate = 0;
    }
    this.goPoint(b, b.spot, 0.35);
    // Watch the entrance (or the threat we just heard)
    if (b.entrance) b.watch = [b.entrance.c[0], b.entrance.c[1] + 1.3, b.entrance.c[2]];
    b.crouchPost = b.diff.tactics && Math.hypot(p.state.x - b.spot[0], p.state.z - b.spot[2]) < 0.6;
  }

  // ---------------------------------------------------------------- action

  actionAttacker(b, id, p, now) {
    const g = this.game, intel = this.intel.attack;
    b.crouchPost = false; b.pushing = false; b.watch = null;
    if (b.plan === null) b.plan = Math.random() < 0.25 ? 'rappel' : 'walk';
    if (b.plan === 'rappel' && this.rappelPlan(b, id, p, now)) return;

    // Help: a teammate is fighting nearby and we have nothing to do -> go there
    const contacts = this.contactsFor('attack', b.eye);
    const late = this.timeLeft() < (g.mode === 'defuser' && !g.defuser.planted ? 70 : 50);

    if (g.mode === 'defuser') {
      const d = g.defuser;
      if (d.dropped && !d.planted) {
        const mine = dist2([p.state.x, 0, p.state.z], d.dropped);
        const closer = [...g.players.values()].some((q) => q !== p && q.member.team === 'attack' && q.alive && dist2([q.state.x, 0, q.state.z], d.dropped) < mine);
        if (!closer) { this.goPoint(b, d.dropped, 0.3); return; }
      }
      const site = this.siteGoal(b, p);
      if (d.carrier === id && inObjectiveZone(g.map.sites[site], p.state) && site === g.site && !b.target) { b.goal = null; b.hold = true; return; }
    }
    const site = this.siteGoal(b, p);

    // Stage short of the site and push together (unless time is running out)
    if (b.diff.tactics && !late && !intel.push && g.siteFound) {
      this.goSite(b, site, 1.2);
      if (b.wayDist >= 0 && b.wayDist <= 24) {
        b.staged = true;
        intel.staged.add(id);
        if (!intel.firstStaged) intel.firstStaged = now;
        b.goal = null;
        b.watch = [g.map.sites[site].x, g.map.sites[site].y + 1.3, g.map.sites[site].z];
        b.crouchPost = true;
        this.tryBreach(b, id, p, now, site);
        const alive = [...g.players.values()].filter((q) => q.member.team === 'attack' && q.alive).length;
        if (intel.staged.size >= Math.min(3, alive) || now - intel.firstStaged > 9000) intel.push = true;
        return;
      }
    }
    if (intel.push || late) b.pushing = true;
    if (b.breach && b.breach.stage !== 'done') { this.tryBreach(b, id, p, now, site); if (b.breach.stage !== 'done') return; }
    // A teammate's fight close by: go and help
    const fight = contacts.find((c) => c.seen && now - c.t < 1500 && c.d > 3 && c.d < 22);
    if (fight && !b.target && !late && Math.random() < 0.6) { this.goPoint(b, fight.pos, 2); b.watch = [fight.pos[0], fight.pos[1] + 1.4, fight.pos[2]]; return; }
    this.goSite(b, site, 1.2);
    b.watch = contacts[0] && contacts[0].d < 25 ? [contacts[0].pos[0], contacts[0].pos[1] + 1.4, contacts[0].pos[2]] : null;
    // On the site in the standard mode: don't stand still in the open
    if (g.mode !== 'defuser' && inObjectiveZone(g.map.sites[site], p.state)) { b.goal = null; b.crouchPost = true; }
  }

  /** Breach charge: on a soft wall between us and the site, plant, step back, blow it (a new angle). */
  tryBreach(b, id, p, now, siteIdx) {
    const g = this.game, intel = this.intel.attack;
    if (!b.diff.tactics || !(p.charges > 0) && !b.breach) return;
    if (!b.breach) {
      if (intel.breached || p.charges <= 0) return;
      const s = g.map.sites[siteIdx];
      const dir = [s.x - b.eye[0], 0, s.z - b.eye[2]];
      const len = Math.hypot(dir[0], dir[2]) || 1;
      const hit = raycastWorld(g.world, b.eye, [dir[0] / len, -0.15, dir[2] / len], 2.1);
      if (hit?.box.kind !== 'panel' || g.world.isReinforcedPanel(hit.box.id) || g.world.panels[hit.box.id]?.hatch) return;
      intel.breached = true;
      b.breach = { stage: 'plant', look: hit.point, yaw: yawTo(dir[0], dir[2]), until: now + 9000 };
    }
    const br = b.breach;
    if (now > br.until) { br.stage = 'done'; return; }
    if (br.stage === 'plant') {
      b.goal = null; b.look = br.look;
      if (Math.abs(wrap(b.yaw - yawTo(br.look[0] - b.eye[0], br.look[2] - b.eye[2]))) < 0.08) { g.handleAction(id, 'breach'); br.stage = 'back'; br.back = [p.state.x + Math.sin(br.yaw) * 3.5, p.state.y, p.state.z + Math.cos(br.yaw) * 3.5]; br.at = now; }   // then 3.5 m back from the wall
    } else if (br.stage === 'back') {
      b.look = null;
      this.goPoint(b, br.back, 0.5);
      if (dist2([p.state.x, 0, p.state.z], br.back) < 0.8 || now - br.at > 3000) { g.handleAction(id, 'breach'); br.stage = 'done'; intel.push = true; }
    }
  }

  actionDefender(b, id, p, now) {
    const g = this.game;
    b.pushing = false;
    if (g.mode === 'defuser' && g.defuser.planted) {
      const s = g.activeSite();
      b.crouchPost = false;
      if (inObjectiveZone(s, p.state) && !b.target) { b.goal = null; b.hold = true; } else this.goSite(b, g.site, 1);
      return;
    }
    // A teammate is in a fight not far off and I'm the nearest free defender: rotate to help
    const contacts = this.contactsFor('defense', b.eye);
    const fight = contacts.find((c) => c.seen && now - c.t < 2000 && c.d > 4 && c.d < 16);
    if (fight && !b.target && b.diff.tactics) {
      const nearer = [...g.players.values()].some((q) => q !== p && q.alive && q.member.team === 'defense' && dist2([q.state.x, 0, q.state.z], fight.pos) < fight.d - 1);
      if (!nearer) { b.crouchPost = false; this.goPoint(b, fight.pos, 3); b.watch = [fight.pos[0], fight.pos[1] + 1.4, fight.pos[2]]; return; }
    }
    this.holdAngle(b, p, now);
  }

  // ---------------------------------------------------------------- rappelling (and roof hatches)

  /** Climb an outside wall to a window near the site and swing in; or up to the roof and in through a hatch. */
  rappelPlan(b, id, p, now) {
    const g = this.game, map = g.map;
    if (!b.rp) {
      const site = map.sites[this.siteGoal(b, p)];
      const ropes = (map.ropes || []).map((r, i) => ({ r, i })).filter(({ r }) => r.kind === 'wall');
      if (!ropes.length) { b.plan = 'walk'; return false; }
      const wins = (r) => map.openings.filter((o) => o.window && o.exterior && o.axis === r.wallAxis && Math.abs(o.fixed - r.wallFixed) < 0.01 && o.y0 > 2
        && Math.abs((o.from + o.to) / 2 - (r.wallAxis === 'x' ? r.x : r.z)) <= r.range + 0.5);
      const scored = ropes.map(({ r, i }) => ({ r, i, w: wins(r)[0] || null, d: Math.hypot(r.x - site.x, r.z - site.z) })).sort((a, b2) => (a.w ? 0 : 20) + a.d - ((b2.w ? 0 : 20) + b2.d));
      const c = scored[0];
      b.rp = { stage: 'goto', rope: c.i, win: c.w, until: now + 40000 };
    }
    const rp = b.rp, r = map.ropes[rp.rope];
    if (now > rp.until) { b.plan = 'walk'; return false; }
    const s = p.state;
    if (rp.stage === 'goto') {
      this.goPoint(b, [r.x + r.nx * 1.3, r.bottom, r.z + r.nz * 1.3]);
      if (Math.hypot(s.x - (r.x + r.nx * 1.3), s.z - (r.z + r.nz * 1.3)) < 0.8) rp.stage = 'attach';
      return true;
    }
    if (rp.stage === 'attach') {
      b.goal = null;
      b.faceYaw = Math.atan2(r.nx, r.nz);               // looking at the wall
      if (s.rap) { rp.stage = 'climb'; return true; }
      if (Math.abs(wrap(b.yaw - b.faceYaw)) < 0.15 && findRope(s, g.world) && now > (rp.nextPress || 0)) { rp.nextPress = now + 400; b.keysOnce |= KEY.RAPPEL; }
      return true;
    }
    if (rp.stage === 'climb') {
      b.goal = null;
      if (!s.rap) { rp.stage = s.y > r.top - 0.5 ? 'roof' : 'done'; return rp.stage !== 'done'; }
      b.faceYaw = Math.atan2(r.nx, r.nz);
      b.ropeKeys = 0;
      if (rp.win) {
        const o = rp.win, along = r.wallAxis === 'x' ? s.x : s.z, mid = (o.from + o.to) / 2, wantY = (o.y0 + o.y1) / 2 - 0.9;
        const [rx, rz] = [Math.cos(b.yaw), -Math.sin(b.yaw)];
        const rightIsPlus = rx * r.tx + rz * r.tz >= 0;
        if (Math.abs(along - mid) > 0.3) b.ropeKeys |= (along < mid) === rightIsPlus ? KEY.RIGHT : KEY.LEFT;
        if (s.y < wantY - 0.15) b.ropeKeys |= KEY.FORWARD; else if (s.y > wantY + 0.15) b.ropeKeys |= KEY.BACK;
        if (Math.abs(along - mid) <= 0.5 && Math.abs(s.y - wantY) <= 0.3) b.ropeKeys |= KEY.JUMP;    // swing in (breaks a barricade)
      } else b.ropeKeys |= KEY.FORWARD;                                                             // up to the roof
      return true;
    }
    if (rp.stage === 'roof') {
      // Find a roof hatch and break in through it
      const h = (map.hatches || []).filter((x) => x.on !== 'floor' && Math.abs(x.y1 - s.y) < 0.5).sort((a, c) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(c.x - s.x, c.z - s.z))[0];
      if (!h) { rp.stage = 'done'; return false; }
      const open = !g.world.alive[g.world.hatchPanel.get(h.boxId)];
      b.direct = [h.x, s.y, h.z];                          // the roof has no walking grid: go straight there
      b.goal = null;
      if (Math.hypot(s.x - h.x, s.z - h.z) < (open ? 0.2 : 0.75)) {
        b.direct = open ? [h.x, s.y, h.z] : null;
        if (!open) { b.look = [h.x, h.y1, h.z]; if (now > (rp.nextHit || 0)) { rp.nextHit = now + 850; g.handleAction(id, 'melee'); } }
      }
      if (s.y < h.y0 - 0.5) { rp.stage = 'done'; b.direct = null; b.look = null; }      // dropped through
      return true;
    }
    b.plan = 'walk';
    return false;
  }

  // ---------------------------------------------------------------- steering (every tick)

  /** Turn the view towards (yaw, pitch) like a hand on a mouse: a damped spring with a top speed. */
  aimAt(b, wantYaw, wantPitch, dt, fast) {
    const w = fast ? b.diff.spring : Math.max(8, b.diff.spring * 0.7);
    const ey = wrap(wantYaw - b.yaw), ep = wantPitch - b.pitch;
    b.yawVel += (w * w * ey - 2 * w * b.yawVel) * dt;
    b.pitchVel += (w * w * ep - 2 * w * b.pitchVel) * dt;
    const max = fast ? b.diff.turn : 9;
    b.yawVel = Math.max(-max, Math.min(max, b.yawVel));
    b.pitchVel = Math.max(-max, Math.min(max, b.pitchVel));
    b.yaw = wrap(b.yaw + b.yawVel * dt);
    b.pitch = Math.max(-1.5, Math.min(1.5, b.pitch + b.pitchVel * dt));
  }

  steer(b, id, p, now, dt) {
    const g = this.game, s = p.state;
    let keys = 0;
    const drone = g.rounds.phase === PHASE.PREP && p.member.team === 'attack' ? g.activeDroneOf(p) : null;
    const body = drone ? drone.state : s;
    const blind = (p.blindUntil || 0) > now;

    // Where to walk (worked out when thinking)
    const way = b.direct ? { x: b.direct[0], y: b.direct[1], z: b.direct[2] } : b.way;
    let moveYaw = null;
    if (way && Math.hypot(way.x - body.x, way.z - body.z) > 0.15) moveYaw = yawTo(way.x - body.x, way.z - body.z);
    b.moveYaw = moveYaw;

    // Where to look
    let lookYaw = null, lookPitch = 0, fast = false, fire = false;
    const t = b.target;
    if (t && !drone && !s.rap && !blind) {
      const pos = this.targetPos(t);
      if (pos) {
        const eye = getEyePosition(s, g.world);
        const head = Math.random() < b.diff.head;
        const aimY = t.drone ? pos[1] : (b.headPick ?? (b.headPick = head)) ? pos[1] : pos[3];
        const dx = pos[0] - eye.x, dy = aimY - eye.y, dz = pos[2] - eye.z;
        const dist = Math.hypot(dx, dy, dz);
        // Aim error: starts large when the target appears and settles (faster for better bots), with a slow wobble
        const since = now - (b.acquired || now);
        const err = b.diff.aimRest + (b.diff.aimStart - b.diff.aimRest) * Math.exp(-since / b.diff.settleMs);
        const wob = Math.sin(now / 260 + b.seq * 0.01) * 0.5 + 0.5;
        lookYaw = yawTo(dx, dz) + (b.errDir?.[0] || 0) * err * (0.6 + wob * 0.4);
        lookPitch = Math.atan2(dy, Math.hypot(dx, dz)) + (b.errDir?.[1] || 0) * err;
        fast = true;
        // Pull the trigger once reacted and the aim is close enough for the target's size at this range
        const tol = Math.max(0.012, Math.atan2(t.drone ? 0.15 : 0.32, dist));
        if (now > b.reactAt && Math.abs(wrap(b.yaw - yawTo(dx, dz))) < tol * 1.6 && Math.abs(b.pitch - Math.atan2(dy, Math.hypot(dx, dz))) < tol * 1.6) fire = true;
        b.lastDist = dist;
      }
    } else if (!blind && b.lastSeenPos && now - b.lastSeen < b.diff.suppressMs && !drone) {
      // Just lost sight: keep the crosshair where they were, and keep shooting a moment
      const eye = getEyePosition(s, g.world), pos = b.lastSeenPos;
      lookYaw = yawTo(pos[0] - eye.x, pos[2] - eye.z);
      lookPitch = Math.atan2(pos[3] - eye.y, Math.hypot(pos[0] - eye.x, pos[2] - eye.z));
      fast = true; fire = true;
    } else if (b.throwAt && now < b.throwAt.until) {
      // Aim a grenade: a little above the spot for a lob
      const eye = getEyePosition(s, g.world), a = b.throwAt.pos;
      const h = Math.hypot(a[0] - eye.x, a[2] - eye.z);
      lookYaw = yawTo(a[0] - eye.x, a[2] - eye.z);
      lookPitch = Math.atan2(a[1] - eye.y, h) + Math.min(0.45, h * 0.03);
      if (Math.abs(wrap(b.yaw - lookYaw)) < 0.05 && Math.abs(b.pitch - lookPitch) < 0.05) { g.handleAction(id, 'utility'); b.throwAt = null; b.threw = now + 6000; }
    } else if (b.look) {
      const eye = getEyePosition(s, g.world);
      const dx = b.look[0] - eye.x, dy = b.look[1] - eye.y, dz = b.look[2] - eye.z;
      lookYaw = yawTo(dx, dz); lookPitch = Math.atan2(dy, Math.hypot(dx, dz));
    } else if (b.faceFor && now < b.faceFor.until) {
      lookYaw = b.faceFor.yaw;
    } else if (s.rap || b.rp?.stage === 'attach') {
      lookYaw = b.faceYaw;
    } else if (!drone && (b.alert || b.watch) && b.diff.tactics !== false) {
      // Pre-aim where the danger is: a sound, a teammate's call, the doorway we hold
      const at = b.alert && now - b.alert.t < 4000 ? b.alert.pos : b.watch;
      if (at) {
        const eye = getEyePosition(s, g.world);
        lookYaw = yawTo(at[0] - eye.x, at[2] - eye.z);
        lookPitch = Math.atan2(at[1] - eye.y, Math.hypot(at[0] - eye.x, at[2] - eye.z));
      }
    }
    if (lookYaw === null && moveYaw !== null) lookYaw = moveYaw;
    if (!t) b.headPick = null;
    if (lookYaw !== null) this.aimAt(b, lookYaw, lookPitch, dt, fast);

    // Shoot: bursts at range to keep the spread down, a steady stream up close; tap semi-automatics
    if (fire && !drone && !s.rap) {
      const w = WEAPONS[p.weapon.id];
      const range = b.lastDist ?? 10;
      const bloomOk = !w.bloomMax || p.weapon.bloom <= w.bloomMax * (range > 12 ? b.diff.bloomCap : 1);
      if (w.auto === false) keys |= (b.seq % 5 < 2 ? KEY.FIRE : 0);
      else if (range < 8 || bloomOk) keys |= KEY.FIRE;
    }
    // Wall-bang: heard an enemy close behind a soft wall -> shoot through it
    if (!fire && !t && b.diff.wallbang && b.alert?.steps && now - b.alert.t < 700 && b.alert.d < 10 && !drone && !s.rap) {
      const eye = getEyePosition(s, g.world), a = b.alert.pos;
      const v = [a[0] - eye.x, a[1] - eye.y, a[2] - eye.z], d = Math.hypot(...v);
      const hit = raycastWorld(g.world, [eye.x, eye.y, eye.z], v.map((c) => c / d), d);
      if (hit?.box.kind === 'panel' && !g.world.isReinforcedPanel(hit.box.id) && hit.t < d - 0.5 && Math.abs(wrap(b.yaw - yawTo(v[0], v[2]))) < 0.08) {
        if (!b.wallbangUntil || now > b.wallbangUntil + 2500) b.wallbangUntil = now + 900;
      }
      if (now < b.wallbangUntil) keys |= KEY.FIRE;
    }

    // Move: walk along the way while looking wherever we look (so we can pre-aim corners and strafe)
    let move = moveYaw !== null && !b.hold;
    if (t && !t.drone && !drone) {
      // In a fight: don't stand still; strafe left and right, and only keep walking in if they're far
      if (b.diff.tactics || b.diff === BOT_DIFFICULTIES.easy) {
        if (now > b.strafeUntil) { b.strafeUntil = now + rand(250, 700); b.strafeKey = Math.random() < 0.5 ? KEY.LEFT : KEY.RIGHT; }
        if (b.diff.tactics || Math.random() < 0.3) keys |= b.strafeKey;
      }
      if ((b.lastDist ?? 10) < 9 || b.cover) move = !!b.cover;
    }
    if (move) {
      const rel = wrap(moveYaw - b.yaw);
      const fwd = Math.cos(rel), right = -Math.sin(rel);
      if (fwd > 0.38) keys |= KEY.FORWARD; else if (fwd < -0.38) keys |= KEY.BACK;
      if (right > 0.38) keys |= KEY.RIGHT; else if (right < -0.38) keys |= KEY.LEFT;
      const facing = Math.abs(rel) < 0.35;
      if (facing && !t && !b.alert && !b.pushing && !drone && !(b.watch && b.diff.tactics)) keys |= KEY.SPRINT;
      if (drone && facing) keys |= KEY.SPRINT;
    }
    // Crouch: holding a post, in cover, and sometimes mid-fight (hard to hit)
    if (!drone && !s.rap && (b.cover && !move ? true : b.crouchPost && !move) && b.diff.tactics) keys |= KEY.CROUCH;
    if (!drone && t && b.diff === BOT_DIFFICULTIES.hard && (Math.floor(now / 900) % 3 === 0)) keys |= KEY.CROUCH;

    if (s.rap) keys = (keys & KEY.FIRE) | (b.ropeKeys || 0);
    if (b.hold) keys = (keys & KEY.FIRE ? KEY.FIRE : 0) | KEY.INTERACT;     // plant / disable: stand still, hold the key

    // Unstick (the progress check is in think): hop first (it vaults low things), then sidestep a moment
    b.wantMove = move && !s.rap;
    if (b.wantMove && !drone) {
      if (b.stuckT > 0.2 && b.stuckT < 0.6) keys |= KEY.JUMP;
      if (b.stuckT >= 1.2) { b.unstuck = now + 700; b.stuckT = 0; b.trail = []; b.side = Math.random() < 0.5 ? KEY.LEFT : KEY.RIGHT; }
    }
    if (drone && b.stuckT > 0.3) keys |= KEY.JUMP;
    if (now < b.unstuck) keys = (keys & ~KEY.FORWARD) | b.side | KEY.BACK;
    // Reload when empty, or topping up when there's nothing to shoot at
    const w = WEAPONS[p.weapon.id];
    if (p.weapon.reserve > 0 && (p.weapon.ammo === 0 || (!t && !(keys & KEY.FIRE) && p.weapon.ammo < w.magSize * 0.5 && (!b.alert || now - b.alert.t > 2500)))) keys |= KEY.RELOAD;
    return keys | b.keysOnce;
  }
}

