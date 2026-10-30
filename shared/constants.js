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
export const PRONE_HEIGHT = 0.5;
export const STAND_EYE = 1.62;
export const CROUCH_EYE = 1.05;
export const PRONE_EYE = 0.34;
export const PRONE_EYE_FORWARD = 0.3;     // prone eyes sit this far ahead of centre (inside the collision box)
export const STEP_HEIGHT = 0.42;          // max ledge the player walks up automatically

// Movement (m/s)
export const WALK_SPEED = 4.0;
export const SPRINT_SPEED = 6.4;
export const CROUCH_SPEED = 2.0;
export const PRONE_SPEED = 1.0;
export const JUMP_SPEED = 5.4;            // about 0.66 m high
export const JUMP_COOLDOWN = 0.45;        // seconds between jumps
export const ACCEL_GROUND = 60;
export const GRAVITY = 22;
export const CROUCH_TRANSITION = 7;       // crouch amount change per second (0..1)
export const PRONE_TRANSITION = 2.4;      // prone amount change per second (0..1)
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
  JUMP: 1024,
  PRONE: 2048,
  RAPPEL: 4096,     // attach to / let go of a rope (a press)
  FLIP: 8192,       // hold: hang upside down while rappelling
  INTERACT: 16384,  // hold: plant or disable the defuser
};
export const KEY_MASK = 32767;

// Vaulting: Space at a low obstacle (a crate, a sill) hops over it
export const VAULT = { maxRise: 1.3, time: 0.55, clear: 1.12, maxDepth: 2.1, cooldown: 0.4 };
// Rappelling on the outside walls (m/s)
export const RAPPEL = { up: 1.6, down: 2.4, side: 1.8, flipSpeed: 3, eyeDrop: 1.5, wallOffset: 0.45, spreadMul: 2.2, hang: 0.9 };
// Defenders who stay outside the building too long are spotted
export const RUNOUT = { countdownS: 3, graceS: 1 };
// Square hatch covers in floors and roofs
export const HATCH = { size: 1.0, hp: 150 };

// Combat
export const MAX_HEALTH = 100;
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

// Rounds
export const PHASE = { INTRO: 'intro', PREP: 'prep', ACTION: 'action', ROUND_END: 'roundEnd' };
export const INTRO_MS = 20000;            // operator select
export const PREP_MS = 30000;
export const ACTION_MS = 180000;
export const ROUND_END_MS = 6000;
export const MATCH_END_MS = 10000;
export const ROUNDS_TO_WIN = 4;
export const HALFTIME_AFTER_ROUND = 3;    // sides swap after this round
export const CAPTURE_TIME = 10;           // seconds attackers must hold the objective zone

// Drones and spotting
export const DRONES_PER_ATTACKER = 1;     // operators change this in stage 6 (Hawk gets 3)
export const SPOT_DURATION_MS = 3000;     // how long a pinged enemy stays marked for the attackers
export const PING_COOLDOWN_MS = 400;

// Sprinting and shooting don't mix: pressing fire while sprinting ends the sprint,
// and the first shot comes after this delay (seconds).
export const SPRINT_FIRE_DELAY = 0.25;

// Barricades and melee
// A barricade is a solid panel of 7 thin planks with a diagonal X of two planks over the front. Windows are covered completely; doors keep an open gap at the bottom (0.32 m: a drone (0.28 m) fits, a prone player (0.5 m) doesn't).
// Bullets break planks one at a time (hp per plank); 3 melee hits break the whole barricade; breach charges and blasts destroy it at once.
export const BARRICADE = { thickness: 0.12, planks: 7, gap: 0.32, hp: 35, channelMs: 1000, reach: 2.6, pool: 8, meleeHits: 3, blastExtra: 0.9 };
export const MELEE = { reach: 2.1, cone: 0.5, damage: 45, cooldown: 0.8 };

// Operator gadgets
export const SHIELD = { width: 1.9, height: 1.5, thickness: 0.14, distance: 1.1 };
export const WIRE = { size: 1.8, height: 0.5, slow: 0.4, reach: 3.5 };
export const JAMMER_RANGE = 5;
export const CAMERA_REACH = 4.5;
export const STUN = { speed: 13, fuse: 1.5, radius: 7, duration: 4, slow: 0.45, cooldown: 0.8 };
export const GADGET_REACH = 3.5;
export const HAWK_MISS_COOLDOWN_MS = 1500;
