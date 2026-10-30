// Every voice line in the game, in one place. The server decides WHEN an operator speaks (it sends a
// line key, e.g. 'reload'); the client picks one of the lines below and speaks it with the browser's
// speech synthesis, in the operator's own voice (pitch and speed from OPERATOR_VOICE).
//
// To swap in recorded audio later: give a key an `audio` list of file URLs the same length as `lines`
// (e.g. reload: { lines: [...], audio: ['/voice/reload1.mp3', ...] }) and client/src/voice.js will play
// the file instead of speaking the text.

export const VOICE_LINES = {
  ability: { lines: ['Using my ability!', 'Ability out!', 'Here it comes!'] },
  utility: { lines: ['Utility out!', 'Throwing!', 'Fire in the hole!'] },
  reload: { lines: ['Reloading!', 'Changing mag!', 'Cover me, reloading!'] },
  ping: { lines: ['Look here.', 'Over here.', 'Check this.'] },
  pingEnemy: { lines: ['Enemy here!', 'Contact here!', 'Hostile spotted there!'] },
  pingGo: { lines: ['Go here!', 'Move up here!', 'Let\'s go this way!'] },
  pingDanger: { lines: ['Danger here!', 'Watch out there!', 'Careful, over there!'] },
  pingHelp: { lines: ['I need help!', 'Need backup here!', 'Help me out!'] },
  pingDefend: { lines: ['Defending here!', 'Holding this spot!', 'I\'ve got this area!'] },
  kill: { lines: ['Got one!', 'Enemy down!', 'Target down!'] },
  spot: { lines: ['Enemy spotted!', 'I see one!', 'Eyes on an enemy!'] },
  plant: { lines: ['Planting the defuser!', 'Cover me, I\'m planting!'] },
  disable: { lines: ['Disabling the defuser!', 'Cover me, I\'m disabling it!'] },
};

export const VOICE_KEYS = Object.keys(VOICE_LINES);

/** How long the same operator waits before saying the same kind of line again, and before saying anything at all (ms). */
export const VOICE_COOLDOWN = { sameKey: 6000, any: 1800 };

/** Each operator's voice. Operators not listed get one worked out from their id. */
export const OPERATOR_VOICE = {
  spark: { pitch: 1.05, rate: 1.1 },
  hawk: { pitch: 0.8, rate: 1.0 },
  bulwark: { pitch: 0.55, rate: 0.92 },
  warden: { pitch: 0.65, rate: 0.95 },
  jammer: { pitch: 1.25, rate: 1.12 },
  mason: { pitch: 0.7, rate: 0.9 },
};

export function voiceFor(opId) {
  if (OPERATOR_VOICE[opId]) return OPERATOR_VOICE[opId];
  let h = 0;
  for (const c of String(opId || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { pitch: 0.6 + (h % 9) * 0.1, rate: 0.92 + ((h >> 4) % 5) * 0.05 };
}

/** Team pings: the wheel's choices (the quick tap is 'auto': it names what you aimed at). */
export const PING_TYPES = {
  auto: { label: 'Ping', color: '#ffd23c', voice: 'ping' },
  enemy: { label: 'Enemy here', color: '#ff3b3b', voice: 'pingEnemy' },
  go: { label: 'Go here', color: '#3bd16f', voice: 'pingGo' },
  danger: { label: 'Danger', color: '#ff9a2e', voice: 'pingDanger' },
  help: { label: 'Need help', color: '#c56bff', voice: 'pingHelp' },
  defend: { label: 'Defending here', color: '#3ba3ff', voice: 'pingDefend' },
};
export const PING = { ms: 5000, range: 80, cooldownMs: 600, markMs: 2000, perPlayer: 2 };
