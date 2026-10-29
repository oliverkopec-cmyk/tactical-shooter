// Operator definitions, shared by client and server.
//
// To add an operator: add one entry here, and (if it has an ability) write the
// ability's server handler in server/abilities.js under the same `ability.id`.
//
//   team:    'attack' | 'defense'
//   weapons: { primary, secondary }, ids from shared/weapons.js (unique to each operator)
//   utilities: two ids from shared/utilities.js; the player picks one before each round
//   speed:   1-3 rating (1 slow ... 3 fast)         armor: 1-3 rating (1 fragile ... 3 tough)
//   price:   Money to buy it in the Operators tab (no price = free for everyone)
//   unique:  only one player per team can be this operator (default true)
//   extraDrones: attackers only, drones on top of the standard one
//   ability: { id, name, desc, charges }  or  { id, name, desc, cooldown } (seconds)

export const OPERATORS = {
  // ---------------------------------------------------------------- attackers
  spark: {
    name: 'Spark', team: 'attack', color: 0xff7a2e, weapons: { primary: 'ember', secondary: 'sidewinder' }, utilities: ['impact', 'frag'], speed: 2, armor: 2,
    ability: { id: 'heavyBreach', name: 'Heavy breach charge', charges: 1,
      desc: 'Plant on a wall, press {ability} again to blow it. Destroys reinforced walls.' },
  },
  hawk: {
    name: 'Hawk', team: 'attack', color: 0xf2c230, weapons: { primary: 'smg', secondary: 'sting' }, utilities: ['smoke', 'flash'], speed: 3, armor: 1, extraDrones: 2,
    ability: { id: 'sonarPing', name: 'Sonar ping', cooldown: 8,
      desc: 'Ping the enemy under your crosshair, like a drone does: a marker shows above their head for 3 s. Also controls 2 extra drones.' },
  },
  bulwark: {
    name: 'Bulwark', team: 'attack', color: 0x6fb8d8, weapons: { primary: 'shotgun', secondary: 'anvil' }, utilities: ['frag', 'claymore'], speed: 1, armor: 3,
    ability: { id: 'shield', name: 'Portable shield', charges: 1,
      desc: 'Deploy a bulletproof shield in front of you. Press {ability} next to it to pick it up again.' },
  },
  flash: {
    name: 'Flash', team: 'attack', color: 0xe8e8ff, weapons: { primary: 'gale', secondary: 'needle' }, utilities: ['smoke', 'impact'], speed: 3, armor: 1,
    ability: { id: 'stun', name: 'Stun grenade', charges: 3,
      desc: 'Throw a grenade that blinds and slows enemies in sight for 4 s.' },
  },
  tremor: {
    name: 'Tremor', team: 'attack', color: 0x6fd0ff, weapons: { primary: 'rift', secondary: 'tick' }, utilities: ['flash', 'claymore'], speed: 2, armor: 2, price: 2500,
    ability: { id: 'seismicPulse', name: 'Seismic pulse', charges: 3,
      desc: 'Reveal every moving enemy within 12 m through walls for 3 s, as markers for your whole team.' },
  },
  cinder: {
    name: 'Cinder', team: 'attack', color: 0xff7a1a, weapons: { primary: 'kiln', secondary: 'pyre' }, utilities: ['frag', 'smoke'], speed: 2, armor: 3, price: 3000,
    ability: { id: 'fireCanister', name: 'Fire canister', charges: 2,
      desc: 'Throw a canister that leaves a fire patch for 8 s. It burns enemies standing in it and blocks a doorway.' },
  },
  surge: {
    name: 'Surge', team: 'attack', color: 0xb06bff, weapons: { primary: 'arc', secondary: 'jolt' }, utilities: ['flash', 'impact'], speed: 3, armor: 1, price: 3000,
    ability: { id: 'emp', name: 'EMP burst', charges: 2,
      desc: 'Destroy defender cameras and signal jammers within 10 m of where you aim.' },
  },
  recruit_atk: {
    name: 'Recruit', team: 'attack', color: 0xb0b6bd, weapons: { primary: 'rifle', secondary: 'sidekick' }, utilities: ['frag', 'smoke'], speed: 2, armor: 2, unique: false,
    ability: null,
  },

  // ---------------------------------------------------------------- defenders
  warden: {
    name: 'Warden', team: 'defense', color: 0xb7664a, weapons: { primary: 'bastion', secondary: 'gavel' }, utilities: ['claymore', 'frag'], speed: 1, armor: 3,
    ability: { id: 'barbedWire', name: 'Barbed wire', charges: 2,
      desc: 'Lay wire on the floor. Anyone walking through it is slowed.' },
  },
  jammer: {
    name: 'Jammer', team: 'defense', color: 0x57d68d, weapons: { primary: 'pulse', secondary: 'zap' }, utilities: ['claymore', 'flash'], speed: 3, armor: 1,
    ability: { id: 'jammerDevice', name: 'Signal jammer', charges: 1,
      desc: 'Place a device that disables drones and breach charges within 5 m.' },
  },
  lookout: {
    name: 'Lookout', team: 'defense', color: 0xc08be8, weapons: { primary: 'longview', secondary: 'peep' }, utilities: ['flash', 'smoke'], speed: 2, armor: 2,
    ability: { id: 'camera', name: 'Security camera', charges: 2,
      desc: 'Stick a camera on a wall. Defenders view feeds with C. Everyone can see it and attackers can shoot it down.' },
  },
  mason: {
    name: 'Mason', team: 'defense', color: 0x8d99a6, weapons: { primary: 'keystone', secondary: 'trowel' }, utilities: ['claymore', 'impact'], speed: 1, armor: 3,
    ability: { id: 'masonReinforce', name: 'Extra reinforcements', charges: 2,
      desc: 'Reinforce 2 more walls during prep (on top of the team\'s 10).' },
  },
  volt: {
    name: 'Volt', team: 'defense', color: 0x39f0ff, weapons: { primary: 'livewire', secondary: 'static' }, utilities: ['claymore', 'smoke'], speed: 2, armor: 2, price: 2500,
    ability: { id: 'shockTrap', name: 'Shock trap', charges: 3,
      desc: 'Place a floor trap. An attacker who steps on it takes damage, is slowed for 2 s and is marked for your team.' },
  },
  tonic: {
    name: 'Tonic', team: 'defense', color: 0x6fdc7a, weapons: { primary: 'syringe', secondary: 'dose' }, utilities: ['smoke', 'flash'], speed: 2, armor: 1, price: 3000,
    ability: { id: 'healField', name: 'Healing field', charges: 2,
      desc: 'Place a field that heals teammates inside it, about 5 HP a second for 10 s.' },
  },
  picket: {
    name: 'Picket', team: 'defense', color: 0xd8c84a, weapons: { primary: 'watchman', secondary: 'chirp' }, utilities: ['claymore', 'frag'], speed: 3, armor: 2, price: 2000,
    ability: { id: 'alarmSensor', name: 'Alarm sensor', charges: 3,
      desc: 'Stick a sensor to a wall or floor. Three faint lines mark any attacker who touches them for 3 s. It never goes off.' },
  },
  recruit_def: {
    name: 'Recruit', team: 'defense', color: 0xb0b6bd, weapons: { primary: 'garrison', secondary: 'holdout' }, utilities: ['frag', 'flash'], speed: 2, armor: 2, unique: false,
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
