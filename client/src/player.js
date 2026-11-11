// The local player: keyboard/mouse input, client-side prediction of movement
// and weapon state against the shared simulation code, and reconciliation with
// authoritative server snapshots.

import {
  KEY, MAX_INPUT_DT, LEAN_ROLL, FEEL, WALK_SPEED,
} from '../../shared/constants.js';
import { stepDrone, copyDroneState, droneEye, DRONE_KEYS } from '../../shared/drone.js';
import { createPlayerState, copyPlayerState, stepPlayer, getEyePosition, weaponInput, rightVec } from '../../shared/movement.js';
import {
  WEAPONS, createWeaponState, copyWeaponState, stepWeapon, currentSpread, shotDirections, gunMobility, gunAimTime, gunFor,
} from '../../shared/weapons.js';

import { Recoil } from './recoil.js';
import { settings, onSettingsChange } from './settings.js';
import { actionFor, mouseCode } from './controls.js';

// Held actions become input bits, simulated on both sides (keybinds map keys to actions)
const HOLD_BITS = {
  forward: KEY.FORWARD, back: KEY.BACK, left: KEY.LEFT, right: KEY.RIGHT,
  sprint: KEY.SPRINT, jump: KEY.JUMP, crouch: KEY.CROUCH,
  leanLeft: KEY.LEAN_LEFT, leanRight: KEY.LEAN_RIGHT, fire: KEY.FIRE, reload: KEY.RELOAD,
  rappel: KEY.RAPPEL, flip: KEY.FLIP, interact: KEY.INTERACT, aim: KEY.AIM,
};
// One-shot actions sent to the server as events
const EVENT_ACTIONS = new Set(['breach', 'reinforce', 'droneNext', 'ability', 'utility', 'camView', 'barricade']);
// Keys 1-3 choose the attacker entry point during prep (fixed: not rebindable)
const DIGIT_KEYS = { Digit1: 1, Digit2: 2, Digit3: 3 };
// Keys that place something: they're held while it's placed, and letting go stops it (Stage 27)
const PLACE_ACTIONS = new Set(['utility', 'ability', 'breach', 'barricade', 'reinforce']);

const MOUSE_SENSITIVITY = 0.0022;
const TWO_PI = Math.PI * 2;
const MAX_VIEW_PITCH = 1.55;

const wrapAngle = (a) => ((a % TWO_PI) + TWO_PI) % TWO_PI;
const clampPitch = (p) => Math.max(-MAX_VIEW_PITCH, Math.min(MAX_VIEW_PITCH, p));

