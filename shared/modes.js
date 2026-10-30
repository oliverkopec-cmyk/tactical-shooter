// Game modes the host can pick in the lobby.
//
//   standard   attackers hold the objective zone for 10 seconds (or eliminate every defender)
//   defuser    one attacker carries the defuser and plants it at the defenders' site; it then
//              counts down and the defenders must disable it

export const MODES = {
  standard: { id: 'standard', name: 'Secure the objective', description: 'Attackers hold the objective zone for 10 seconds, or eliminate every defender. Defenders run out the clock.' },
  defuser: { id: 'defuser', name: 'Defuser', description: 'One attacker carries the defuser. Plant it at the defenders\' site (hold for 7 s); defenders disable it (hold for 7 s) before the 45 s countdown ends.' },
};

export const MODE_IDS = Object.keys(MODES);
export const DEFAULT_MODE_ID = 'standard';

export const DEFUSER = {
  plantS: 7,            // seconds the carrier must hold the key inside the objective zone
  disableS: 7,          // seconds a defender must hold it beside the planted defuser
  countdownS: 45,       // from planting to going off
  pickupReach: 1.4,     // an attacker this close to a dropped defuser picks it up
  stillSpeed: 0.6,      // planting and disabling need you to keep still (m/s)
};
