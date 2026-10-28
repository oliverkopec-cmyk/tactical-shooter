// Values shared by client and server. Changing these changes the simulation on both sides.

export const GAME_NAME = 'Breachline';

export const TEAMS = { ATTACK: 'attack', DEFENSE: 'defense' };
export const MAX_PER_TEAM = 5;
export const ROOM_CODE_LENGTH = 4;
export const MAX_NAME_LENGTH = 16;

// Networking
export const SNAPSHOT_RATE = 20;          // server -> client snapshots per second
export const INPUT_SEND_RATE = 30;        // client -> server input batches per second
export const INTERP_DELAY_MS = 100;       // remote players are rendered this far in the past
export const MAX_INPUT_DT = 0.05;         // longest single simulation step accepted (s)
export const MAX_TIME_BUDGET = 0.25;      // how far ahead of real time a client may simulate (s)

// Player body
export const PLAYER_RADIUS = 0.35;        // half-width of the player's collision box
export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.2;
export const STAND_EYE = 1.62;
export const CROUCH_EYE = 1.05;
export const STEP_HEIGHT = 0.42;          // max ledge the player walks up automatically

// Movement (m/s)
export const WALK_SPEED = 4.0;
export const SPRINT_SPEED = 6.4;
export const CROUCH_SPEED = 2.0;
export const ACCEL_GROUND = 60;
export const GRAVITY = 22;
export const CROUCH_TRANSITION = 7;       // crouch amount change per second (0..1)
export const LEAN_SPEED = 6;              // lean amount change per second (-1..1)
export const LEAN_OFFSET = 0.45;          // sideways eye offset at full lean (m)
export const LEAN_ROLL = 0.22;            // camera roll at full lean (rad)

// Input bit flags
export const KEY = {
  FORWARD: 1,
  BACK: 2,
  LEFT: 4,
  RIGHT: 8,
  SPRINT: 16,
  CROUCH: 32,
  LEAN_LEFT: 64,
  LEAN_RIGHT: 128,
  FIRE: 256,
  RELOAD: 512,
};
export const KEY_MASK = 1023;

// Combat
export const MAX_HEALTH = 100;
export const RESPAWN_MS = 5000;           // temporary until the round system (stage 4)
export const LAG_COMP_MAX_MS = 350;       // furthest back the server rewinds players for hits
export const MAX_SHOT_RANGE = 150;

// Destruction
export const BREACH = {
  basic: { radius: 1.15, damage: 70, damageRadius: 3.5, breaksReinforced: false },
  heavy: { radius: 1.45, damage: 80, damageRadius: 4, breaksReinforced: true },  // Spark (stage 6)
};
export const CHARGE_REACH = 2.2;          // how far away a breach charge can be planted (m)
export const REINFORCE_REACH = 2.2;
export const REINFORCE_TIME_MS = 1200;
export const TEAM_REINFORCEMENTS = 10;    // defense team pool (per round once rounds exist)
export const BASIC_CHARGES = 1;           // per attacker

export const TEAM_COLORS = {
  attack: 0xe8833a,
  defense: 0x3a8de8,
};
