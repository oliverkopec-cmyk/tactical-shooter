// Operator definitions, shared by client and server.
//
// To add an operator: add one entry here, and (if it has an ability) write the
// ability's server handler in server/abilities.js under the same `ability.id`.
//
//   team:    'attack' | 'defense'
//   weapon:  id from shared/weapons.js
//   speed:   1-3 rating (1 slow ... 3 fast)         armor: 1-3 rating (1 fragile ... 3 tough)
//   unique:  only one player per team can be this operator (default true)
//   extraDrones: attackers only, drones on top of the standard one
//   ability: { id, name, desc, charges }  or  { id, name, desc, cooldown } (seconds)

export const OPERATORS = {
  // ---------------------------------------------------------------- attackers
  spark: {
    name: 'Spark', team: 'attack', color: 0xff7a2e, weapon: 'rifle', speed: 2, armor: 2,
    ability: { id: 'heavyBreach', name: 'Heavy breach charge', charges: 1,
      desc: 'Plant on a wall, press {ability} again to blow it. Destroys reinforced walls.' },
  },
  hawk: {
    name: 'Hawk', team: 'attack', color: 0xf2c230, weapon: 'smg', speed: 3, armor: 1, extraDrones: 2,
    ability: { id: 'sonarPing', name: 'Sonar ping', cooldown: 8,
      desc: 'Ping the enemy under your crosshair, like a drone does: a marker shows above their head for 3 s. Also controls 2 extra drones.' },
  },
  bulwark: {
    name: 'Bulwark', team: 'attack', color: 0x6fb8d8, weapon: 'shotgun', speed: 1, armor: 3,
    ability: { id: 'shield', name: 'Portable shield', charges: 1,
      desc: 'Deploy a bulletproof shield in front of you. Press {ability} next to it to pick it up again.' },
  },
  flash: {
    name: 'Flash', team: 'attack', color: 0xe8e8ff, weapon: 'rifle', speed: 3, armor: 1,
    ability: { id: 'stun', name: 'Stun grenade', charges: 3,
      desc: 'Throw a grenade that blinds and slows enemies in sight for 4 s.' },
  },
  recruit_atk: {
    name: 'Recruit', team: 'attack', color: 0xb0b6bd, weapon: 'rifle', speed: 2, armor: 2, unique: false,
    ability: null,
  },

  // ---------------------------------------------------------------- defenders
  warden: {
    name: 'Warden', team: 'defense', color: 0xb7664a, weapon: 'shotgun', speed: 1, armor: 3,
    ability: { id: 'barbedWire', name: 'Barbed wire', charges: 2,
      desc: 'Lay wire on the floor. Anyone walking through it is slowed.' },
  },
  jammer: {
    name: 'Jammer', team: 'defense', color: 0x57d68d, weapon: 'smg', speed: 3, armor: 1,
    ability: { id: 'jammerDevice', name: 'Signal jammer', charges: 1,
      desc: 'Place a device that disables drones and breach charges within 5 m.' },
  },
  lookout: {
    name: 'Lookout', team: 'defense', color: 0xc08be8, weapon: 'rifle', speed: 2, armor: 2,
    ability: { id: 'camera', name: 'Security camera', charges: 2,
      desc: 'Stick a camera on a wall. Defenders view feeds with C. Everyone can see it and attackers can shoot it down.' },
  },
  mason: {
    name: 'Mason', team: 'defense', color: 0x8d99a6, weapon: 'rifle', speed: 1, armor: 3,
    ability: { id: 'masonReinforce', name: 'Extra reinforcements', charges: 2,
      desc: 'Reinforce 2 more walls during prep (on top of the team\'s 10).' },
  },
  recruit_def: {
    name: 'Recruit', team: 'defense', color: 0xb0b6bd, weapon: 'rifle', speed: 2, armor: 2, unique: false,
    ability: null,
  },
};

for (const [id, op] of Object.entries(OPERATORS)) {
  op.id = id;
  op.unique = op.unique !== false;
}

export const operatorsFor = (team) => Object.values(OPERATORS).filter((o) => o.team === team);
export const defaultOperator = (team) => (team === 'attack' ? 'recruit_atk' : 'recruit_def');

const SPEED = [0.92, 1.0, 1.08];
const ARMOR = [1.15, 1.0, 0.85];   // damage taken multiplier
export const speedMultiplier = (op) => SPEED[(op?.speed ?? 2) - 1];
export const damageMultiplier = (op) => ARMOR[(op?.armor ?? 2) - 1];
