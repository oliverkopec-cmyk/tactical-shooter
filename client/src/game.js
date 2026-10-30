// Owns the Three.js scene and the per-frame loop for a running match.

import * as THREE from 'three';
import {
  MAX_HEALTH, MAX_SHOT_RANGE, BARRICADE, CHARGE_REACH, REINFORCE_REACH, TEAM_REINFORCEMENTS, PHASE, ROUNDS_TO_WIN,
} from '../../shared/constants.js';
import { maskKeys } from '../../shared/rules.js';
import { getMap, DEFAULT_MAP_ID } from '../../shared/map.js';
import { getEyePosition, findVault, findRope } from '../../shared/movement.js';
import { RopeView } from './ropes.js';
import { DefuserView } from './defuserView.js';
import { PingView, WHEEL } from './pings.js';
import { VoicePlayer } from './voice.js';
import { Killcam } from './killcam.js';
import { WEAPONS } from '../../shared/weapons.js';
import { SKINS } from '../../shared/skins.js';
import { CHARMS } from '../../shared/charms.js';
import { DEFUSER } from '../../shared/modes.js';
import { currentSpread, aimDirection } from '../../shared/weapons.js';
import { World } from '../../shared/world.js';
import { raycastWorld, rayPlayer } from '../../shared/raycast.js';
import { buildMap, setupLighting } from './map.js';
import { LocalPlayer } from './player.js';
import { RemotePlayer } from './avatars.js';
import { ViewModel } from './weapons.js';
import { Effects } from './effects.js';
import { Audio } from './audio.js';
import { DestructionView } from './destruction.js';
import { DroneView } from './drones.js';
import { GadgetView } from './gadgets.js';
import { Soundscape } from './soundscape.js';
import { findOpening } from '../../shared/map.js';
import { OPERATORS } from '../../shared/operators.js';
import { UTILITIES } from '../../shared/utilities.js';
import { settings, onSettingsChange } from './settings.js';
import { DRONE } from '../../shared/drone.js';
import { actionFor, mouseCode, keyFor } from './controls.js';

const TRACER_OFFSET = new THREE.Vector3(0.2, -0.17, -0.9); // muzzle, roughly, in camera space

export class Game {
  constructor(canvas, network, ui) {
    this.canvas = canvas;
    this.network = network;
    this.ui = ui;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 300);
    this.scene.add(this.camera);
    this.sun = setupLighting(this.scene);

    this.viewModel = new ViewModel();
    this.effects = new Effects(this.scene);
    this.audio = new Audio(settings.volume);
    this.sound = new Soundscape(this);
    this.drones = new DroneView(this.scene, this.effects, this.audio);
    this.pings = new PingView(this.scene);
    this.voice = new VoicePlayer(ui);
    this.pingHold = null;              // the ping key is down: { start, dx, dy, open }
    this.mapId = null;
    this.loadMap(DEFAULT_MAP_ID);       // the map, world, destruction and gadget views follow the host's choice at match start
    this.picks = {};
    this.siteIndex = null;                 // the objective site this player knows about
    this.siteVotes = { counts: [0, 0, 0], mine: null };
    this.barricadesLeft = BARRICADE.pool;
    this.abilityCdEnd = 0;
    this.stunUntil = 0;
    this.mySkins = {};
    this.myOwned = [];
    this.roster = [];          // everyone's operator (enemies show ? until your team has seen them) and whether they're alive
    this.stunMs = 0;
    this.camView = null;      // { rec, index } while a defender watches a camera
    this.wasSelecting = false;
    this.loadout = { charges: 0, placed: false };
    this.reinforcementsLeft = TEAM_REINFORCEMENTS;
    this.reinforcing = null; // { start, ms }

