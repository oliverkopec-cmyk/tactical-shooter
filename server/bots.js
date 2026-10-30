// Server-side bots. A bot is a room member with no connection: each tick its "brain" writes one input
// (keys, yaw, pitch) into the same queue a real player's inputs go into, so bots move, shoot and
// collide by exactly the same rules as everyone else. Discrete things (reinforce, barricade, utility,
// ability, melee, voting, operator pick) go through the same handlers real players use.
//
// Brains think about 10 times a second (seeing enemies, choosing what to do) and steer every tick.
// Movement uses the shared walking grid in server/nav.js. Difficulty sets reaction time, aim error,
// turn speed and how long they hold the trigger.

import { PHASE, KEY, MAX_INPUT_DT } from '../shared/constants.js';
import { operatorsFor } from '../shared/operators.js';
import { WEAPONS, aimDirection } from '../shared/weapons.js';
import { getEyePosition, findRope } from '../shared/movement.js';
import { raycastWorld } from '../shared/raycast.js';
import { inObjectiveZone } from '../shared/rules.js';
import { navFor } from './nav.js';

export const BOT_DIFFICULTIES = {
  easy: { label: 'Easy', reactMs: 900, aimError: 0.08, turn: 3.2, burstMs: 300, pauseMs: 550, fov: 1.7, utilityChance: 0.05 },
  normal: { label: 'Normal', reactMs: 500, aimError: 0.04, turn: 6, burstMs: 450, pauseMs: 320, fov: 2.1, utilityChance: 0.1 },
  hard: { label: 'Hard', reactMs: 260, aimError: 0.016, turn: 10, burstMs: 650, pauseMs: 160, fov: 2.5, utilityChance: 0.16 },
};

const THINK_MS = 100;
const SIGHT = 70;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);            // yaw 0 looks down -z

export class BotBrains {
  constructor(game) {
    this.game = game;
    this.brains = new Map();     // player id -> brain state
  }

  get nav() { return navFor(this.game.map); }

  brain(id, p) {
    let b = this.brains.get(id);
    if (!b) {
      b = { id, diff: BOT_DIFFICULTIES[p.member.bot] || BOT_DIFFICULTIES.normal, seq: 0, round: -1, yaw: p.state.yaw, pitch: 0 };
      this.brains.set(id, b);
    }
    return b;
  }