export class LocalPlayer {
  /**
   * opts.onShot({ origin, dirs, weaponId }) is called for each predicted shot.
   * opts.renderTime() gives the time remote players are currently drawn at.
   * opts.canFireUnlocked() says whether clicks should fire without pointer lock.
   */
  constructor({ id, team, state, weapon, world, network, camera, canvas, onShot, renderTime, canFireUnlocked, onAction, mask, collisionWorld, onDigit, onDry }) {
    this.id = id;
    this.team = team;
    this.world = world;
    this.network = network;
    this.camera = camera;
    this.canvas = canvas;
    this.onShot = onShot;
    this.onDry = onDry;
    this.renderTime = renderTime;
    this.canFireUnlocked = canFireUnlocked;
    this.onAction = onAction;
    this.collisionWorld = collisionWorld || (() => world);   // defenders in prep are walled into the building
    this.onDigit = onDigit;                                  // lets the game claim keys 1-3 (spawn choice)
    this.mask = mask || ((k) => k);   // which inputs count in the current round phase

    this.state = copyPlayerState(state || createPlayerState({ x: 0, y: 0, z: 0 }));
    this.weapon = copyWeaponState(weapon || createWeaponState());
    this.alive = true;
    this.yaw = this.state.yaw;
    this.pitch = this.state.pitch;
    this.recoil = new Recoil();   // recoil.pitch / yaw move the aim (and the bullets); recoil.view() is camera-only
    this.wasFire = false;
    this.keys = 0;
    this.tapped = 0;     // keys pressed since the last frame, so quick taps aren't lost
    this.proneOn = false; // prone is a toggle: the PRONE bit is sent while it's on
    this.leanOn = 0;      // toggle lean: -1 left, 0 upright, 1 right (sent as the lean bits)
    this.aimOn = false;   // toggle aim: the AIM bit is sent while it's on
    this.adsZoom = 1;     // zoom of the drawn gun's sights (set by the game), for the aiming sensitivity
    this.wantSlot = 1;    // which gun is drawn: 1 primary, 2 secondary (sent with every input)
    this.meleeReady = 0;
    this.viewLocked = null;  // while watching a camera: the body keeps this facing
    this.seq = 0;
    this.pending = [];   // inputs sent but not yet acknowledged by the server
    this.outbox = [];    // inputs waiting for the next network send
    this.smoothing = { x: 0, y: 0, z: 0 }; // visual offset that hides small corrections
    this.droneSmoothing = { x: 0, y: 0, z: 0 }; // the same for the drone you're piloting
    // Camera feel (visual only): head bob in step with your footsteps, and a springy dip when you stop or land a vault
    this.feel = { phase: 0, dip: 0, dipV: 0, fast: 0, vaulting: false };
    this.lastCorrection = 0;
    this.sprinting = false;
    this.dragging = false;
    this.droneState = null;  // set while piloting a drone (prep phase)
    this.droneId = null;
    this.savedView = null;

    this.listeners = {
      keydown: (e) => this.handleKey(e, true),
      keyup: (e) => this.handleKey(e, false),
      mousemove: (e) => this.handleMouse(e),
      mousedown: (e) => this.handleButton(e, true),
      mouseup: (e) => this.handleButton(e, false),
      blur: () => { this.keys = 0; this.dragging = false; },
    };
    for (const [ev, fn] of Object.entries(this.listeners)) window.addEventListener(ev, fn);
    // Switching between toggle and hold starts again from upright and not aiming
    this.offSettings = onSettingsChange((name) => {
      if (name === 'leanMode') { this.leanOn = 0; this.keys &= ~(KEY.LEAN_LEFT | KEY.LEAN_RIGHT); }
      if (name === 'aimMode') { this.aimOn = false; this.keys &= ~KEY.AIM; }
    });
  }

