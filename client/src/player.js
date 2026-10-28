// The local player: keyboard/mouse input, client-side prediction against the
// shared movement code, and reconciliation with authoritative server snapshots.

import {
  KEY, MAX_INPUT_DT, INPUT_SEND_RATE, LEAN_ROLL,
} from '../../shared/constants.js';
import { createPlayerState, copyPlayerState, stepPlayer, getEyePosition } from '../../shared/movement.js';

const KEY_BINDINGS = {
  KeyW: KEY.FORWARD, ArrowUp: KEY.FORWARD,
  KeyS: KEY.BACK, ArrowDown: KEY.BACK,
  KeyA: KEY.LEFT, ArrowLeft: KEY.LEFT,
  KeyD: KEY.RIGHT, ArrowRight: KEY.RIGHT,
  ShiftLeft: KEY.SPRINT, ShiftRight: KEY.SPRINT,
  ControlLeft: KEY.CROUCH, ControlRight: KEY.CROUCH, KeyZ: KEY.CROUCH,
  KeyQ: KEY.LEAN_LEFT,
  KeyE: KEY.LEAN_RIGHT,
};

const MOUSE_SENSITIVITY = 0.0022;
const TWO_PI = Math.PI * 2;

export class LocalPlayer {
  constructor({ id, team, state, world, network, camera, canvas }) {
    this.id = id;
    this.team = team;
    this.world = world;
    this.network = network;
    this.camera = camera;
    this.canvas = canvas;

    this.state = copyPlayerState(state || createPlayerState({ x: 0, y: 0, z: 0 }));
    this.yaw = this.state.yaw;
    this.pitch = this.state.pitch;
    this.keys = 0;
    this.tapped = 0;     // keys pressed since the last frame, so quick taps aren't lost
    this.seq = 0;
    this.pending = [];   // inputs sent but not yet acknowledged by the server
    this.outbox = [];    // inputs waiting for the next network send
    this.sendTimer = 0;
    this.smoothing = { x: 0, y: 0, z: 0 }; // visual offset that hides small corrections
    this.lastCorrection = 0;

    this.onKeyDown = (e) => this.handleKey(e, true);
    this.onKeyUp = (e) => this.handleKey(e, false);
    this.onMouseMove = (e) => this.handleMouse(e);
    this.onMouseDown = (e) => { if (e.target === this.canvas) this.dragging = true; };
    this.onMouseUp = () => { this.dragging = false; };
    this.onBlur = () => { this.keys = 0; this.dragging = false; };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
  }

  get pointerLocked() {
    return document.pointerLockElement === this.canvas;
  }

  // Keys work with or without pointer lock, so the game stays playable in
  // browsers or embedded views where pointer lock is unavailable.
  handleKey(e, down) {
    const bit = KEY_BINDINGS[e.code];
    if (!bit) return;
    if (down && e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    if (down) { this.keys |= bit; this.tapped |= bit; } else this.keys &= ~bit;
  }

  // Mouse look: free movement when the pointer is locked, click-and-drag otherwise.
  handleMouse(e) {
    if (!this.pointerLocked && !this.dragging) return;
    this.yaw -= e.movementX * MOUSE_SENSITIVITY;
    this.pitch -= e.movementY * MOUSE_SENSITIVITY;
    this.yaw = ((this.yaw % TWO_PI) + TWO_PI) % TWO_PI;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
  }

  update(frameDt) {
    // Long frames are split so each simulated step stays within server limits.
    const keys = this.keys | this.tapped;
    this.tapped = 0;
    let remaining = Math.min(frameDt, 0.25);
    while (remaining > 1e-4) {
      const dt = Math.min(remaining, MAX_INPUT_DT);
      remaining -= dt;
      const input = { seq: this.seq++, dt, keys, yaw: this.yaw, pitch: this.pitch };
      stepPlayer(this.state, input, dt, this.world);
      this.pending.push(input);
      this.outbox.push(input);
    }

    this.sendTimer += frameDt;
    if (this.sendTimer >= 1 / INPUT_SEND_RATE && this.outbox.length) {
      this.sendTimer = 0;
      this.network.sendInputs(this.outbox.splice(0, 30));
    }

    // Decay the visual correction offset
    const k = Math.exp(-12 * frameDt);
    this.smoothing.x *= k; this.smoothing.y *= k; this.smoothing.z *= k;

    this.updateCamera();
  }

  /** Server state for this player arrived: rewind to it and replay unacknowledged inputs. */
  reconcile(serverState) {
    const before = { x: this.state.x, y: this.state.y, z: this.state.z };

    while (this.pending.length && this.pending[0].seq <= serverState.seq) this.pending.shift();

    const s = this.state;
    for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'crouch', 'lean', 'onGround']) s[key] = serverState[key];
    for (const input of this.pending) stepPlayer(s, input, input.dt, this.world);

    const dx = before.x - s.x, dy = before.y - s.y, dz = before.z - s.z;
    const err = Math.hypot(dx, dy, dz);
    if (err > 2) {
      this.smoothing = { x: 0, y: 0, z: 0 }; // teleport-sized: snap
    } else if (err > 1e-4) {
      this.smoothing.x += dx; this.smoothing.y += dy; this.smoothing.z += dz;
      this.lastCorrection = err;
    }
  }

  /** Hard reset (e.g. respawn) */
  setState(state) {
    this.state = copyPlayerState(state);
    this.yaw = state.yaw;
    this.pitch = state.pitch || 0;
    this.pending.length = 0;
    this.outbox.length = 0;
    this.smoothing = { x: 0, y: 0, z: 0 };
  }

  updateCamera() {
    const eye = getEyePosition(this.state, this.world);
    this.camera.position.set(eye.x + this.smoothing.x, eye.y + this.smoothing.y, eye.z + this.smoothing.z);
    this.camera.rotation.set(this.pitch, this.yaw, -eye.lean * LEAN_ROLL, 'YXZ');
  }
}
