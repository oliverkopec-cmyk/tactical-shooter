// The local player: keyboard/mouse input, client-side prediction of movement
// and weapon state against the shared simulation code, and reconciliation with
// authoritative server snapshots.

import {
  KEY, MAX_INPUT_DT, INPUT_SEND_RATE, LEAN_ROLL,
} from '../../shared/constants.js';
import { createPlayerState, copyPlayerState, stepPlayer, getEyePosition } from '../../shared/movement.js';
import {
  WEAPONS, createWeaponState, copyWeaponState, stepWeapon, currentSpread, shotDirections,
} from '../../shared/weapons.js';

const KEY_BINDINGS = {
  KeyW: KEY.FORWARD, ArrowUp: KEY.FORWARD,
  KeyS: KEY.BACK, ArrowDown: KEY.BACK,
  KeyA: KEY.LEFT, ArrowLeft: KEY.LEFT,
  KeyD: KEY.RIGHT, ArrowRight: KEY.RIGHT,
  ShiftLeft: KEY.SPRINT, ShiftRight: KEY.SPRINT,
  ControlLeft: KEY.CROUCH, ControlRight: KEY.CROUCH, KeyZ: KEY.CROUCH,
  KeyQ: KEY.LEAN_LEFT,
  KeyE: KEY.LEAN_RIGHT,
  KeyR: KEY.RELOAD,
};
// Temporary weapon selection for testing until operators pick weapons (stage 6)
const WEAPON_KEYS = { Digit1: 1, Digit2: 2, Digit3: 3 };
// One-shot actions sent as events: breach charge (attack), reinforce (defense)
const ACTION_KEYS = { KeyG: 'breach', KeyV: 'reinforce' };

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
  constructor({ id, team, state, weapon, world, network, camera, canvas, onShot, renderTime, canFireUnlocked, onAction, mask }) {
    this.id = id;
    this.team = team;
    this.world = world;
    this.network = network;
    this.camera = camera;
    this.canvas = canvas;
    this.onShot = onShot;
    this.renderTime = renderTime;
    this.canFireUnlocked = canFireUnlocked;
    this.onAction = onAction;
    this.mask = mask || ((k) => k);   // which inputs count in the current round phase

    this.state = copyPlayerState(state || createPlayerState({ x: 0, y: 0, z: 0 }));
    this.weapon = copyWeaponState(weapon || createWeaponState());
    this.alive = true;
    this.yaw = this.state.yaw;
    this.pitch = this.state.pitch;
    this.recoil = { pitch: 0, yaw: 0 };
    this.keys = 0;
    this.tapped = 0;     // keys pressed since the last frame, so quick taps aren't lost
    this.wsel = 0;
    this.seq = 0;
    this.pending = [];   // inputs sent but not yet acknowledged by the server
    this.outbox = [];    // inputs waiting for the next network send
    this.sendTimer = 0;
    this.smoothing = { x: 0, y: 0, z: 0 }; // visual offset that hides small corrections
    this.lastCorrection = 0;
    this.sprinting = false;
    this.dragging = false;

    this.listeners = {
      keydown: (e) => this.handleKey(e, true),
      keyup: (e) => this.handleKey(e, false),
      mousemove: (e) => this.handleMouse(e),
      mousedown: (e) => this.handleButton(e, true),
      mouseup: (e) => this.handleButton(e, false),
      blur: () => { this.keys = 0; this.dragging = false; },
    };
    for (const [ev, fn] of Object.entries(this.listeners)) window.addEventListener(ev, fn);
  }

  dispose() {
    for (const [ev, fn] of Object.entries(this.listeners)) window.removeEventListener(ev, fn);
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  get weaponDef() {
    return WEAPONS[this.weapon.id];
  }

  // Keys work with or without pointer lock, so the game stays playable in
  // browsers or embedded views where pointer lock is unavailable.
  handleKey(e, down) {
    if (down && e.target instanceof HTMLInputElement) return;
    if (down && WEAPON_KEYS[e.code]) { this.wsel = WEAPON_KEYS[e.code]; return; }
    if (ACTION_KEYS[e.code]) {
      if (down && !e.repeat && this.alive) this.sendAction(ACTION_KEYS[e.code]);
      return;
    }
    const bit = KEY_BINDINGS[e.code];
    if (!bit) return;
    e.preventDefault();
    if (down) { this.keys |= bit; this.tapped |= bit; } else this.keys &= ~bit;
  }

  handleButton(e, down) {
    if (e.button !== 0) return;
    if (!down) {
      this.keys &= ~KEY.FIRE;
      this.dragging = false;
      return;
    }
    if (e.target !== this.canvas) return;
    if (this.pointerLocked || this.canFireUnlocked()) { this.keys |= KEY.FIRE; this.tapped |= KEY.FIRE; }
    if (!this.pointerLocked) this.dragging = true;
  }

  // Mouse look: free movement when the pointer is locked, click-and-drag otherwise.
  handleMouse(e) {
    if (!this.pointerLocked && !this.dragging) return;
    this.yaw = wrapAngle(this.yaw - e.movementX * MOUSE_SENSITIVITY);
    this.pitch = clampPitch(this.pitch - e.movementY * MOUSE_SENSITIVITY);
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
      const keys = this.mask(this.keys | this.tapped);
      // Long frames are split so each simulated step stays within server limits.
      let remaining = Math.min(frameDt, 0.25);
      while (remaining > 1e-4) {
        const dt = Math.min(remaining, MAX_INPUT_DT);
        remaining -= dt;
        const input = { seq: this.seq++, dt, keys, yaw: this.aimYaw, pitch: this.aimPitch };
        if (this.wsel) { input.wsel = this.wsel; this.wsel = 0; }
        if (keys & KEY.FIRE) input.rt = Math.round(this.renderTime());
        this.simulate(input, true);
        this.pending.push(input);
        this.outbox.push(input);
      }
    }
    this.tapped = 0;

    this.sendTimer += frameDt;
    if (this.sendTimer >= 1 / INPUT_SEND_RATE && this.outbox.length) {
      this.sendTimer = 0;
      this.network.sendInputs(this.outbox.splice(0, 30));
    }

    // Recoil settles back toward the point of aim, slower while still firing.
    const settle = Math.min(1, frameDt * (firingHeld ? 2 : 7));
    this.recoil.pitch -= this.recoil.pitch * settle;
    this.recoil.yaw -= this.recoil.yaw * settle;

    // Decay the visual correction offset
    const k = Math.exp(-12 * frameDt);
    this.smoothing.x *= k; this.smoothing.y *= k; this.smoothing.z *= k;

    if (this.alive) this.updateCamera();
  }

  /** Flush pending inputs first so the server judges the action with our latest aim. */
  sendAction(type) {
    if (this.outbox.length) this.network.sendInputs(this.outbox.splice(0, 30));
    this.network.sendAction(type);
    this.onAction?.(type);
  }

  /** Run one input through movement + weapon. Effects only on the first (live) run. */
  simulate(input, live) {
    stepPlayer(this.state, input, input.dt, this.world);
    const fired = stepWeapon(this.weapon, input, input.dt);
    if (!live) return;
    const s = this.state;
    this.sprinting = (input.keys & KEY.SPRINT) && (input.keys & KEY.FORWARD) && s.crouch < 0.5 && Math.hypot(s.vx, s.vz) > 4.5;
    if (!fired) return;

    const w = this.weaponDef;
    const eye = getEyePosition(s, this.world);
    const spread = currentSpread(this.weapon, s);
    const dirs = shotDirections(w, input.yaw, input.pitch, spread, input.seq);
    this.onShot?.({ origin: [eye.x, eye.y, eye.z], dirs, weaponId: w.id });

    // View recoil: mostly up, a little sideways
    this.recoil.pitch += w.recoilPitch * (0.85 + Math.random() * 0.3);
    this.recoil.yaw += w.recoilYaw * (Math.random() * 2 - 1);
  }

  /** Server state for this player arrived: rewind to it and replay unacknowledged inputs. */
  reconcile(serverState) {
    if (!this.alive || !serverState.alive) return;
    const before = { x: this.state.x, y: this.state.y, z: this.state.z };

    while (this.pending.length && this.pending[0].seq <= serverState.seq) this.pending.shift();

    const s = this.state;
    for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'crouch', 'lean', 'onGround']) s[key] = serverState[key];
    if (serverState.w) Object.assign(this.weapon, serverState.w);
    for (const input of this.pending) this.simulate(input, false);

    const dx = before.x - s.x, dy = before.y - s.y, dz = before.z - s.z;
    const err = Math.hypot(dx, dy, dz);
    if (err > 2) {
      this.smoothing = { x: 0, y: 0, z: 0 }; // teleport-sized: snap
    } else if (err > 1e-4) {
      this.smoothing.x += dx; this.smoothing.y += dy; this.smoothing.z += dz;
      this.lastCorrection = err;
    }
  }

  die() {
    this.alive = false;
    this.keys = 0;
    this.pending.length = 0;
    this.outbox.length = 0;
  }

  /** Hard reset (respawn) */
  respawn(state, weapon, team) {
    if (team) this.team = team;
    this.state = copyPlayerState(state);
    this.weapon = copyWeaponState(weapon);
    this.yaw = state.yaw;
    this.pitch = state.pitch || 0;
    this.recoil = { pitch: 0, yaw: 0 };
    this.pending.length = 0;
    this.outbox.length = 0;
    this.smoothing = { x: 0, y: 0, z: 0 };
    this.alive = true;
  }

  updateCamera() {
    const eye = getEyePosition(this.state, this.world);
    this.camera.position.set(eye.x + this.smoothing.x, eye.y + this.smoothing.y, eye.z + this.smoothing.z);
    this.camera.rotation.set(this.aimPitch, this.aimYaw, -eye.lean * LEAN_ROLL, 'YXZ');
  }
}
