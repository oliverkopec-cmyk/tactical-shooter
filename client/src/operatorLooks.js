// What each operator wears (Stage O): all original designs, in the colours of their icon, so you can tell who's who
// at a glance. client/src/avatarModel.js turns this into shapes.
//
//   head    helmet | heavy | cap | backcap | beanie | boonie | hardhat | beret | ushanka | medcap | bandana | headset | hood
//   face    goggles | gasmask | balaclava | visor | shades | halfmask | welder | nvg | none
//   vest    plate | heavy | rig | apron | medic
//   back    radio | pack | tanks | medbag | coil | spool | dish | tools | hammer | camera | charges | none
//   chest   what is carried on the front: mags | grenades | charges | tools | med | wires
//   build   lean | normal | heavy (only the shapes on top: everyone keeps the same hitbox)
//   skin    skin tone. suit / vest colours are worked out from the icon's colour unless given here.

const S = { a: 0xf0c8a4, b: 0xd9a57f, c: 0xb37d55, d: 0x8a5a3a, e: 0x5e3b26 };

export const LOOKS = {
  // ---------------------------------------------------------------- attackers
  spark: { head: 'helmet', face: 'welder', vest: 'plate', back: 'charges', chest: 'charges', skin: S.b },
  hawk: { head: 'boonie', face: 'shades', vest: 'rig', back: 'radio', chest: 'mags', build: 'lean', skin: S.c },
  bulwark: { head: 'heavy', face: 'visor', vest: 'heavy', back: 'pack', chest: 'mags', build: 'heavy', skin: S.a },
  flash: { head: 'beret', face: 'goggles', vest: 'rig', back: 'none', chest: 'grenades', build: 'lean', skin: S.a, suit: 0xc8ccd8, vestColor: 0x8a90a8 },
  tremor: { head: 'headset', face: 'goggles', vest: 'plate', back: 'dish', chest: 'tools', skin: S.d },
  cinder: { head: 'hood', face: 'gasmask', vest: 'plate', back: 'tanks', chest: 'grenades', skin: S.b },
  surge: { head: 'helmet', face: 'visor', vest: 'plate', back: 'coil', chest: 'wires', skin: S.e },
  blackout: { head: 'beret', face: 'gasmask', vest: 'rig', back: 'radio', chest: 'grenades', skin: S.a },
  wasp: { head: 'backcap', face: 'goggles', vest: 'rig', back: 'pack', chest: 'tools', build: 'lean', skin: S.b },
  flint: { head: 'bandana', face: 'shades', vest: 'rig', back: 'none', chest: 'charges', build: 'lean', skin: S.c },
  ram: { head: 'beanie', face: 'balaclava', vest: 'heavy', back: 'hammer', chest: 'mags', build: 'heavy', skin: S.b },
  aegis: { head: 'heavy', face: 'visor', vest: 'heavy', back: 'none', chest: 'mags', build: 'heavy', skin: S.c },
  recruit_atk: { head: 'helmet', face: 'none', vest: 'plate', back: 'none', chest: 'mags', skin: S.b, suit: 0x565c63, vestColor: 0x34383e },
  // ---------------------------------------------------------------- defenders
  warden: { head: 'cap', face: 'halfmask', vest: 'plate', back: 'spool', chest: 'wires', skin: S.c },
  jammer: { head: 'headset', face: 'shades', vest: 'rig', back: 'radio', chest: 'wires', build: 'lean', skin: S.d },
  lookout: { head: 'beanie', face: 'nvg', vest: 'rig', back: 'camera', chest: 'tools', build: 'lean', skin: S.a },
  mason: { head: 'hardhat', face: 'halfmask', vest: 'apron', back: 'tools', chest: 'tools', build: 'heavy', skin: S.d },
  volt: { head: 'helmet', face: 'goggles', vest: 'plate', back: 'coil', chest: 'wires', skin: S.c },
  tonic: { head: 'medcap', face: 'halfmask', vest: 'medic', back: 'medbag', chest: 'med', build: 'lean', skin: S.a },
  picket: { head: 'boonie', face: 'goggles', vest: 'rig', back: 'radio', chest: 'wires', skin: S.e },
  current: { head: 'cap', face: 'goggles', vest: 'plate', back: 'coil', chest: 'tools', skin: S.b },
  rampart: { head: 'hardhat', face: 'visor', vest: 'heavy', back: 'tools', chest: 'tools', build: 'heavy', skin: S.c },
  medic: { head: 'beret', face: 'none', vest: 'medic', back: 'medbag', chest: 'med', skin: S.e },
  interceptor: { head: 'ushanka', face: 'goggles', vest: 'plate', back: 'dish', chest: 'mags', skin: S.a },
  recruit_def: { head: 'cap', face: 'none', vest: 'plate', back: 'none', chest: 'mags', skin: S.c, suit: 0x565c63, vestColor: 0x34383e },
};