  dispose() {
    for (const [ev, fn] of Object.entries(this.listeners)) window.removeEventListener(ev, fn);
    this.offSettings();
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  get weaponDef() {
    return gunFor(this.weapon.id, this.attachments);
  }

  // Keys work with or without pointer lock, so the game stays playable in
  // browsers or embedded views where pointer lock is unavailable.
  handleKey(e, down) {
    if (down && e.target instanceof HTMLInputElement) return;
    // 1-3 choose the entry point while attackers wait in prep; otherwise they're ordinary keys
    if (down && DIGIT_KEYS[e.code] && this.onDigit?.(DIGIT_KEYS[e.code])) return;
    const action = actionFor(e.code);
    if (!action) return;
    if (HOLD_BITS[action] || action === 'prone' || action === 'primary' || action === 'secondary' || EVENT_ACTIONS.has(action) || action === 'melee') e.preventDefault();
    this.applyAction(action, down, e.repeat);
  }

  handleButton(e, down) {
    if (!down) {
      this.dragging = false;
      const action = actionFor(mouseCode(e.button));
      if (action) this.applyAction(action, false, false);
      return;
    }
    if (e.target !== this.canvas) return;   // clicks on menus and overlays aren't game input
    const action = actionFor(mouseCode(e.button));
    if (action && (this.pointerLocked || this.canFireUnlocked())) this.applyAction(action, true, false);
    if (!this.pointerLocked) this.dragging = true;
  }

  /** A bound key or mouse button went down or up. */
  applyAction(action, down, repeat) {
    if (action === 'ping') { if (!repeat) this.onPing?.(down); return; }
    if (action === 'loadout') { if (down && !repeat) this.onLoadoutKey?.(); return; }
    if (action === 'fire' && this.droneState) {
      // Piloting a drone: fire pings the enemy under the crosshair instead.
      if (down && !repeat) this.sendAction('ping');
      return;
    }
    // Toggle lean: the same key again stands you up, the other key leans the other way
    if ((action === 'leanLeft' || action === 'leanRight') && settings.leanMode === 'toggle') {
      if (down && !repeat) { const dir = action === 'leanLeft' ? -1 : 1; this.leanOn = this.leanOn === dir ? 0 : dir; }
      return;
    }
    if (action === 'aim' && settings.aimMode === 'toggle') {
      if (down && !repeat) this.aimOn = !this.aimOn;
      return;
    }
    const bit = HOLD_BITS[action];
    if (bit) {
      if (!down) { this.keys &= ~bit; return; }
      this.keys |= bit; this.tapped |= bit;
      if (action === 'crouch' || action === 'jump') this.proneOn = false;   // get up from prone
      if (action === 'sprint') this.aimOn = false;                          // sprinting lowers the sights
      return;
    }
    if (PLACE_ACTIONS.has(action) && !repeat && !(down && this.state.downed)) this.onPlaceKey?.(action, down);
    if (!down && PLACE_ACTIONS.has(action)) { this.network.sendActionEnd(action); return; }
    if (!down || repeat || !this.alive) return;
    if (this.state.downed) return;   // knocked down: nothing but crawling
    if (action === 'prone') this.proneOn = !this.proneOn;
    else if (action === 'primary' || action === 'secondary') {
      if (!this.droneState && !this.viewLocked && !this.state.downed) this.wantSlot = action === 'primary' ? 1 : 2;
    }
    else if (action === 'melee') {
      if (this.droneState || this.viewLocked || performance.now() < this.meleeReady) return;
      this.meleeReady = performance.now() + 800;
      this.sendAction('melee');
    } else if (EVENT_ACTIONS.has(action)) this.sendAction(action);
  }

  // Mouse look: free movement when the pointer is locked, click-and-drag otherwise.
  handleMouse(e) {
    if (!this.pointerLocked && !this.dragging) return;
    if (this.lookFrozen) { this.onWheelMove?.(e.movementX, e.movementY); return; }   // the ping wheel is open: the mouse picks a choice
    let k = MOUSE_SENSITIVITY * settings.sensitivity;
    // Aiming: its own sensitivity, scaled down by the zoom so 1x feels like the hip-fire setting
    const ads = this.droneState ? 0 : this.state.ads || 0;
    if (ads > 0) k *= 1 + (settings.aimSensitivity / this.adsZoom - 1) * ads;
    // Hanging upside down the view is turned over, so the mouse is too: it moves the view the way it would upright
    const turned = !this.droneState && this.state.rap && this.state.rapFlip > 0.5 ? -1 : 1;
    this.yaw = wrapAngle(this.yaw - e.movementX * k * turned);
    this.pitch = clampPitch(this.pitch - e.movementY * k * turned);
  }

  get aimYaw() {
    return wrapAngle(this.yaw + this.recoil.yaw);
  }

  get aimPitch() {
    return clampPitch(this.pitch + this.recoil.pitch);
  }

  update(frameDt) {
    const firingHeld = (this.keys & KEY.FIRE) !== 0;
    if (this.alive) {
      const droneMode = !!this.droneState;
      if (droneMode) this.pitch = Math.max(-0.7, Math.min(0.7, this.pitch));
      const toggled = (this.proneOn ? KEY.PRONE : 0) | (this.aimOn ? KEY.AIM : 0)
        | (this.leanOn < 0 ? KEY.LEAN_LEFT : this.leanOn > 0 ? KEY.LEAN_RIGHT : 0);
      const raw = this.keys | this.tapped | toggled;
      const keys = droneMode ? raw & DRONE_KEYS : this.mask(raw);
      // Long frames are split so each simulated step stays within server limits.
      let remaining = Math.min(frameDt, 0.25);
      while (remaining > 1e-4) {
        const dt = Math.min(remaining, MAX_INPUT_DT);
        remaining -= dt;
        const lock = this.viewLocked;
        const input = {
          seq: this.seq++, dt, keys, wsel: this.wantSlot,
          yaw: lock ? lock.yaw : droneMode ? this.yaw : this.aimYaw,
          pitch: lock ? lock.pitch : droneMode ? this.pitch : this.aimPitch,
          drone: droneMode,
        };
        if (keys & KEY.FIRE) input.rt = Math.round(this.renderTime());
        this.simulate(input, true);
        this.pending.push(input);
        this.outbox.push(input);
      }
    }
    this.tapped = 0;

    // The network sends them in batches, about 7 a second (client/src/network.js)
    if (this.outbox.length) this.network.sendInputs(this.outbox.splice(0));

    // Recoil settles back toward the point of aim, slower while still firing.
    this.recoil.update(frameDt, this.weapon.id, firingHeld);

    // Decay the visual correction offset
    const k = Math.exp(-12 * frameDt);
    this.smoothing.x *= k; this.smoothing.y *= k; this.smoothing.z *= k;
    const ds = this.droneSmoothing;
    ds.x *= k; ds.y *= k; ds.z *= k;

    if (this.alive) { this.updateFeel(frameDt); this.updateCamera(); }
  }

  /** Head bob and dips, from how you are moving. Only the camera moves; your aim and hitbox don't. */
  updateFeel(dt) {
    const f = this.feel, s = this.state;
    const speed = Math.hypot(s.vx, s.vz);
    const moving = s.onGround && !s.rap && !this.droneState && speed > 0.3;
    const stride = s.sprinting ? FEEL.strideSprint : FEEL.strideWalk;
    if (moving) f.phase += speed * dt / stride * Math.PI;   // half a turn per footstep
    // Stopping sharply from a run: a small dip. `fast` remembers recent speed for a moment.
    if (speed < 0.6 && f.fast > 2.5 && s.onGround) { f.dipV -= FEEL.stopDip * Math.sqrt(FEEL.dipSpring) * Math.min(1.6, f.fast / WALK_SPEED); f.fast = 0; }
    f.fast = Math.max(speed, f.fast - dt * 12);
    // Landing a vault: a bigger dip
    const vaulting = s.vaultT > 0;
    if (f.vaulting && !vaulting) f.dipV -= FEEL.vaultDip * Math.sqrt(FEEL.dipSpring);
    f.vaulting = vaulting;
    // Spring back to rest, in small steps so a long frame can't make it overshoot
    for (let left = Math.min(dt, 0.25); left > 1e-6; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      f.dipV += (-FEEL.dipSpring * f.dip - FEEL.dipDamping * f.dipV) * h;
      f.dip += f.dipV * h;
    }
    // Bob size: more sprinting, less crouched or aiming, nothing standing still
    const run = Math.min(1, speed / WALK_SPEED);
    let amp = moving ? (s.sprinting ? FEEL.bobSprint : FEEL.bobWalk * run) : 0;
    amp *= 1 - (1 - FEEL.bobCrouch) * Math.max(s.crouch, s.prone || 0);
    amp *= 1 - (1 - FEEL.bobAim) * (s.ads || 0);
    f.amp = (f.amp ?? 0) + (amp - (f.amp ?? 0)) * Math.min(1, dt * 10);   // fades in and out
  }

  /** Start/stop watching a camera feed: the body keeps its facing, the mouse only moves the feed. */
  lockView(on) {
    if (on && !this.viewLocked) this.viewLocked = { yaw: this.aimYaw, pitch: this.aimPitch, rawYaw: this.yaw, rawPitch: this.pitch };
    else if (!on && this.viewLocked) {
      this.yaw = this.viewLocked.rawYaw; this.pitch = this.viewLocked.rawPitch;
      this.viewLocked = null;
    }
  }

  /** Inputs made so far go first in the batch, so the server judges the action with our latest aim. */
  sendAction(type) {
    if (this.outbox.length) this.network.sendInputs(this.outbox.splice(0));
    this.network.sendAction(type);
    this.onAction?.(type);
  }

  /** Run one input through movement + weapon. Effects only on the first (live) run. */
  simulate(input, live) {
    if (input.drone) {
      if (this.droneState && !this.droneJammed) stepDrone(this.droneState, input, input.dt, this.world.droneView);
      return;
    }
    this.state.gunMul = gunMobility(this.weapon);
    this.state.aimMul = gunAimTime(this.weapon, this.attachments);
    stepPlayer(this.state, input, input.dt, this.collisionWorld());
    const wi = weaponInput(this.state, input);
    const ammoBefore = this.weapon.ammo;
    const fired = stepWeapon(this.weapon, wi, input.dt, this.attachments);
    if (!live) return;
    // Pulling the trigger on an empty gun: a dry click (once per press)
    const pull = (wi.keys & KEY.FIRE) !== 0;
    if (pull && !this.wasFire && !fired && ammoBefore === 0 && !this.weaponDef.shield) this.onDry?.(this.weapon.id);
    this.wasFire = pull;
    const s = this.state;
    this.sprinting = s.sprinting && Math.hypot(s.vx, s.vz) > 4.5;
    if (s.sprinting) { this.leanOn = 0; this.aimOn = false; }   // sprinting cancels a toggled lean and aim
    if (!fired) return;

    const w = this.weaponDef;
    const eye = getEyePosition(s, this.world);
    const spread = currentSpread(this.weapon, s);
    const dirs = shotDirections(w, input.yaw, input.pitch, spread, input.seq);
    this.onShot?.({ origin: [eye.x, eye.y, eye.z], dirs, weaponId: w.id });

    this.recoil.fire(w.id, { ads: s.ads || 0, crouch: Math.max(s.crouch || 0, s.prone || 0) }, this.attachments?.[w.id]);
  }

  resetRecoil() { this.recoil.reset(); }

  /** Server state for this player arrived: rewind to it and replay unacknowledged inputs. */
  /** Start, switch or stop piloting. `entry` is the server's drone record or null. */
  setDrone(entry) {
    if (!entry) {
      if (!this.droneState) return;
      this.droneState = null;
      this.droneId = null;
      this.pending = this.pending.filter((i) => !i.drone);
      if (this.savedView) { this.yaw = this.savedView.yaw; this.pitch = this.savedView.pitch; this.savedView = null; }
      this.keys &= ~KEY.FIRE;
      return;
    }
    if (entry.id === this.droneId) return;
    if (!this.droneState) this.savedView = { yaw: this.yaw, pitch: this.pitch };
    this.droneId = entry.id;
    this.droneState = {
      x: entry.x, y: entry.y, z: entry.z, vx: entry.vx, vy: entry.vy, vz: entry.vz,
      yaw: entry.yaw, pitch: entry.pitch, onGround: !!entry.g, jumpCd: entry.jc || 0,
    };
    this.yaw = entry.yaw;
    this.pitch = 0;
    this.pending.length = 0;
    this.droneSmoothing = { x: 0, y: 0, z: 0 };
  }

  reconcile(serverState, droneEntry = null) {
    if (!this.alive || !serverState.alive) return;
    const before = { x: this.state.x, y: this.state.y, z: this.state.z };

    while (this.pending.length && this.pending[0].seq <= serverState.seq) this.pending.shift();

    const s = this.state;
    for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'crouch', 'prone', 'lean', 'onGround', 'slow']) s[key] = serverState[key];
    s.ads = serverState.ad || 0;
    s.downed = serverState.dn ? 1 : 0;
    const dash = serverState.ds;   // Aegis's shield charge, started by the server
    if (dash) { [s.dash, s.dashX, s.dashZ] = dash; } else s.dash = 0;
    s.fireDelay = serverState.fd || 0;
    s.jumpCd = serverState.jc || 0;
    s.sprinting = !!serverState.spr;
    // vaulting and rappelling (sent only while they matter)
    const vt = serverState.vt;
    if (vt) { [s.vaultT, s.vax, s.vay, s.vaz, s.vbx, s.vby, s.vbz, s.vtop] = vt; } else s.vaultT = 0;
    const rk = serverState.rk;
    if (rk) { [s.rap, s.rapSide, s.rapFlip, s.rapPrev, s.rapCd] = rk; } else { s.rap = 0; s.rapSide = 0; s.rapFlip = 0; s.rapPrev = 0; s.rapCd = 0; }
    s.swing = -1;
    if (serverState.w) Object.assign(this.weapon, serverState.w);
    if (serverState.sm) s.speedMul = serverState.sm;   // operator speed rating can change during select
    const ds = this.droneState;
    const droneBefore = ds && { x: ds.x, y: ds.y, z: ds.z };
    if (ds && droneEntry && droneEntry.id === this.droneId) {
      for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz']) ds[k] = droneEntry[k];
      ds.onGround = !!droneEntry.g;
      ds.jumpCd = droneEntry.jc || 0;
      this.droneJammed = !!droneEntry.j;
    }
    for (const input of this.pending) this.simulate(input, false);

