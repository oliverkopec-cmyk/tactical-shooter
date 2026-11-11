// Stage C0 local benchmark: how much CPU and memory a real Breachline match uses, measured in Node on this machine.
// Runs the real game code (rooms, GameState, bots, rounds, gadgets) in real time at 60 ticks a second.
//
//   node --expose-gc cloudflare-test/bench.mjs [--players 1] [--matches 1] [--seconds 120] [--map villa]
//
// --players: fake humans per match (they send inputs like a client; the other slots are bots).
// --matches: matches at once in this one process (Cloudflare can put several Durable Objects in one isolate,
//            and an isolate has 128 MB in all).

import { GameState } from '../server/gameState.js';
import { navFor } from '../server/nav.js';
import { getMap } from '../shared/map.js';
import { TestMatch, FakeInputs } from './src/harness.js';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const PLAYERS = Number(arg('players', 1));
const MATCHES = Number(arg('matches', 1));
const SECONDS = Number(arg('seconds', 120));
const MAP = arg('map', null);
const SEND_RATE = 7;   // input batches a second, as Stage C1 will send them

const gc = () => { if (global.gc) { global.gc(); global.gc(); } };
const mb = (b) => (b / 1048576).toFixed(1);

// Time spent in every tick, across all matches
const tickMs = [];
const realUpdate = GameState.prototype.update;
GameState.prototype.update = function update() {
  const t0 = performance.now();
  realUpdate.call(this);
  tickMs.push(performance.now() - t0);
};

gc();
const heap0 = process.memoryUsage();

// The bots' walking grid is built once per map and shared by every match on it
const navStart = performance.now();
const mapId = MAP || new TestMatch().room.mapId;
navFor(getMap(mapId));
const navMs = performance.now() - navStart;
gc();
const heapNav = process.memoryUsage();

let bytesOut = 0, messagesOut = 0;
const matches = [];
for (let m = 0; m < MATCHES; m++) {
  const match = new TestMatch({ mapId });
  const humans = [];
  for (let i = 0; i < PLAYERS; i++) {
    const id = `m${m}p${i}`;
    match.addPlayer(id, (event, payload) => { bytesOut += JSON.stringify([event, payload]).length; messagesOut++; });
    humans.push({ id, inputs: new FakeInputs(i + m) });
  }
  const res = match.start({ fill: true });
  if (res.error) throw new Error(res.error);
  matches.push({ match, humans });
}

// Clients send a batch SEND_RATE times a second holding every frame since the last one
const cpu0 = process.cpuUsage();
const wall0 = performance.now();
const senders = setInterval(() => {
  for (const { match, humans } of matches) for (const h of humans) match.room.handleInputs(h.id, h.inputs.batch(Math.round(60 / SEND_RATE)));
}, 1000 / SEND_RATE);

// heapUsed includes garbage not yet collected. What counts against 128 MB is what is still alive after a collection:
// every 5 seconds, collect and measure that ("retained").
let peakHeap = 0, peakRetained = 0;
const sampler = setInterval(() => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); }, 500);
const retainedSampler = global.gc ? setInterval(() => { gc(); peakRetained = Math.max(peakRetained, process.memoryUsage().heapUsed); }, 5000) : null;

await new Promise((r) => setTimeout(r, SECONDS * 1000));
clearInterval(senders);
clearInterval(sampler);
clearInterval(retainedSampler);
const wall = (performance.now() - wall0) / 1000;
const cpu = process.cpuUsage(cpu0);
const heapLive = process.memoryUsage();
for (const { match } of matches) match.stop();

tickMs.sort((a, b) => a - b);
const pct = (p) => tickMs[Math.min(tickMs.length - 1, Math.floor(tickMs.length * p))].toFixed(2);
const sum = tickMs.reduce((a, b) => a + b, 0);
const cpuSec = (cpu.user + cpu.system) / 1e6;

console.log(JSON.stringify({
  setup: { map: mapId, matches: MATCHES, humansPerMatch: PLAYERS, botsPerMatch: matches[0].match.bots, seconds: Math.round(wall) },
  ticks: {
    count: tickMs.length,
    perSecondPerMatch: +(tickMs.length / wall / MATCHES).toFixed(1),
    msMean: +(sum / tickMs.length).toFixed(3), msP50: +pct(0.5), msP95: +pct(0.95), msP99: +pct(0.99), msMax: +tickMs.at(-1).toFixed(2),
  },
  cpu: {
    processCpuSeconds: +cpuSec.toFixed(2),
    cpuMsPerWallSecondPerMatch: +((cpuSec * 1000) / wall / MATCHES).toFixed(1),
    tickCpuMsPerWallSecondPerMatch: +(sum / wall / MATCHES).toFixed(1),
  },
  memoryMB: {
    heapBefore: mb(heap0.heapUsed), heapAfterNavGrid: mb(heapNav.heapUsed), navGridBuildMs: Math.round(navMs),
    heapPeakWithMatches: mb(peakHeap), heapEnd: mb(heapLive.heapUsed),
    retainedPeak: mb(peakRetained), retainedPerMatch: mb((peakRetained - heapNav.heapUsed) / MATCHES),
    perMatchApprox: mb((peakHeap - heapNav.heapUsed) / MATCHES), rss: mb(heapLive.rss),
  },
  network: {
    outMessagesPerSecondPerHuman: +(messagesOut / wall / Math.max(1, PLAYERS * MATCHES)).toFixed(1),
    outKBPerSecondPerHumanUncompressed: +(bytesOut / 1024 / wall / Math.max(1, PLAYERS * MATCHES)).toFixed(1),
  },
  matchesPlayed: matches.reduce((a, m) => a + m.match.matches, 0),
}, null, 2));
process.exit(0);