    this.local = null;
    this.remotes = new Map();
    this.members = new Map(); // id -> { name, team }
    this.health = MAX_HEALTH;
    this.running = false;
    this.lockFailed = false;
    this.spectate = { index: 0, target: null, deathPos: null };
    this.round = { phase: PHASE.INTRO, endsAt: 0, round: 1, scores: { attack: 0, defense: 0 } };
    this.capture = { p: 0, c: false };
    this.spawnChoice = 1;
    this.lastFrame = performance.now();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('click', () => {
      if (!this.running) return;
      if (this.killcam) this.skipKillcam();
      else if (this.spec) this.cycleSpec();
      else if (this.local && !this.local.alive) this.cycleSpectate();
      else if (!document.pointerLockElement) this.lockPointer();
    });
    // Ctrl+click is a right-click on macOS; don't let crouch-firing open a menu.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      this.ui.setPointerLocked(locked);
      // Esc released the mouse during play: show the pause menu (settings)
      if (!locked && this.hadLock && this.running && this.round.phase !== PHASE.INTRO && !this.ui.settingsOpen) this.ui.openSettings(true);
      this.hadLock = locked;
    });
    this.ui.onSettingsClosed = () => { if (this.running && this.round.phase !== PHASE.INTRO) this.lockPointer(); };
    onSettingsChange((name, v) => {
      if (name === 'fov') { this.camera.fov = v; this.camera.updateProjectionMatrix(); }
      if (name === 'volume') this.audio.setVolume(v);
    });
    this.stats = {};
    this.runout = { left: null, detected: false };   // the defenders' run-out countdown
    this.mode = 'standard';                          // game mode of this match
    this.df = null;                                  // defuser state from the server: { c: carrier, d: dropped, p: planted }
    this.defuserAct = null;                          // my plant / disable in progress: { kind, start, ms }
    this.boardOn = false;
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => { if (actionFor(e.code) === 'scoreboard') this.boardOn = false; });
    // The scoreboard and hint toggle can be bound to mouse buttons too
    window.addEventListener('mousedown', (e) => this.onUiAction(actionFor(mouseCode(e.button)), e.target === this.canvas));
    window.addEventListener('mouseup', (e) => { if (actionFor(mouseCode(e.button)) === 'scoreboard') this.boardOn = false; });
    window.addEventListener('blur', () => { this.boardOn = false; });
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });

    network.on('snapshot', (snap) => this.onSnapshot(snap));
    network.on('shot', (msg) => this.onRemoteShot(msg));
    network.on('hitConfirm', (msg) => this.onHitConfirm(msg));
    network.on('damaged', (msg) => this.onDamaged(msg));
    network.on('kill', (msg) => this.onKill(msg));
    network.on('roundStart', (payload) => this.newRound(payload));
    network.on('spawnChoice', ({ choice }) => { this.spawnChoice = choice; });
    network.on('attackerSpawn', ({ state }) => { if (this.running) this.local?.teleport(state); });
    network.on('defenderSpawn', ({ state }) => { if (this.running) this.local?.teleport(state); });
    network.on('pingResult', ({ hit }) => this.audio.beep(hit ? 1500 : 300, hit ? 0.09 : 0.06, 0.15, 'triangle'));
    network.on('droneDestroyed', (msg) => {
      if (!this.running) return;
      this.drones.destroyed(msg);
      if (msg.owner === this.network.id) this.ui.toast('Your drone was destroyed');
    });
    network.on('phase', (info) => this.onPhase(info));
    network.on('roundEnd', (msg) => this.onRoundEnd(msg));

    // Destruction
    network.on('panelsDestroyed', ({ ids }) => {
      if (!this.running) return;
      this.destruction.destroyPanels(ids);
      const first = this.world.panels[ids[0]];
      if (first) this.sound.plasterBreak(first.center);
    });
    network.on('chargePlaced', (c) => {
      if (!this.running) return;
      this.destruction.addCharge(c);
      this.sound.placed('charge', c.pos);
    });
    network.on('chargeRemoved', ({ id }) => this.destruction.removeCharge(id));
    network.on('chargeExploded', (msg) => {
      if (!this.running) return;
      this.destruction.explode(msg, this.listener());
      const d = Math.hypot(msg.pos[0] - this.camera.position.x, msg.pos[2] - this.camera.position.z);
      this.shake = Math.max(this.shake || 0, Math.max(0, 1 - d / 15) * 0.6);
    });
    network.on('reinforced', ({ section, left }) => {
      if (!this.running) return;
      this.destruction.reinforce(section);
      this.reinforcementsLeft = left;
      if (this.reinforcing?.section === section) this.reinforcing = null;
    });
    network.on('reinforceStart', ({ section, ms }) => { this.reinforcing = { section, start: performance.now(), ms }; });
    network.on('reinforceCancel', ({ reason }) => {
      this.reinforcing = null;
      if (reason) this.ui.toast(reason);
    });
    network.on('loadout', (l) => { this.loadout = l; this.abilityCdEnd = performance.now() + (l.ability?.cdLeft || 0); });
    network.on('stats', (s) => { this.stats = s; });
    network.on('barricadeStart', ({ ms }) => { this.reinforcing = { section: null, start: performance.now(), ms, label: 'Barricading…' }; });
    network.on('runout', (r) => { this.runout = r; });
    network.on('killcam', (data) => this.startKillcam(data));
    network.on('teamPing', (p) => {
      if (!this.running) return;
      this.pings.add(p);
      this.sound.ping(p.pos, p.type);
    });
    network.on('voice', (e) => {
      if (!this.running) return;
      this.voice.say(e, this.listener(), e.id === this.network.id, this.members.get(e.id)?.name);
    });
    network.on('defuserEvent', (e) => this.onDefuserEvent(e));
    network.on('swingIn', ({ pos }) => { if (this.running) { this.sound.swingIn(pos); this.effects.debris(pos, 0x3f7a2e, 3); } });
    network.on('barricadesLeft', ({ left }) => { this.barricadesLeft = left; });
    network.on('barricadeBroken', ({ id, ids }) => {
      if (!this.running) return;
      const centers = this.gadgets.breakPanels(id, ids);
      for (const c of centers) this.effects.debris(c, 0x3f7a2e, 2);
      if (centers.length) this.sound.woodBreak(centers[0]);
    });
    network.on('melee', ({ id }) => {
      const r = this.remotes.get(id);
      if (!r) return;
      r.swing();
      this.sound.melee([r.pose.x, r.pose.y + 1.2, r.pose.z]);
    });
    network.on('siteVotes', (v) => { this.siteVotes = v; });
    network.on('siteChosen', ({ site }) => { this.siteIndex = site; });
    network.on('siteFound', ({ site }) => {
      if (!this.running) return;
      const found = this.siteIndex === null;
      this.siteIndex = site;
      if (found) {
        this.ui.banner('Objective found', this.mapDef.sites[site].name, 3200);
        this.audio.beep(1240, 0.18, 0.2, 'triangle');
      } else if (this.myTeam === 'defense') this.ui.toast('The attackers have found the objective');
    });
    network.on('opPicks', ({ picks }) => { this.picks = picks; });
    network.on('roster', (list) => { this.roster = list; this.renderRoster(); });
    network.on('gadgetAdd', (rec) => {
      if (!this.running) return;
      this.gadgets.add(rec);
      this.sound.placed(rec.kind, gadgetPosition(rec, this.world.map));
    });
    network.on('gadgetRemove', ({ kind, id }) => this.gadgets.remove(kind, id));
    network.on('cameraDestroyed', ({ pos }) => {
      if (!this.running) return;
      this.effects.debris(pos, 0x2a2d31, 6);
      this.effects.puff(pos, 0xffd27a, 0.25);
      this.audio.clank(pos);
      if (this.camView && !this.gadgets.cameras().some((c) => c.id === this.camView.rec.id)) {
        this.exitCam();
        this.ui.toast('Your camera was destroyed');
      }
    });
    network.on('stunned', ({ ms }) => {
      this.stunUntil = performance.now() + ms;
      this.stunMs = ms;
      this.audio.beep(3200, 0.5, 0.12, 'sine');
    });
    network.on('grenadeExploded', ({ pos, type }) => {
      if (!this.running) return;
      if (type === 'frag' || type === 'impact') this.effects.explosion(pos);
      else this.effects.flash(pos);
      this.audio.explosion(pos, this.listener());
    });
    network.on('smokeStart', (cloud) => {
      if (!this.running) return;
      this.gadgets.addSmoke(cloud);
      this.effects.puff(cloud.pos, 0xcfd2d6, 0.5);
      this.sound.placed('smoke', cloud.pos);
    });
    network.on('fireStart', (fire) => {
      if (!this.running) return;
      this.gadgets.addFire(fire);
      this.audio.explosion(fire.pos, this.listener());
    });
    network.on('seismicPulse', ({ pos, radius }) => {
      if (!this.running) return;
      this.effects.ring(pos, radius, 0x6fd0ff, 0.9);
      this.audio.beep(160, 0.5, 0.2, 'sine');
    });
    network.on('empBurst', ({ pos }) => {
      if (!this.running) return;
      this.effects.ring(pos, 10, 0xb06bff, 0.6);
      this.effects.flash(pos);
      this.audio.beep(900, 0.25, 0.2, 'sawtooth');
    });
    network.on('shockTriggered', ({ pos }) => {
      if (!this.running) return;
      this.effects.puff(pos, 0x39f0ff, 0.5);
      this.audio.beep(1400, 0.15, 0.2, 'square');
    });
    network.on('claymoreDestroyed', ({ pos }) => {
      if (!this.running) return;
      this.effects.debris(pos, 0x4a5a3a, 5);
      this.effects.puff(pos, 0xffd27a, 0.2);
      this.audio.clank(pos);
    });
    network.on('claymoreBlast', ({ pos }) => {
      if (!this.running) return;
      this.effects.explosion(pos);
      this.audio.explosion(pos, this.listener());
    });
    network.on('camView', (msg) => this.onCamView(msg));
    network.on('actionError', ({ msg }) => this.ui.toast(msg));
  }

  lockPointer() {
    // Newer browsers return a promise that rejects without a user gesture or
    // where pointer lock isn't supported (e.g. some embedded browsers).
    try {
      const p = this.canvas.requestPointerLock();
      p?.catch?.((err) => { if (err?.name !== 'SecurityError') this.lockFailed = true; });
    } catch { this.lockFailed = true; }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewModel?.setAspect(w / h);
  }

  /** Operator icons at the top of the screen: my team on the left, the enemy on the right. */
  renderRoster() {
    const mine = this.roster.filter((r) => r.team === this.myTeam), enemy = this.roster.filter((r) => r.team !== this.myTeam);
    this.ui.renderTopIcons(mine, enemy);
  }

  /** Build the map the match is played on (does nothing if it's already the one in the scene). */
  loadMap(id) {
    const def = getMap(id);
    if (this.mapId === def.id) return;
    if (this.mapView) {
      this.scene.remove(this.mapView.group);
      this.scene.remove(this.destruction.mesh);
      this.gadgets.clear();
    }
    this.mapId = def.id;
    this.mapDef = def;
    this.mapView = buildMap(this.scene, def);
    this.world = new World(def);
    this.ropeView?.dispose();
    this.ropeView = new RopeView(this.scene, def);
    this.destruction = new DestructionView(this.scene, this.world, this.effects, this.audio);
    this.gadgets = new GadgetView(this.scene, this.world);
    this.defuserView?.dispose();
    this.defuserView = new DefuserView(this.scene);
    const c = this.sun.shadow.camera;
    const e = def.shadowExtent || 40;
    c.left = -e; c.right = e; c.top = e; c.bottom = -e;
    c.updateProjectionMatrix();
  }

  /** Called on 'matchStart' (also for late joiners). */
  start(payload) {
    this.stop();
    this.loadMap(payload.mapId);
    if (payload.spectator) return this.startSpectator(payload);
    const myId = this.network.id;
    const me = payload.players.find((p) => p.id === myId);
    if (!me) return;

    this.myTeam = me.team;
    this.mySkins = me.skins || {};   // my equipped gun skins, drawn on my own gun
    this.myCharms = me.charms || {};   // and my gun charms
    this.myOwned = me.owned || [];   // operators I own (the select screen locks the others)
    this.members.clear();
    for (const p of payload.players) this.members.set(p.id, { name: p.name, team: p.team, owner: !!p.owner });

    this.local = new LocalPlayer({
      id: myId, team: me.team, state: me.state, weapon: me.weapon, world: this.world,
      network: this.network, camera: this.camera, canvas: this.canvas,
      onShot: (shot) => this.onLocalShot(shot),
      renderTime: () => this.network.renderTime(),
      canFireUnlocked: () => this.lockFailed,
      mask: (keys) => maskKeys(keys, this.myTeam, this.round.phase, !!this.local?.viewLocked),
      collisionWorld: () => (this.myTeam === 'defense' && this.round.phase === PHASE.PREP ? this.world.barrierView : this.world),
      onDigit: (n) => this.pickSpawn(n),
      onAction: (type) => { if (type === 'melee') { this.viewModel.melee(); this.audio.beep(260, 0.08, 0.12, 'sawtooth'); } },
    });
    this.local.onPing = (down) => this.onPingKey(down);
    this.local.onWheelMove = (dx, dy) => this.onWheelMove(dx, dy);
    this.loadRound(payload, me);

    this.running = true;
    this.lastFrame = performance.now();
    this.ui.setPointerLocked(!!document.pointerLockElement);
    this.ui.hideRoundEnd();
    this.ui.clearKillfeed();
    this.lockPointer();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Everything that resets at the start of a round (also used by late joiners). */
  loadRound(payload, me) {
    this.round = payload.round || this.round;
    this.capture = { p: 0, c: false };
    this.spawnChoice = me.spawnChoice || 1;
    this.health = me.health ?? MAX_HEALTH;
    this.loadout = { ...this.loadout, op: me.operator, charges: me.charges ?? 0, placed: !!me.placed };
    this.reinforcing = null;
    this.runout = { left: null, detected: false };
    this.setMode(payload);
    this.picks = payload.picks || {};
    if (payload.roster) { this.roster = payload.roster; this.renderRoster(); }
    this.siteIndex = payload.site ?? null;
    this.siteVotes = payload.siteVotes || { counts: [0, 0, 0], mine: null };
    this.barricadesLeft = payload.barricadesLeft ?? BARRICADE.pool;
    if (payload.stats) this.stats = payload.stats;
    this.stunUntil = 0;
    this.exitCam();

    const d = payload.destruction || {};
    this.world.applySnapshot(d.world);
    this.gadgets.clear();
    for (const rec of payload.gadgets || []) this.gadgets.add(rec);
    this.destruction.syncAll();
    this.destruction.clearCharges();
    for (const c of d.charges || []) this.destruction.addCharge(c);
    this.reinforcementsLeft = d.reinforcementsLeft ?? TEAM_REINFORCEMENTS;
    this.effects.clearDecals();

    this.exitSpectate();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    for (const p of payload.players) if (p.id !== this.network.id) this.addRemote(p);

    if (me.alive === false) {
      this.local.die();
      this.health = 0;
      const s = this.local.state;
      this.enterSpectate('Waiting for the next round', { x: s.x, y: s.y, z: s.z, yaw: this.local.aimYaw });
    } else {
      this.ui.hideDeath();
    }
  }

  /** A new round begins: fresh map, everyone back at spawn, sides possibly swapped. */
  newRound(payload) {
    if (this.spec && this.running) {
      this.members.clear();
      for (const p of payload.players) this.members.set(p.id, { name: p.name, team: p.team, owner: !!p.owner });
      this.loadRoundSpectator(payload);
      return;
    }
    if (!this.running || !this.local) return;
    const me = payload.players.find((p) => p.id === this.network.id);
    if (!me) return;
    this.myTeam = me.team;
    this.members.clear();
    for (const p of payload.players) this.members.set(p.id, { name: p.name, team: p.team, owner: !!p.owner });
    this.local.setDrone(null);
    this.drones.clear();
    this.local.respawn(me.state, me.weapon, me.team);
    this.loadRound(payload, me);
    this.ui.hideRoundEnd();
    this.audio.beep(660, 0.12, 0.15, 'triangle');
  }

  /** Keys 1-3 while attacking in prep choose the entry point; otherwise they pick a test weapon. */
  pickSpawn(n) {
    if (this.myTeam !== 'attack' || this.round.phase !== PHASE.PREP || n > this.mapDef.spawns.attack.length) return false;
    this.spawnChoice = n;
    this.network.sendSpawnChoice(n);
    return true;
  }

  onKeyDown(e) {
    if (!this.running) return;
    if (e.code === 'Escape' && this.ui.settingsOpen && this.ui.settingsInGame) { this.ui.closeSettings(); this.ui.onSettingsClosed(); return; }
    if (e.repeat || e.target instanceof HTMLInputElement) return;
    if (this.spec && this.onSpecKey(e)) return;
    if (this.killcam && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); this.skipKillcam(); return; }
    const action = actionFor(e.code);
    if (action === 'scoreboard') e.preventDefault();
    this.onUiAction(action, true);
  }

  onUiAction(action, inGame) {
    if (!this.running || !inGame) return;
    if (action === 'scoreboard') this.boardOn = true;
    else if (action === 'toggleHint') this.ui.toggleHint();
  }

  /** Short, context-sensitive reminder of what the keys do right now. */
  hintText(watching, inDrone) {
    const phase = this.round.phase, attack = this.myTeam === 'attack';
    if (phase === PHASE.INTRO) return 'Choose your operator. Anyone who hasn\'t picked is assigned one.';
    const k = keyFor;
    const move = `${k('forward')}${k('left')}${k('back')}${k('right')}`;
    const tail = `${k('scoreboard')} scoreboard · ${k('toggleHint')} hide`;
    if (!this.local.alive) return `Click to switch teammate · ${tail}`;
    if (watching) return `${k('camView')} next camera · mouse pans the feed · you can't move while watching`;
    if (inDrone) return `Drone: ${move} drive · ${k('sprint')} fast · ${k('jump')} hop · ${k('fire')} ping enemy · ${k('droneNext')} switch · 1/2/3 spawn point · ${k('scoreboard')} scoreboard`;
    const base = `${move} move · ${k('sprint')} sprint · ${k('jump')} jump · ${k('crouch')} crouch · ${k('prone')} prone · ${k('leanLeft')}/${k('leanRight')} lean · ${k('reload')} reload · ${k('primary')}/${k('secondary')} guns · ${k('utility')} utility · ${k('melee')} melee · ${k('rappel')} rappel · ${k('jump')} vault`;
    const f = OPERATORS[this.loadout.op]?.ability ? ` · ${k('ability')} ability` : '';
    if (attack) return phase === PHASE.PREP ? 'Fly your drone to find the objective · 1/2/3 choose where you appear' : `${base}${f} · ${k('breach')} breach charge · ${tail}`;
    return `${base}${f} · ${phase === PHASE.PREP ? `${k('reinforce')} reinforce · ${k('barricade')} barricade · ` : ''}${k('camView')} cameras · ${tail}`;
  }

  /** Rows for the Tab scoreboard. */
  boardRows() {
    const rows = [];
    for (const [id, m] of this.members) {
      const me = id === this.network.id;
      const r = this.remotes.get(id);
      rows.push({
        id, me, name: m.name, owner: m.owner, team: m.team,
        k: this.stats[id]?.k ?? 0, d: this.stats[id]?.d ?? 0,
        alive: me ? !!this.local?.alive : (r ? r.alive : true),
        op: m.team === this.myTeam ? this.picks[id]?.op : null,
      });
    }
    return rows;
  }

  onPhase(info) {
    this.round = info;
    if (info.phase === PHASE.PREP) {
      this.ui.banner('Prep phase', this.myTeam === 'attack' ? 'Find the objective with your drones, and choose where you appear (1/2/3)' : 'Reinforce, barricade and set up your gadgets');
    } else if (info.phase === PHASE.ACTION) {
      const defuser = this.mode === 'defuser';
      this.ui.banner('Action!', this.myTeam === 'attack'
        ? (defuser ? 'Plant the defuser at the objective, or eliminate every defender' : 'Hold the objective for 10 s, or eliminate every defender')
        : (defuser ? 'Stop the defuser being planted, and disable it if it is' : 'Stop them until the clock runs out'));
    }
    if (info.phase === PHASE.PREP && this.myTeam === 'defense') this.ui.toast('Prep: the building exits are sealed until the action phase');
    if (info.phase === PHASE.ACTION) this.audio.beep(990, 0.25, 0.2, 'square');
    else if (info.phase === PHASE.PREP) this.audio.beep(740, 0.12, 0.15, 'triangle');
  }

  onRoundEnd(msg) {
    this.round = { phase: PHASE.ROUND_END, endsAt: msg.endsAt, round: msg.round, scores: msg.scores };
    const { attack, defense } = msg.scores;
    const score = `Attack ${attack} – ${defense} Defense`;
    const side = msg.winner === 'attack' ? 'ATTACKERS' : 'DEFENDERS';
    if (msg.matchOver) {
      const won = msg.winner === this.myTeam;
      this.ui.showRoundEnd({
        title: won ? 'VICTORY' : 'DEFEAT', kind: won ? 'win' : 'lose',
        reason: `${side} take the match (first to ${ROUNDS_TO_WIN} rounds)`, score, note: 'Returning to the lobby…',
      });
    } else {
      this.ui.showRoundEnd({
        title: `${side} WIN THE ROUND`, kind: msg.winner,
        reason: msg.reason, score,
        note: msg.halftime ? 'Halftime: teams are switching sides' : 'Next round starting…',
      });
    }
    this.audio.beep(msg.winner === this.myTeam ? 880 : 220, 0.4, 0.2, 'triangle');
  }

  stop() {
    this.skipKillcam();
    this.pings.clear();
    this.closeWheel();
    this.pingHold = null;
    this.voice.stop();
    this.drones.clear();
    this.gadgets.clear();
    this.ui.showOperatorSelect(false);
    this.ui.setDroneHud(false, '');
    this.ui.hideRoundEnd();
    this.ui.hideDeath();
    this.running = false;
    this.stopSpectating();
    this.local?.dispose();
    this.local = null;
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.effects.clearDecals();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  addRemote(p) {
    if (this.remotes.has(p.id)) return this.remotes.get(p.id);
    const r = new RemotePlayer(this.scene, p, p.team === this.myTeam);
    this.remotes.set(p.id, r);
    if (p.weapon) r.setWeapon(p.weapon.id);
    if (p.state) r.push(Date.now() + (this.network.serverOffset ?? 0), { ...p.state, alive: p.alive !== false });
    return r;
  }

  /** Keep the avatar list in sync with room membership. */
  syncRoster(players) {
    for (const p of players) this.members.set(p.id, { name: p.name, team: p.team, owner: !!p.owner });
    if (!this.running) return;
    const ids = new Set(players.map((p) => p.id));
    for (const [id, r] of this.remotes) {
      if (!ids.has(id)) { r.dispose(); this.remotes.delete(id); }
    }
    for (const p of players) if (p.id !== this.network.id && !this.remotes.has(p.id)) this.addRemote(p);
  }

  /** Other players starting a vault or clipping onto a rope make a sound you can hear. */
  noticeMoves(snap) {
    for (const p of snap.players) {
      if (p.id === this.network.id) continue;
      const r = this.remotes.get(p.id);
      if (!r) continue;
      const rap = p.rk ? p.rk[0] : 0, vaulting = !!p.vt;
      if (rap && !r.rap) this.sound.ropeClip([p.x, p.y + 1, p.z]);
      if (vaulting && !r.vaulting) this.sound.vault([p.x, p.y + 0.5, p.z]);
      if (rap && Math.abs(p.y - (r.lastRopeY ?? p.y)) > 0.25) { this.sound.ropeSlide([p.x, p.y + 1, p.z]); r.lastRopeY = p.y; }
      if (!rap) r.lastRopeY = undefined;
    }
  }

  onSnapshot(snap) {
    if (!this.running) return;
    if (snap.cap) this.capture = snap.cap;
    this.noticeMoves(snap);
    if (this.mode === 'defuser' && snap.df !== undefined) {
      this.df = snap.df;
      this.defuserView.set(snap.df);
      for (const r of this.remotes.values()) r.carrier = snap.df?.c === r.id;
    }
    const myId = this.network.id;
    const drones = snap.drones || [];
    this.drones.sync(drones, myId);
    this.gadgets.syncGrenades(snap.grenades || []);
    const myDrone = drones.find((d) => d.o === myId && d.a) || null;
    this.droneJammed = !!myDrone?.j;
    if (this.local?.alive) this.local.setDrone(myDrone);
    for (const p of snap.players) {
      if (p.id === this.network.id) {
        this.local?.reconcile(p, myDrone);
        if (typeof p.hp === 'number' && this.local?.alive) this.health = p.hp;
      } else {
        const r = this.remotes.get(p.id);
        if (r) { r.spotted = !!p.sp && r.team !== this.myTeam; r.push(snap.t, p); }
      }
    }
  }

  // ---------------------------------------------------------------- combat events

  /** Our own predicted shot: draw it immediately. The server decides what it hit. */
  onLocalShot({ origin, dirs, weaponId }) {
    const muzzle = TRACER_OFFSET.clone().applyMatrix4(this.camera.matrixWorld);
    for (const d of dirs) {
      const wall = raycastWorld(this.world, origin, d, MAX_SHOT_RANGE);
      let maxT = wall ? wall.t : MAX_SHOT_RANGE;
      let hitPlayer = false;
      for (const r of this.remotes.values()) {
        if (!r.alive || r.team === this.myTeam) continue;
        const h = rayPlayer(origin, d, r.pose, maxT);
        if (h) { maxT = h.t; hitPlayer = true; }
      }
      const end = [origin[0] + d[0] * maxT, origin[1] + d[1] * maxT, origin[2] + d[2] * maxT];
      this.effects.tracer([muzzle.x, muzzle.y, muzzle.z], end);
      if (hitPlayer) this.effects.blood(end);
      else if (wall) this.effects.bulletHole(wall.point, wall.normal, wall.box.kind === 'panel' ? wall.box.id : null);
    }
    this.viewModel.fire(weaponId);
    this.audio.shot(weaponId, null, null);
  }

  onRemoteShot({ id, w, ends }) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.showFlash();
    const from = r.muzzlePosition();
    for (const end of ends) {
      this.effects.tracer(from, end);
      const d = [end[0] - from[0], end[1] - from[1], end[2] - from[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len < 0.01) continue;
      const dir = [d[0] / len, d[1] / len, d[2] / len];
      const wall = raycastWorld(this.world, from, dir, len + 0.1);
      if (wall && wall.t > len - 0.2) this.effects.bulletHole(wall.point, wall.normal, wall.box.kind === 'panel' ? wall.box.id : null);
    }
    this.audio.shot(w, from, this.listener());
  }

  onHitConfirm({ head, killed }) {
    this.ui.showHitmarker(head, killed);
    this.audio.hit(head);
  }

  onDamaged({ health, from }) {
    this.health = health;
    this.audio.hurt();
    if (!this.local) return;
    const s = this.local.state;
    const dx = from[0] - s.x, dz = from[1] - s.z;
    const yaw = this.local.aimYaw;
    const fwd = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
    const right = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
    this.ui.showDamage(Math.atan2(right, fwd));
  }

  onKill({ killer, victim, weapon, head }) {
    const myId = this.network.id;
    const name = (id) => this.members.get(id) || { name: '?', team: 'attack' };
    this.ui.addKill({ killer: name(killer), victim: name(victim), weapon, head, mine: killer === myId || victim === myId });
    if (killer === myId) this.audio.kill();
    const victimAvatar = this.remotes.get(victim);
    if (victimAvatar) victimAvatar.alive = false; // hide now rather than at the next snapshot
    if (victim === myId && this.local) {
      this.local.die();
      this.reinforcing = null;
      this.exitCam();
      this.health = 0;
      const s = this.local.state;
      this.enterSpectate(`Eliminated by ${name(killer).name}`, { x: s.x, y: s.y, z: s.z, yaw: this.local.aimYaw });
      if (this.pendingKillcam) { const k = this.pendingKillcam; this.pendingKillcam = null; this.startKillcam(k); }
    }
  }

  /** Dead (or joined mid-round): watch teammates until the round ends. */
  enterSpectate(title, deathPos) {
    this.spectate = { index: 0, target: null, deathPos };
    this.ui.showDeath(title, '');
    this.cycleSpectate(true);
  }

  exitSpectate() {
    if (this.spectate.target) this.spectate.target.hiddenForSpectate = false;
    this.spectate = { index: 0, target: null, deathPos: null };
  }

  /** The match's game mode and the defuser's state at the start of a round. */
  setMode(payload) {
    this.skipKillcam?.();
    this.pings?.clear();
    this.closeWheel();
    this.mode = payload.mode || 'standard';
    this.df = payload.defuser || null;
    this.defuserAct = null;
    this.defuserView?.set(this.df);
    this.nextBeep = 0;
  }

  /** Server events for the Defuser mode: who carries it, planting, disabling, going off. */
  onDefuserEvent(e) {
    if (!this.running) return;
    const myId = this.network.id, name = (id) => this.members.get(id)?.name || 'Someone';
    const pos = (e.pos || [0, 0, 0]);
    switch (e.type) {
      case 'carrier':
        if (e.carrier === myId) this.ui.banner('You carry the defuser', `Take it to the objective and hold ${keyFor('interact')} to plant it`, 3200);
        else this.ui.toast(`${name(e.carrier)} ${e.pickedUp ? 'picked up' : 'carries'} the defuser`);
        if (e.pickedUp) this.audio.beep(900, 0.1, 0.2, 'triangle');
        break;
      case 'dropped': this.ui.banner('Defuser dropped', 'Pick it up: walk over it (the yellow beacon)', 3000); this.audio.beep(300, 0.25, 0.25, 'sawtooth'); break;
      case 'carrierDown': this.ui.toast('The defuser carrier is down'); break;
      case 'planting': this.ui.banner('The defuser is being planted!', `${e.by} is planting it at the objective`, 2600); this.audio.beep(1100, 0.2, 0.3, 'square'); break;
      case 'disabling': this.ui.banner('They are disabling the defuser!', `${e.by} is disabling it`, 2600); this.audio.beep(1100, 0.2, 0.3, 'square'); break;
      case 'actStart': this.defuserAct = { kind: e.kind, start: performance.now(), ms: e.ms }; this.nextTick = 0; break;
      case 'actEnd': this.defuserAct = null; break;
      case 'planted':
        this.ui.banner('DEFUSER PLANTED', `${e.by} planted it. Defenders have ${Math.round(e.ms / 1000)} seconds to disable it`, 3600);
        this.sound.defuserPlanted(pos);
        break;
      case 'disabled': this.ui.banner('DEFUSER DISABLED', 'The defenders win the round', 3200); this.sound.defuserDisabled(pos); break;
      case 'detonated': this.ui.banner('THE DEFUSER WENT OFF', 'The attackers win the round', 3200); this.sound.defuserBoom(pos); this.effects.explosion(pos); this.shake = 1.2; break;
      default:
    }
  }

  // ---------------------------------------------------------------- killcam

  /** I died: replay it from the killer's eyes, then spectate as usual. */
  startKillcam(data) {
    if (!this.running || !this.local || !data?.trail?.length) return;
    if (this.local.alive) { this.pendingKillcam = data; return; }   // the kill message hasn't arrived yet: start it then
    this.killcam?.finish();
    this.killcam = new Killcam(this, data);
    const w = WEAPONS[data.weapon], skin = SKINS[data.skin], charm = CHARMS[data.charm];
    this.ui.showKillcam({
      name: data.name, op: OPERATORS[data.op]?.name || 'Unknown', team: data.team, health: data.health,
      gun: w ? w.name : '', skin: skin ? skin.name : 'Default', charm: charm ? charm.name : null,
      skipKey: 'Click or Space to skip',
    });
  }

  skipKillcam() {
    if (!this.killcam) return;
    this.killcam.finish();
    this.killcam = null;
    this.ui.hideKillcam();
    this.viewModel.visible = false;
  }

  // ---------------------------------------------------------------- team pings

  /** The ping key: a tap pings what you aim at, holding it opens the wheel. */
  onPingKey(down) {
    if (!this.running || !this.local?.alive) return;
    if (down) { this.pingHold = { start: performance.now(), dx: 0, dy: 0, open: false }; return; }
    const h = this.pingHold;
    this.pingHold = null;
    if (!h) return;
    if (!h.open) { this.network.sendTeamPing('auto'); return; }
    const choice = this.wheelChoice(h);
    this.closeWheel();
    if (choice) this.network.sendTeamPing(choice);
  }

  /** Called every frame: a held ping key opens the wheel after a moment. */
  updatePingWheel() {
    const h = this.pingHold;
    if (!h || h.open || performance.now() - h.start < 220) return;
    h.open = true;
    if (this.local) this.local.lookFrozen = true;
    this.ui.showWheel(WHEEL, null);
  }

  onWheelMove(dx, dy) {
    const h = this.pingHold;
    if (!h?.open) return;
    h.dx += dx; h.dy += dy;
    const len = Math.hypot(h.dx, h.dy);
    if (len > 140) { h.dx *= 140 / len; h.dy *= 140 / len; }
    this.ui.showWheel(WHEEL, this.wheelChoice(h));
  }

  /** The wheel choice the mouse points at (null near the middle). Choices go clockwise from the top. */
  wheelChoice(h) {
    if (Math.hypot(h.dx, h.dy) < 25) return null;
    const angle = Math.atan2(h.dx, -h.dy);                  // 0 = up, clockwise
    const step = (Math.PI * 2) / WHEEL.length;
    return WHEEL[((Math.round(angle / step) % WHEEL.length) + WHEEL.length) % WHEEL.length];
  }

  closeWheel() {
    if (this.local) this.local.lookFrozen = false;
    this.ui?.hideWheel?.();
  }

  /** The planted defuser beeps, faster and faster as its time runs out. */
  beepDefuser() {
    const p = this.df?.p;
    if (!p || this.mode !== 'defuser') return;
    const left = this.defuserView.left ?? 0;
    const now = performance.now();
    if (now < (this.nextBeep || 0) || left <= 0) return;
    this.nextBeep = now + 180 + 820 * Math.min(1, left / 45000);
    this.sound.defuserBeep(p.pos, 1 - Math.min(1, left / 45000));
  }

  /** Draw a rope for everyone hanging on one (you included). */
  drawRopes(local) {
    const rv = this.ropeView;
    if (!rv) return;
    rv.begin();
    if (local?.alive && local.state.rap) rv.draw(local.state.rap, local.state.x, local.state.y, local.state.z);
    for (const r of this.remotes.values()) if (r.alive && r.rap) rv.draw(r.rap, r.pose.x, r.pose.y, r.pose.z);
    rv.end();
  }

  // ---------------------------------------------------------------- admin spectator

  /** An admin watching invisibly: no body, a free camera, and a click to follow any player. */
  startSpectator(payload) {
    this.myTeam = 'attack';
    this.members.clear();
    for (const p of payload.players) this.members.set(p.id, { name: p.name, team: p.team, owner: !!p.owner });
    this.local = null;
    const site = this.mapDef.sites[payload.site ?? 0];
    this.spec = {
      free: { x: site?.x ?? 0, y: (site?.y ?? 0) + 6, z: site?.z ?? 0, yaw: 0, pitch: -0.5 },
      target: null, index: -1, keys: new Set(), speed: 8,
    };
    if (!this.specListeners) {
      this.specListeners = {
        keydown: (e) => { if (this.spec) this.spec.keys.add(e.code); },
        keyup: (e) => { if (this.spec) this.spec.keys.delete(e.code); },
        mousemove: (e) => {
          if (!this.spec || !document.pointerLockElement || this.spec.target) return;
          const k = 0.0022 * settings.sensitivity, f = this.spec.free;
          f.yaw -= e.movementX * k;
          f.pitch = Math.max(-1.5, Math.min(1.5, f.pitch - e.movementY * k));
        },
      };
      for (const [name, fn] of Object.entries(this.specListeners)) window.addEventListener(name, fn);
    }
    this.loadRoundSpectator(payload);
    this.running = true;
    this.lastFrame = performance.now();
    this.ui.setPointerLocked(!!document.pointerLockElement);
    this.ui.setSpectatorBar(true);
    this.ui.hideRoundEnd();
    this.ui.clearKillfeed();
    this.lockPointer();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** A round's worth of state for the spectator: same as a player's, but everyone is a remote and nothing is hidden. */
  loadRoundSpectator(payload) {
    this.round = payload.round || this.round;
    this.setMode(payload);
    this.capture = { p: 0, c: false };
    this.picks = payload.picks || {};
    if (payload.roster) { this.roster = payload.roster; this.renderRoster(); }
    this.siteIndex = payload.site ?? null;
    if (payload.stats) this.stats = payload.stats;
    const d = payload.destruction || {};
    this.world.applySnapshot(d.world);
    this.gadgets.clear();
    for (const rec of payload.gadgets || []) this.gadgets.add(rec);
    this.destruction.syncAll();
    this.destruction.clearCharges();
    for (const c of d.charges || []) this.destruction.addCharge(c);
    this.effects.clearDecals();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    if (this.spec) this.spec.target = null;
    for (const p of payload.players) this.addRemote(p);
    this.ui.hideDeath();
  }

  stopSpectating() {
    if (!this.spec) return;
    this.spec = null;
    this.ui.setSpectatorBar(false);
    for (const [name, fn] of Object.entries(this.specListeners || {})) window.removeEventListener(name, fn);
    this.specListeners = null;
  }

  /** Click: follow the next living player (after the last one, back to the free camera). */
  cycleSpec() {
    const list = [...this.remotes.values()].filter((r) => r.alive);
    if (this.spec.target) this.spec.target.hiddenForSpectate = false;
    this.spec.index++;
    if (this.spec.index >= list.length) { this.spec.index = -1; this.spec.target = null; return; }
    this.spec.target = list[this.spec.index];
    this.spec.target.hiddenForSpectate = true;
  }

  onSpecKey(e) {
    if (e.code === 'Backspace') { this.onSpectateExit?.(); return true; }
    if (e.code === 'KeyF') {   // back to the free camera
      if (this.spec.target) this.spec.target.hiddenForSpectate = false;
      const t = this.spec.target;
      if (t) Object.assign(this.spec.free, { x: t.pose.x, y: t.pose.y + 1.6, z: t.pose.z, yaw: t.pose.yaw, pitch: t.pose.pitch });
      this.spec.target = null; this.spec.index = -1;
      return true;
    }
    return false;
  }

  spectatorFrame(now, dt) {
    const sp = this.spec;
    const rt = this.network.renderTime();
    for (const r of this.remotes.values()) r.update(rt, dt);
    if (sp.target && !sp.target.alive) { sp.target.hiddenForSpectate = false; sp.target = null; sp.index = -1; }
    if (sp.target) {
      const eye = getEyePosition(sp.target.pose, this.world);
      this.camera.position.set(eye.x, eye.y, eye.z);
      this.camera.rotation.set(sp.target.pose.pitch, sp.target.pose.yaw, 0, 'YXZ');
    } else {
      const f = sp.free, k = sp.keys;
      const speed = (k.has('ShiftLeft') ? 3 : 1) * sp.speed * dt;
      const fx = -Math.sin(f.yaw), fz = -Math.cos(f.yaw), rx = Math.cos(f.yaw), rz = -Math.sin(f.yaw);
      const mv = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0), st = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      f.x += (fx * mv + rx * st) * speed;
      f.z += (fz * mv + rz * st) * speed;
      f.y += ((k.has('Space') ? 1 : 0) - (k.has('KeyC') || k.has('ControlLeft') ? 1 : 0)) * speed;
      this.camera.position.set(f.x, f.y, f.z);
      this.camera.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
    }
    this.viewModel.visible = false;
    this.gadgets.watchCamera(null);
    this.ui.setHint(sp.target
      ? `Watching ${sp.target.name} · click: next player · F: free camera · ${keyFor('scoreboard')} scoreboard · Backspace: stop spectating`
      : 'Free camera: WASD move · Space/C up/down · Shift fast · click: follow a player · Backspace: stop spectating');
    this.ui.setSpectatorInfo(sp.target ? `Watching ${sp.target.name}` : 'Free camera');
    this.ui.renderBoard(this.boardOn, this.boardRows(), this.round.scores);
    this.defuserView.update(dt);
    this.pings.update();
    this.drawRopes(null);
    this.drones.update(dt);
    this.gadgets.update(dt);
    this.sound.update(dt);
    this.updateRoundHud();
    this.destruction.update(dt);
    this.effects.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- spectating

  spectateCandidates() {
    return [...this.remotes.values()].filter((r) => r.alive && r.team === this.myTeam);
  }

  cycleSpectate(reset = false) {
    const list = this.spectateCandidates();
    if (this.spectate.target) this.spectate.target.hiddenForSpectate = false;
    if (!list.length) { this.spectate.target = null; return; }
    this.spectate.index = reset ? 0 : (this.spectate.index + 1) % list.length;
    this.spectate.target = list[this.spectate.index];
    this.spectate.target.hiddenForSpectate = true;
  }

  updateSpectateCamera(now) {
    let target = this.spectate.target;
    if (target && !target.alive) { this.cycleSpectate(true); target = this.spectate.target; }

    if (target) {
      const eye = getEyePosition(target.pose, this.world);
      this.camera.position.set(eye.x, eye.y, eye.z);
      this.camera.rotation.set(target.pose.pitch, target.pose.yaw, 0, 'YXZ');
      this.ui.setDeathSub(`Spectating ${target.name} · click to switch teammate`);
    } else {
      // Nobody to watch: look down at where we fell.
      const d = this.spectate.deathPos;
      if (d) {
        // Above and behind where we fell, but never inside a ceiling or a wall: stop short of whatever is in the way
        const from = [d.x, d.y + 1.2, d.z];
        const off = [Math.sin(d.yaw) * 3, 2.3, Math.cos(d.yaw) * 3];
        const len = Math.hypot(...off), dir = off.map((v) => v / len);
        const hit = raycastWorld(this.world, from, dir, len);
        const t = hit ? Math.max(0.2, hit.t - 0.35) : len;
        this.camera.position.set(from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t);
        this.camera.lookAt(d.x, d.y + 0.5, d.z);
      }
      this.ui.setDeathSub('No teammates alive to spectate');
    }
  }

  /** Gadget counters, the "press G / V" prompt for the wall you're aiming at, and progress. */
  updateGadgetHud(now) {
    const local = this.local;
    const attack = this.myTeam === 'attack';
    let prompt = '';
    if (local.alive) {
      const eye = getEyePosition(local.state, this.world);
      const reach = attack ? CHARGE_REACH : REINFORCE_REACH;
      const hit = raycastWorld(this.world, [eye.x, eye.y, eye.z], aimDirection(local.aimYaw, local.aimPitch), reach);
      const panel = hit?.box.kind === 'panel' ? hit.box : null;
      const phase = this.round.phase;
      if (attack && phase !== PHASE.ACTION) {
        prompt = '';
      } else if (!attack && phase !== PHASE.PREP) {
        prompt = '';
      } else if (attack && !this.loadout.placed && panel) {
        if (this.world.isReinforcedPanel(panel.id)) prompt = 'Reinforced wall: breach charges won\'t break it';
        else if (this.loadout.charges > 0) prompt = `Press ${keyFor('breach')} to plant a breach charge`;
      } else if (!attack && panel && !this.reinforcing) {
        const section = this.world.sections[panel.sectionId];
        if (this.world.reinforced[section.id]) prompt = 'Reinforced';
        else if (section.reinforceable && this.reinforcementsLeft > 0) prompt = `Press ${keyFor('reinforce')} to reinforce this wall`;
      }
    }
    // Defenders in prep: aiming at a bare doorway or window offers a barricade
    if (!prompt && !attack && local.alive && this.round.phase === PHASE.PREP && !this.reinforcing && this.barricadesLeft > 0) {
      const eye = getEyePosition(local.state, this.world);
      const o = findOpening(this.mapDef, [eye.x, eye.y, eye.z], aimDirection(local.aimYaw, local.aimPitch), BARRICADE.reach);
      if (o && !this.gadgets.hasBarricade(o.id)) prompt = `Press ${keyFor('barricade')} to barricade (${this.barricadesLeft} left)`;
    }
    // Defuser mode: what the carrier or a defender can do here
    if (!prompt && this.mode === 'defuser' && local.alive && this.round.phase === PHASE.ACTION) {
      const site = this.siteIndex !== null ? this.mapDef.sites[this.siteIndex] : null;
      const inZone = site && Math.hypot(local.state.x - site.x, local.state.z - site.z) <= site.zoneRadius && Math.abs(local.state.y - site.y) < 2.2;
      if (this.myTeam === 'attack' && this.df?.c === this.network.id && !this.df.p) prompt = inZone ? `Hold ${keyFor('interact')} (stand still) to plant the defuser` : 'You carry the defuser: take it to the objective';
      else if (this.myTeam === 'defense' && this.df?.p && inZone) prompt = `Hold ${keyFor('interact')} (stand still) to disable the defuser`;
    }
    // Rope and vault prompts (action phase, nothing more important on screen)
    if (!prompt && local.alive && this.round.phase === PHASE.ACTION && !this.camView && !this.reinforcing) {
      const st = local.state;
      if (st.rap) prompt = `${keyFor('forward')}/${keyFor('back')} climb · ${keyFor('left')}/${keyFor('right')} sideways · ${keyFor('jump')} at a window swings in · ${keyFor('flip')} flip · ${keyFor('rappel')} let go`;
      else if (st.vaultT > 0) prompt = '';
      else if (findRope(st, this.world)) prompt = `Press ${keyFor('rappel')} to rappel`;
      else if (st.onGround && findVault(st, this.world)) prompt = `Press ${keyFor('jump')} to vault`;
    }
    this.ui.setPrompt(prompt);

    let progress = null, label = this.reinforcing?.label || 'Reinforcing…';
    if (this.reinforcing) progress = Math.min(1, (now - this.reinforcing.start) / this.reinforcing.ms);
    else if (this.defuserAct) {
      progress = Math.min(1, (performance.now() - this.defuserAct.start) / this.defuserAct.ms);
      label = this.defuserAct.kind === 'plant' ? 'Planting the defuser…' : 'Disabling the defuser…';
      if (performance.now() >= (this.nextTick || 0)) { this.nextTick = performance.now() + 450; this.audio.beep(this.defuserAct.kind === 'plant' ? 700 : 520, 0.05, 0.14, 'square'); }
    }
    this.ui.setProgress(progress, label);
    this.beepDefuser();

    // Operator + ability panel
    const op = OPERATORS[this.loadout.op];
    const lines = [];
    const cfg = op?.ability, ab = this.loadout.ability;
    if (cfg && ab) {
      let value;
      if (cfg.cooldown) {
        const cd = Math.ceil(Math.max(0, this.abilityCdEnd - performance.now()) / 1000);
        value = cd > 0 ? `recharging ${cd}s` : 'ready';
      } else {
        value = `×${ab.charges}`;
        if (ab.deployed) value += cfg.id === 'shield' ? ` · deployed, ${keyFor('ability')} picks up` : ` · planted, ${keyFor('ability')} detonates`;
      }
      lines.push({ key: keyFor('ability'), label: cfg.name, value });
    }
    const util = this.loadout.utility;
    if (util && UTILITIES[util.id]) lines.push({ key: keyFor('utility'), label: UTILITIES[util.id].name, value: `×${util.charges}` });
    if (attack) lines.push({ key: keyFor('breach'), label: 'Breach charge', value: this.loadout.placed ? `planted, ${keyFor('breach')} detonates` : `×${this.loadout.charges}` });
    else {
      lines.push({ key: keyFor('reinforce'), label: 'Team reinforcements', value: `${this.reinforcementsLeft}` });
      lines.push({ key: keyFor('barricade'), label: 'Barricades', value: `${this.barricadesLeft}` });
      lines.push({ key: keyFor('camView'), label: 'Cameras', value: `${this.gadgets.cameras().length}` });
    }
    this.ui.updateGadgets(op, lines, local.alive);

    // Stun white-out
    const stunLeft = Math.max(0, (this.stunUntil - performance.now()) / 1000), total = this.stunMs / 1000;
    this.ui.setStun(stunLeft > total * 0.5 ? 1 : stunLeft / (total * 0.5 || 1));
  }

  // ---------------------------------------------------------------- hidden cameras (defenders)

  onCamView({ index, cam, count }) {
    if (!this.local) return;
    if (cam) {
      this.camView = { rec: cam, index, count };
      this.local.lockView(true);
    } else this.exitCam();
  }

  exitCam() {
    this.camView = null;
    this.local?.lockView(false);
  }

  /** Place the render camera at the watched feed; the mouse pans a little around its fixed heading. */
  applyCamView() {
    const { rec } = this.camView;
    const lock = this.local.viewLocked;
    if (!lock) return;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    const baseYaw = Math.atan2(-rec.dir[0], -rec.dir[2]);
    const basePitch = Math.asin(Math.max(-1, Math.min(1, rec.dir[1])));
    this.camera.position.set(rec.pos[0], rec.pos[1], rec.pos[2]);
    this.camera.rotation.set(
      clamp(basePitch + (this.local.pitch - lock.rawPitch), 1.2),
      baseYaw + clamp(wrap(this.local.yaw - lock.rawYaw), 0.9), 0, 'YXZ',
    );
  }

  droneInfo() {
    const mine = [...this.drones.drones.values()].filter((e) => e.target.o === this.network.id);
    const idx = mine.findIndex((e) => e.target.id === this.local.droneId) + 1;
    const hp = mine.find((e) => e.target.id === this.local.droneId)?.target.hp ?? 0;
    return `Drone ${idx}/${mine.length} · integrity ${Math.round((hp / DRONE.hp) * 100)}% · ${keyFor('forward')}${keyFor('left')}${keyFor('back')}${keyFor('right')} drive · ${keyFor('sprint')} fast · ${keyFor('jump')} hop · ${keyFor('fire')}: ping enemy${mine.length > 1 ? ` · ${keyFor('droneNext')} switch drone` : ''}`;
  }

  updateRoundHud() {
    const { phase, endsAt, scores } = this.round;
    const serverNow = Date.now() + (this.network.serverOffset ?? 0);
    const left = Math.max(0, Math.ceil((endsAt - serverNow) / 1000));
    const labels = { intro: 'OPERATOR SELECT', prep: 'PREP PHASE', action: 'ACTION', roundEnd: 'ROUND OVER' };
    this.ui.updateRound({
      attack: scores.attack, defense: scores.defense,
      time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
      label: this.df?.p && phase === PHASE.ACTION ? 'DEFUSER PLANTED' : `ROUND ${this.round.round} · ${labels[phase] || ''}`,
      urgent: phase === PHASE.ACTION && (left <= 30 || !!this.df?.p),
      myTeam: this.myTeam,
    });
    const defuserMode = this.mode === 'defuser';
    const capturing = !defuserMode && phase === PHASE.ACTION && this.capture.p > 0;
    this.ui.setCapture(capturing ? this.capture.p : null, this.capture.c);
    // Only the site you know about is marked on the floor
    this.mapView.sites.forEach((s, i) => { s.holder.visible = i === this.siteIndex; });
    const zone = this.mapView.sites[this.siteIndex]?.mat;
    if (zone) {
      zone.color.set(this.capture.c ? 0xff7a45 : capturing ? 0xffee88 : 0xffc43a);
      zone.opacity = capturing ? 0.9 : 0.55;
    }
    const known = this.siteIndex !== null ? this.mapDef.sites[this.siteIndex] : null;
    const goal = defuserMode ? (this.myTeam === 'attack' ? 'plant the defuser there' : 'stop the defuser') : null;
    this.ui.setSiteChip(known ? `Objective: ${known.name}${goal ? ` · ${goal}` : ''}` : (this.myTeam === 'attack' ? 'Objective: unknown. Find it with your drones' : ''));
  }

  /** Where you are listening from: your eyes, a drone, a camera feed or the player you spectate. */
  listener() {
    const c = this.camera;
    return { x: c.position.x, y: c.position.y, z: c.position.z, yaw: c.rotation.y };
  }

  /** false if a wall stands between you and a sound at pos (it will be quieter and duller). */
  soundClear(pos) {
    const c = this.camera.position;
    const v = [pos[0] - c.x, pos[1] - c.y, pos[2] - c.z];
    const dist = Math.hypot(...v);
    if (dist < 1.5) return true;
    const hit = raycastWorld(this.world, [c.x, c.y, c.z], v.map((k) => k / dist), dist);
    return !hit || hit.t > dist - 0.4;
  }

  // ---------------------------------------------------------------- frame loop

  frame(now) {
    if (!this.running) return;
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.spec) return this.spectatorFrame(now, dt);
    const local = this.local;

    local.update(dt);
    const rt = this.network.renderTime();
    for (const r of this.remotes.values()) r.update(rt, dt);
    if (!local.alive) this.updateSpectateCamera(now);
    const replaying = this.killcam ? this.killcam.update(dt) : false;
    if (this.killcam && !replaying) this.skipKillcam();
    if (replaying) for (const r of this.remotes.values()) r.root.visible = false;   // only the replay is shown

    // View model and HUD
    const s = local.state;
    const inDrone = !!local.droneState;
    // Attackers have no body in prep: no gun, and (if the drone is lost) a view from their entry point
    const noBody = this.myTeam === 'attack' && this.round.phase === PHASE.PREP;
    if (noBody && !inDrone && local.alive) {
      const sp = this.mapDef.spawns.attack[this.spawnChoice - 1];
      this.camera.position.set(sp.x, sp.y + 1.62, sp.z);
      this.camera.rotation.set(0, sp.yaw, 0, 'YXZ');
    }
    const watching = !!this.camView && local.alive;
    this.viewModel.visible = replaying || (local.alive && !inDrone && !noBody && !this.camView);
    this.gadgets.watchCamera(watching ? this.camView.rec.id : null);
    if (watching) this.applyCamView();

    // Operator select: free the mouse so the cards can be clicked
    const selecting = this.round.phase === PHASE.INTRO;
    if (selecting && !this.wasSelecting && document.pointerLockElement) document.exitPointerLock();
    this.wasSelecting = selecting;
    const names = {};
    for (const [id, m] of this.members) names[id] = m.name;
    const left = Math.max(0, Math.ceil((this.round.endsAt - (Date.now() + (this.network.serverOffset ?? 0))) / 1000));
    this.ui.renderSiteVote(selecting && local.alive, {
      sites: this.mapDef.sites, team: this.myTeam, counts: this.siteVotes.counts, mine: this.siteVotes.mine, onVote: (i) => { this.siteVotes = { ...this.siteVotes, mine: i }; this.network.voteSite(i); },
    });
    this.ui.showOperatorSelect(selecting && local.alive, {
      team: this.myTeam, picks: this.picks, names, myId: this.network.id, myOp: this.loadout.op,
      myUtility: this.loadout.utility?.id, owned: this.myOwned,
      timeText: `${left}s`, onPick: (opId) => this.network.pickOperator(opId), onUtility: (id) => this.network.pickUtility(id),
    });
    this.ui.updateSpawnPicker(noBody && local.alive, this.spawnChoice, this.mapDef.spawns.attack);
    this.defuserView.update(dt);
    this.pings.update();
    this.updatePingWheel();
    this.drawRopes(local);
    this.ui.setRunOut(local.alive && this.myTeam === 'defense' && this.round.phase === PHASE.ACTION ? this.runout : null);
    this.drones.update(dt);
    this.gadgets.update(dt);
    this.ui.setDroneHud(
      inDrone || watching,
      watching ? `Camera ${this.camView.index + 1}/${this.gadgets.cameras().length} · ${keyFor('camView')} next camera · mouse pans · you can't move while watching` : (inDrone ? this.droneInfo() : ''),
      watching ? '● CAMERA' : '● DRONE CAM',
      inDrone && this.droneJammed,
    );
    this.ui.setLowHealth(local.alive && this.health > 0 && this.health <= 30);
    this.ui.setHint(this.hintText(watching, inDrone));
    this.ui.renderBoard(this.boardOn, this.boardRows(), this.round.scores);

    const w = local.weaponDef;
    if (!replaying) this.viewModel.setWeapon(local.weapon.id, this.mySkins[local.weapon.id], this.myCharms?.[local.weapon.id]);
    if (!replaying) this.viewModel.update(dt, {
      speed: Math.hypot(s.vx, s.vz),
      sprinting: local.sprinting,
      crouch: Math.max(s.crouch, s.prone || 0),
      lean: s.lean,
      reloadFrac: local.weapon.reload > 0 ? 1 - local.weapon.reload / w.reloadTime : -1,
    });
    this.sound.update(dt);

    const spread = currentSpread(local.weapon, s);
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    this.ui.setCrosshairGap(inDrone ? 5 : 3 + (Math.tan(spread) / Math.tan(halfFov)) * (window.innerHeight / 2));
    this.ui.updateCombat({ health: this.health, weapon: local.weapon, alive: local.alive, slotKeys: [keyFor('primary'), keyFor('secondary')] });

    this.updateGadgetHud(now);
    this.updateRoundHud();
    this.destruction.update(dt);
    this.effects.update(dt);

    // Explosion camera shake
    if (this.shake > 0.001 && local.alive) {
      this.camera.rotation.x += (Math.random() - 0.5) * this.shake * 0.08;
      this.camera.rotation.y += (Math.random() - 0.5) * this.shake * 0.08;
      this.shake *= Math.exp(-6 * dt);
    }
    this.renderer.render(this.scene, this.camera);
    this.viewModel.render(this.renderer);
    this.ui.updateStats(dt, this.network.ping, local);
    requestAnimationFrame((t) => this.frame(t));
  }
}

/** A rough centre for any gadget record, for positioning its placement sound. */
function gadgetPosition(rec, map) {
  if (rec.pos) return rec.pos;
  if (rec.kind === 'wire') return [rec.x, rec.y + 0.2, rec.z];
  if (rec.kind === 'barricade') {
    const o = map.openings.find((x) => x.id === rec.openingId);
    if (o) return o.axis === 'x' ? [(o.from + o.to) / 2, (o.y0 + o.y1) / 2, o.fixed] : [o.fixed, (o.y0 + o.y1) / 2, (o.from + o.to) / 2];
  }
  return [0, 0, 0];
}