    if (droneBefore) {
      const sm = this.droneSmoothing;
      const ex = droneBefore.x - ds.x, ey = droneBefore.y - ds.y, ez = droneBefore.z - ds.z;
      if (Math.hypot(ex, ey, ez) > 2) { sm.x = 0; sm.y = 0; sm.z = 0; } else { sm.x += ex; sm.y += ey; sm.z += ez; }
    }

    const dx = before.x - s.x, dy = before.y - s.y, dz = before.z - s.z;
    const err = Math.hypot(dx, dy, dz);
    if (err > 2) {
      this.smoothing = { x: 0, y: 0, z: 0 }; // teleport-sized: snap
    } else if (err > 1e-4) {
      this.smoothing.x += dx; this.smoothing.y += dy; this.smoothing.z += dz;
      this.lastCorrection = err;
    }
  }

  /** Knocked down, or back up: every toggle starts again, so a revived player stands up rather than staying prone. */
  setDowned(on) {
    this.state.downed = on ? 1 : 0;
    this.proneOn = false;
    this.leanOn = 0;
    this.aimOn = false;
  }

  die() {
    this.alive = false;
    this.keys = 0;
    this.proneOn = false;
    this.leanOn = 0;
    this.aimOn = false;
    this.pending.length = 0;
    this.outbox.length = 0;
  }

  /** Moved by the server (attackers appear at their chosen entry point). */
  teleport(state) {
    this.state = copyPlayerState(state);
    this.proneOn = false;
    this.leanOn = 0;
    this.aimOn = false;
    this.wantSlot = 1;
    this.yaw = state.yaw;
    this.pitch = 0;
    this.resetRecoil();
    this.pending.length = 0;
    this.outbox.length = 0;
    this.smoothing = { x: 0, y: 0, z: 0 };
    // Leaving the drone must not restore the old camera angle over the new facing
    this.droneState = null;
    this.droneId = null;
    this.savedView = null;
  }

  /** Hard reset (respawn) */
  respawn(state, weapon, team) {
    if (team) this.team = team;
    this.state = copyPlayerState(state);
    this.weapon = copyWeaponState(weapon);
    this.yaw = state.yaw;
    this.pitch = state.pitch || 0;
    this.resetRecoil();
    this.pending.length = 0;
    this.outbox.length = 0;
    this.smoothing = { x: 0, y: 0, z: 0 };
    this.alive = true;
    this.proneOn = false;
    this.leanOn = 0;
    this.aimOn = false;
    this.wantSlot = 1;
  }

  updateCamera() {
    if (this.droneState) {
      const e = droneEye(this.droneState), sm = this.droneSmoothing;
      this.camera.position.set(e[0] + sm.x, e[1] + sm.y, e[2] + sm.z);
      this.camera.rotation.set(this.droneState.pitch, this.droneState.yaw, 0, 'YXZ');
      return;
    }
    const eye = getEyePosition(this.state, this.world);
    const f = this.feel, amp = f.amp || 0;
    const bobY = -Math.abs(Math.sin(f.phase)) * amp + f.dip;
    const side = Math.sin(f.phase) * amp * FEEL.bobSide;
    const [rx, rz] = rightVec(this.aimYaw);
    // Kneeling to put something on the floor lowers the view (Stage 27; the body's height doesn't change)
    this.camera.position.set(eye.x + this.smoothing.x + rx * side, eye.y + this.smoothing.y + bobY - (this.kneel || 0), eye.z + this.smoothing.z + rz * side);
    const roll = Math.sin(f.phase) * FEEL.bobRoll * (amp / FEEL.bobWalk);
    // Recoil's camera snap and shake: visual only (the bullets follow aimPitch / aimYaw)
    const kick = this.recoil.view();
    this.camera.rotation.set(this.aimPitch + kick.pitch, this.aimYaw + kick.yaw, -eye.lean * LEAN_ROLL + roll + kick.roll + (this.state.rapFlip || 0) * Math.PI, 'YXZ');   // upside down on a rope
  }
}