  forget(id) { this.brains.delete(id); }

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
      // One input per tick (split if the tick was long), exactly like a client would send
      let left = Math.min(dt, 0.25);
      while (left > 1e-4 && p.queue.length < 20) {
        const step = Math.min(left, MAX_INPUT_DT);
        left -= step;
        p.queue.push({ seq: ++b.seq, dt: step, keys, yaw: b.yaw, pitch: b.pitch, wsel: 0, rt: 0 });
        b.keysOnce = 0;
      }
    }
  }

  newRound(b, p) {
    Object.assign(b, {
      round: this.game.rounds.round, task: null, tasks: null, target: null, seen: null, reactAt: 0, picked: false, voted: false,
      plan: null, rp: null, explore: null, holdAt: null, stuckT: 0, lastPos: null, unstuck: 0, fireUntil: 0, pauseUntil: 0,
      nextAbility: Date.now() + rand(15000, 35000), spawnPicked: false, keysOnce: 0, droneSite: null,
    });
    b.yaw = p.state.yaw; b.pitch = 0;
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
    if (p.member.team === 'defense' && !b.voted) { b.voted = true; g.voteSite(id, Math.floor(Math.random() * g.map.sites.length)); }
  }

  // ---------------------------------------------------------------- thinking (10 times a second)

  think(b, id, p, now) {
    const g = this.game;
    const eye = getEyePosition(p.state, g.world);
    const origin = [eye.x, eye.y, eye.z];
    b.eye = origin;
    // Enemies I can see (or that my team has marked)
    let best = null;
    for (const [qid, q] of g.players) {
      if (q.member.team === p.member.team || !q.alive || q.spawned === false) continue;
      const aimAt = [q.state.x, q.state.y + (q.state.prone > 0.5 ? 0.3 : q.state.crouch > 0.5 ? 0.9 : 1.3), q.state.z];
      const v = aimAt.map((c, i) => c - origin[i]);
      const dist = Math.hypot(...v);
      if (dist > SIGHT) continue;
      const ang = Math.abs(wrap(yawTo(v[0], v[2]) - b.yaw));
      const marked = q.spottedUntil > now;
      if (ang > b.diff.fov / 2 && !marked && dist > 4) continue;
      const wall = raycastWorld(g.world, origin, v.map((c) => c / dist), dist);
      if (wall && wall.t < dist - 0.3) continue;
      if (!best || dist < best.dist) best = { id: qid, q, dist, aimAt };
    }
    if (best) {
      if (!b.target || b.target.id !== best.id) b.reactAt = now + b.diff.reactMs * rand(0.8, 1.25);
      b.target = best;
      b.lastSeen = now;
    } else if (b.target && now - b.lastSeen > 1500) b.target = null;

    const phase = g.rounds.phase;
    // Utility and ability now and then, mostly when an enemy is in sight
    if (phase === PHASE.ACTION && b.target && now > b.reactAt && Math.random() < b.diff.utilityChance * 0.1 && b.target.dist > 6 && b.target.dist < 25) g.handleAction(id, 'utility');
    if (phase === PHASE.ACTION && now > b.nextAbility) { b.nextAbility = now + rand(20000, 40000); g.handleAction(id, 'ability'); }
    if (b.target && b.target.dist < 1.7 && now > b.reactAt) g.handleAction(id, 'melee');

    // A barricade right in front of us on the way: smash it (3 hits)
    if (phase === PHASE.ACTION && !b.target && (b.wantMove || b.stuckT > 0.3) && !p.state.rap && now > (b.nextMelee || 0)) {
      const ahead = raycastWorld(g.world, [origin[0], origin[1] - 0.5, origin[2]], aimDirection(b.yaw, 0), 1.4);
      if (ahead?.box.kind === 'barricade') { b.nextMelee = now + 850; g.handleAction(id, 'melee'); }
    }
    // Progress check over the last second: not getting anywhere while trying to -> hop, then sidestep
    const pos = [p.state.x, p.state.z];
    b.trail = (b.trail || []).concat([[now, ...pos]]).filter((e) => now - e[0] < 1300);
    const first = b.trail[0];
    b.stuckT = b.wantMove && now - first[0] > 1000 && Math.hypot(pos[0] - first[1], pos[1] - first[2]) < 0.5 ? b.stuckT + THINK_MS / 1000 : 0;

    // What to do this phase
    if (phase === PHASE.PREP) {
      if (p.member.team === 'attack') this.prepAttacker(b, id, p, now);
      else this.prepDefender(b, id, p, now);
    } else if (phase === PHASE.ACTION) {
      if (p.member.team === 'attack') this.actionAttacker(b, id, p, now);
      else this.actionDefender(b, id, p, now);
    } else b.goal = null;
    this.route(b, p);
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
    if (!b.way && Math.hypot(body.x - goal.x, body.z - goal.z) > goal.r + 0.3) b.way = { x: goal.x, y: goal.y, z: goal.z };   // off the grid: head straight there
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
    b.goal = { key: `site${index}:${radius}`, x: s.x, y: s.y, z: s.z, r: radius };
  }

  prepAttacker(b, id, p) {
    const g = this.game;
    if (!b.spawnPicked) { b.spawnPicked = true; g.setSpawnChoice(id, 1 + Math.floor(Math.random() * g.map.spawns.attack.length)); }
    // Drive the drone towards a site to find it
    if (b.droneSite === null) b.droneSite = Math.floor(Math.random() * g.map.sites.length);
    const s = g.map.sites[b.droneSite];
    b.goal = { key: `site${b.droneSite}:4`, x: s.x, y: s.y, z: s.z, r: 4, drone: true };
  }

  prepDefender(b, id, p, now) {
    const g = this.game;
    if (!b.tasks) b.tasks = this.defenderTasks(p);
    let t = b.tasks[0];
    while (t && now > t.deadline) { b.tasks.shift(); t = b.tasks[0]; }
    if (!t) return this.holdSite(b, p);
    if (!t.started) { t.started = true; t.deadline = now + 9000; }
    b.goal = { key: `pt:${t.stand.map((v) => v.toFixed(1)).join(',')}`, x: t.stand[0], y: t.stand[1], z: t.stand[2], r: 0.5, point: true };
    if (Math.hypot(p.state.x - t.stand[0], p.state.z - t.stand[2]) < 0.7) {
      b.goal = null;
      b.look = t.look;
      const e = b.eye, dx = t.look[0] - e[0], dy = t.look[1] - e[1], dz = t.look[2] - e[2];
      if (!t.sent && Math.abs(wrap(b.yaw - yawTo(dx, dz))) < 0.06 && Math.abs(b.pitch - Math.atan2(dy, Math.hypot(dx, dz))) < 0.06) {
        t.sent = true;
        g.handleAction(id, t.action);
        t.deadline = Math.min(t.deadline, now + 1800);
      }
    }
  }

  /** In prep: reinforce up to two walls near the site and barricade one doorway. */
  defenderTasks(p) {
    const g = this.game, s = g.activeSite(), out = [];
    const near = g.world.sections.filter((sec) => sec.reinforceable && !g.world.reinforced[sec.id] && Math.abs(sec.min[1] - s.y) < 1.5)
      .map((sec) => ({ sec, c: sec.min.map((v, i) => (v + sec.max[i]) / 2) }))
      .filter(({ c }) => Math.hypot(c[0] - s.x, c[2] - s.z) < 9)
      .sort(() => Math.random() - 0.5).slice(0, 2);
    for (const { sec, c } of near) {
      const thinX = sec.max[0] - sec.min[0] < sec.max[2] - sec.min[2];
      const side = thinX ? Math.sign(s.x - c[0]) || 1 : Math.sign(s.z - c[2]) || 1;
      const stand = thinX ? [c[0] + side * 1.1, s.y, c[2]] : [c[0], s.y, c[2] + side * 1.1];
      out.push(this.aimTask(p, stand, [c[0], s.y + 1.2, c[2]], 'reinforce'));
    }
    const door = g.map.openings.filter((o) => !g.gadgets.barricadeAt(o.id) && Math.abs((o.window ? o.y0 - 1 : o.y0) - s.y) < 1)
      .map((o) => ({ o, c: o.axis === 'x' ? [(o.from + o.to) / 2, o.fixed] : [o.fixed, (o.from + o.to) / 2] }))
      .filter(({ c }) => Math.hypot(c[0] - s.x, c[1] - s.z) < 9).sort(() => Math.random() - 0.5)[0];
    if (door) {
      const { o, c } = door;
      const side = o.axis === 'x' ? Math.sign(s.z - o.fixed) || 1 : Math.sign(s.x - o.fixed) || 1;
      const stand = o.axis === 'x' ? [c[0], s.y, o.fixed + side * 1.2] : [o.fixed + side * 1.2, s.y, c[1]];
      out.unshift(this.aimTask(p, stand, [c[0], (o.y0 + o.y1) / 2, c[1]], 'barricade'));   // the doorway first: it's quick
    }
    return out;
  }

  aimTask(p, stand, at, action) {
    const ex = stand[0], ey = stand[1] + 1.62, ez = stand[2];
    const dx = at[0] - ex, dy = at[1] - ey, dz = at[2] - ez;
    return { stand, look: at, action, yawTo: yawTo(dx, dz), pitchTo: Math.atan2(dy, Math.hypot(dx, dz)), deadline: Infinity };
  }

  holdSite(b, p) {
    const g = this.game, s = g.activeSite();
    if (!b.holdAt || Math.random() < 0.01) {
      const a = Math.random() * Math.PI * 2, r = rand(0.5, s.zoneRadius + 1.5);
      b.holdAt = [s.x + Math.cos(a) * r, s.y, s.z + Math.sin(a) * r];
      b.lookAround = rand(0, Math.PI * 2);
    }
    b.goal = { key: `pt:${b.holdAt.map((v) => v.toFixed(1)).join(',')}`, x: b.holdAt[0], y: b.holdAt[1], z: b.holdAt[2], r: 0.6, point: true };
  }

  actionAttacker(b, id, p, now) {
    const g = this.game;
    b.hold = false;
    // A rappel entry for some attackers (round start decides)
    if (b.plan === null) b.plan = Math.random() < 0.3 ? 'rappel' : 'walk';
    if (b.plan === 'rappel' && this.rappelPlan(b, id, p, now)) return;
    if (g.mode === 'defuser') {
      const d = g.defuser;
      if (d.dropped && !d.planted) {
        // the nearest attacker fetches it
        const mine = Math.hypot(p.state.x - d.dropped[0], p.state.z - d.dropped[2]);
        const closer = [...g.players.values()].some((q) => q !== p && q.member.team === 'attack' && q.alive && Math.hypot(q.state.x - d.dropped[0], q.state.z - d.dropped[2]) < mine);
        if (!closer) { b.goal = { key: `pt:${d.dropped.map((v) => v.toFixed(1)).join(',')}`, x: d.dropped[0], y: d.dropped[1], z: d.dropped[2], r: 0.3, point: true }; return; }
      }
      const site = this.siteGoal(b, p);
      this.goSite(b, site, 1.2);
      // the carrier plants once in the zone (standing still, holding the key)
      if (d.carrier === id && inObjectiveZone(g.map.sites[site], p.state) && site === g.site) { b.goal = null; b.hold = true; }
      return;
    }
    this.goSite(b, this.siteGoal(b, p), 1.2);
  }

  actionDefender(b, id, p, now) {
    const g = this.game;
    b.hold = false;
    if (g.mode === 'defuser' && g.defuser.planted) {
      const s = g.activeSite();
      if (inObjectiveZone(s, p.state)) { b.goal = null; b.hold = true; } else this.goSite(b, g.site, 1);
      return;
    }
    this.holdSite(b, p);
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
      const foot = [r.x + r.nx * 1.3, r.bottom, r.z + r.nz * 1.3];
      b.goal = { key: `pt:${foot.map((v) => v.toFixed(1)).join(',')}`, x: foot[0], y: foot[1], z: foot[2], r: 0.5, point: true };
      if (Math.hypot(s.x - foot[0], s.z - foot[2]) < 0.8) rp.stage = 'attach';
      return true;
    }
    if (rp.stage === 'attach') {
      b.goal = null;
      b.look = null;
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
      if (s.y < h.y0 - 0.5) { rp.stage = 'done'; b.direct = null; }      // dropped through
      return true;
    }
    b.plan = 'walk';
    return false;
  }

  // ---------------------------------------------------------------- steering (every tick)

  steer(b, id, p, now, dt) {
    const g = this.game, s = p.state;
    let keys = 0;
    const drone = g.rounds.phase === PHASE.PREP && p.member.team === 'attack' ? g.activeDroneOf(p) : null;
    const body = drone ? drone.state : s;
    let wantYaw = null, wantPitch = 0, move = false, sprint = false;

    // Where to walk (worked out when thinking): the next point on the walking grid, or straight at a point
    const way = b.direct ? { x: b.direct[0], y: b.direct[1], z: b.direct[2] } : b.way;
    if (way) {
      const dx = way.x - body.x, dz = way.z - body.z;
      if (Math.hypot(dx, dz) > 0.15) { wantYaw = yawTo(dx, dz); move = true; sprint = !b.target && !drone; }
    }

    // Combat: face and shoot the target once we've reacted
    const t = b.target;
    if (t && !drone && !s.rap) {
      const eye = getEyePosition(s, g.world);
      const q = g.players.get(t.id);
      if (q && q.alive) {
        const at = [q.state.x, q.state.y + (b.diff === BOT_DIFFICULTIES.hard && Math.random() < 0.4 ? 1.5 : 1.25) * (q.state.prone > 0.5 ? 0.25 : q.state.crouch > 0.5 ? 0.75 : 1), q.state.z];
        const dx = at[0] - eye.x, dy = at[1] - eye.y, dz = at[2] - eye.z;
        // Aim wobbles a little (less the longer we've been on target and the better the bot)
        const settle = Math.max(1, 3 - (now - b.reactAt) / 400);
        const err = b.diff.aimError * settle;
        wantYaw = yawTo(dx, dz) + Math.sin(now / 170 + b.seq) * err;
        wantPitch = Math.atan2(dy, Math.hypot(dx, dz)) + Math.cos(now / 230) * err * 0.7;
        sprint = false;
        move = move && t.dist > 8;                          // close in when far, otherwise stand and fight
        if (now > b.reactAt && Math.abs(wrap(b.yaw - wantYaw)) < 0.12 && Math.abs(b.pitch - wantPitch) < 0.12) {
          const w = WEAPONS[p.weapon.id];
          if (now < b.fireUntil) keys |= w?.auto === false ? (b.seq % 6 < 3 ? KEY.FIRE : 0) : KEY.FIRE;
          else if (now > b.pauseUntil) { b.fireUntil = now + b.diff.burstMs * rand(0.7, 1.3); b.pauseUntil = b.fireUntil + b.diff.pauseMs * rand(0.7, 1.4); }
        }
        if (b.diff !== BOT_DIFFICULTIES.easy) keys |= (Math.floor(now / 700) % 2 ? KEY.LEFT : KEY.RIGHT);   // strafe while fighting
      }
    } else if (b.look) {
      const eye = getEyePosition(s, g.world);
      const dx = b.look[0] - eye.x, dy = b.look[1] - eye.y, dz = b.look[2] - eye.z;
      wantYaw = yawTo(dx, dz); wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    } else if (b.faceYaw !== undefined && b.faceYaw !== null && s.rap) {
      wantYaw = b.faceYaw;
    } else if (b.faceYaw !== undefined && b.faceYaw !== null && b.rp?.stage === 'attach') {
      wantYaw = b.faceYaw;
    } else if (!move && b.holdAt) {
      wantYaw = b.lookAround + Math.sin(now / 1800) * 0.9;          // keep watch around the site
    }
    b.look = b.rp?.stage === 'roof' ? b.look : (b.tasks?.[0]?.started ? b.look : null);

    // Turn at a limited speed (faster when not fighting), then walk if roughly facing the way
    if (wantYaw !== null) {
      const rate = (t ? b.diff.turn : 8) * dt;
      b.yaw = wrap(b.yaw + Math.max(-rate, Math.min(rate, wrap(wantYaw - b.yaw))));
      b.pitch += Math.max(-rate, Math.min(rate, wantPitch - b.pitch));
    }
    if (move && Math.abs(wrap(wantYaw - b.yaw)) < 0.7) keys |= KEY.FORWARD | (sprint ? KEY.SPRINT : 0);
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
    if (p.weapon.ammo === 0 && p.weapon.reserve > 0) keys |= KEY.RELOAD;
    return keys | b.keysOnce;
  }
}

