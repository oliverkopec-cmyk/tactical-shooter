// MOVEMENT TUNING: every number that decides how moving feels, in one place.
// The simulation part is shared by client prediction and the server, so a change
// here changes both sides the same way (rebuild and restart after editing it).
// The FEEL part is only the camera and the gun in your hands (client side).

// ---------------------------------------------------------------- simulation (client and server)

// Top speeds in m/s, before the multipliers below
export const WALK_SPEED = 4.0;
export const SPRINT_SPEED = 6.4;
export const CROUCH_SPEED = 2.0;
export const PRONE_SPEED = 1.0;

export const MOVE = {
  accelTime: 0.15,     // seconds to reach top speed from standing still
  decelTime: 0.1,      // seconds to stop from walking speed (letting go of the keys)
  turnGrip: 0.7,       // how quickly sideways momentum is lost when you change direction (1 = as fast as stopping)
  airControl: 0.15,    // fraction of the ground acceleration you get while falling
  strafeMul: 0.85,     // speed moving straight sideways
  backMul: 0.75,       // speed moving straight backwards
  gravity: 22,         // m/s²
};

// Aegis's shield charge (Stage E): this fast, for ABILITY_STATS.dash.time seconds (shared/utilities.js)
export const DASH_SPEED = 10;

// Stance changes: amount per second (0..1). The eye height eases in and out of them, so they never snap.
export const CROUCH_TRANSITION = 4.5;    // about 0.22 s down or up
export const PRONE_TRANSITION = 2.4;     // about 0.4 s

// Leaning
export const LEAN_SPEED = 6;             // lean amount change per second (-1..1)
export const LEAN_OFFSET = 0.45;         // sideways eye offset at full lean (m)
export const LEAN_ROLL = 0.22;           // camera roll at full lean (rad)

// Aiming down sights: time to raise the sights (s), spread and walking speed while fully aimed
export const ADS = { time: 0.2, spreadMul: 0.4, moveMul: 0.62 };

// Operator speed ratings 1 / 2 / 3 change walking speed by these amounts (gun mobility is in shared/weapons.js)
export const SPEED_RATING = { 1: -0.08, 2: 0, 3: 0.08 };

// ---------------------------------------------------------------- feel (client only)

export const FEEL = {
  // Head bob: metres up and down per step, and sideways sway, while walking and sprinting
  bobWalk: 0.022, bobSprint: 0.05, bobSide: 0.5, bobCrouch: 0.5, bobAim: 0.25,
  strideWalk: 1.7, strideSprint: 2.3,   // metres per footstep (matches the footstep sounds)
  bobRoll: 0.006,                       // a slight tilt with each step (rad)
  // Dips: how far the camera drops when you stop sharply and when you land from a vault (m), and how springy it is
  stopDip: 0.035, vaultDip: 0.09, dipSpring: 120, dipDamping: 14,
  // Weapon sway: how far the gun lags behind the mouse, how quickly it catches up, and the footstep motion
  swayLag: 0.035, swayMax: 0.09, swayReturn: 10, swayStep: 1.0, swayAim: 0.2,
};
