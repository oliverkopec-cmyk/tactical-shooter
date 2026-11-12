// Stage C0 load test: plays N clients against the test Worker (or `wrangler dev` on localhost).
//
//   node load.mjs --url https://breachline-c0-test.<you>.workers.dev --test play
//
// Tests (--test):
//   play     Clients join one room, the first starts a match (empty slots filled with bots), and every client sends
//            an input batch --rate times a second, like Stage C1's client will. Checks the 60 Hz loop keeps up,
//            and counts messages both ways.
//   silent   Same match, but after starting it no client sends anything at all for --seconds. Checks whether the
//            Durable Object is stopped for CPU when no messages come in to reset its CPU allowance (dead players and
//            spectators will send nothing in Stage C1).
//   idle     Clients connect and sit there with no match for --seconds, then each sends one ping. Checks that the
//            object hibernated meanwhile (its wake count goes up), so idle connections cost no duration.
//   flood    Clients send tiny messages as fast as --rate allows until --total messages have gone. Then checks the
//            Worker still answers. Settles whether 20 incoming WebSocket messages count as 1 request on Free.
//            Read the warning in README.md before running it.
//
// Other options: --clients 10 --rate 7 --seconds 300 --room <name> --no-bots --map villa --total 105000
//                --keepalive 10 (silent: one tiny message every 10 s) --rehome (silent: loop restarted from an alarm)

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const BASE = String(arg('url', 'http://localhost:8787')).replace(/\/$/, '');
const TEST = arg('test', 'play');
const CLIENTS = Number(arg('clients', TEST === 'play' ? 10 : TEST === 'silent' ? 1 : 10));
const RATE = Number(arg('rate', TEST === 'flood' ? 50 : 7));
const SECONDS = Number(arg('seconds', TEST === 'idle' ? 60 : TEST === 'silent' ? 360 : 300));
const TOTAL = Number(arg('total', 105_000));
const ROOM = arg('room', `${TEST}-${Date.now().toString(36)}`);
const FILL = !flag('no-bots');
const MAP = arg('map', null);
const KEEPALIVE = Number(arg('keepalive', 0));   // silent test: still send one tiny message every this many seconds
const REHOME = flag('rehome');                  // ask the object to restart its loop from an alarm every 15 s   // e.g. villa: a detailed map, about twice the CPU of dockside
const WS_BASE = BASE.replace(/^http/, 'ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text.slice(0, 300) }; }
};

let seqBase = 0;
function inputBatch(c, frames) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    c.frame++;
    c.yaw = (c.yaw + 0.01) % (Math.PI * 2);
    let keys = 1;
    if (c.frame % 240 < 60) keys |= 8;
    if (c.frame % 180 < 20) keys |= 256;
    if (c.frame % 600 < 120) keys |= 32768;
    out.push({ seq: ++c.seq, dt: 1 / 60, keys, yaw: +c.yaw.toFixed(4), pitch: 0, wsel: 0, rt: Date.now() });
  }
  return out;
}

function connect(i) {
  return new Promise((resolve) => {
    const c = { i, id: `c${i}`, seq: seqBase, frame: i * 37, yaw: i, sent: 0, sentBytes: 0, got: 0, gotBytes: 0, events: {}, pings: [], closed: null, ws: null };
    const ws = new WebSocket(`${WS_BASE}/room/${ROOM}/ws?id=${c.id}`);
    c.ws = ws;
    ws.addEventListener('open', () => resolve(c));
    ws.addEventListener('message', (e) => {
      c.got++;
      c.gotBytes += e.data.length;
      try {
        const [event, payload] = JSON.parse(e.data);
        c.events[event] = (c.events[event] || 0) + 1;
        if (event === 'pong' && typeof payload === 'number') c.pings.push(Date.now() - payload);
        if (event === 'started') c.started = payload;
      } catch { /* not ours */ }
    });
    ws.addEventListener('close', (e) => { c.closed = { code: e.code, reason: e.reason, at: Date.now() }; resolve(c); });
    ws.addEventListener('error', () => { /* close follows */ });
  });
}

const send = (c, obj) => {
  if (c.ws.readyState !== 1) return false;
  const text = JSON.stringify(obj);
  c.ws.send(text);
  c.sent++;
  c.sentBytes += text.length;
  return true;
};

console.log(`Test "${TEST}" against ${BASE}, room ${ROOM}: ${CLIENTS} clients, ${SECONDS}s${TEST === 'play' || TEST === 'flood' ? `, ${RATE} messages/s each` : ''}${TEST === 'flood' ? `, ${TOTAL} messages in all` : ''}`);
await getJson(`/room/${ROOM}/reset`);
const before = (await getJson(`/room/${ROOM}/stats`)).body;

const clients = [];
for (let i = 0; i < CLIENTS; i++) clients.push(await connect(i));
const open = clients.filter((c) => !c.closed);
console.log(`${open.length}/${CLIENTS} connected`);
if (!open.length) { console.log('Nothing connected. Is the URL right and the Worker deployed?'); process.exit(1); }

const t0 = Date.now();
let timers = [];
const progress = setInterval(() => {
  const sent = clients.reduce((a, c) => a + c.sent, 0), got = clients.reduce((a, c) => a + c.got, 0);
  const closed = clients.filter((c) => c.closed).length;
  process.stdout.write(`  ${Math.round((Date.now() - t0) / 1000)}s: sent ${sent}, received ${got}, disconnected ${closed}\n`);
}, 15_000);

if (TEST === 'play' || TEST === 'silent') {
  send(open[0], { t: 'start', fill: FILL, rehome: REHOME, ...(MAP ? { map: MAP } : {}) });
  await sleep(1500);
  console.log('Match:', JSON.stringify(open[0].started));
}

if (TEST === 'play') {
  for (const c of open) {
    let n = 0;
    timers.push(setInterval(() => {
      n++;
      const msg = { t: 'in', b: inputBatch(c, Math.round(60 / RATE)) };
      if (n % (RATE * 2) === 0) msg.p = Date.now();   // a ping rides along every 2 seconds
      send(c, msg);
    }, 1000 / RATE));
  }
  await sleep(SECONDS * 1000);
} else if (TEST === 'silent' || TEST === 'idle') {
  if (KEEPALIVE > 0) for (const c of open) timers.push(setInterval(() => send(c, { t: 'x' }), KEEPALIVE * 1000));
  await sleep(SECONDS * 1000);
  const mid = (await getJson(`/room/${ROOM}/stats`)).body;
  console.log(`After ${SECONDS}s of silence: wakes ${mid.wakes - (before.wakes || 0)} (the stats request itself may wake it), ticks ${mid.ticks}, late ticks ${mid.lateTicks}, sockets open ${mid.current?.socketsOpen}, match running ${mid.current?.running}`);
  for (const c of open) send(c, { t: 'ping', p: Date.now() });
  await sleep(3000);
} else if (TEST === 'flood') {
  const per = Math.ceil(TOTAL / open.length);
  await Promise.all(open.map(async (c) => {
    while (c.sent < per && !c.closed) {
      send(c, { t: 'x' });
      await sleep(1000 / RATE);
    }
  }));
  await sleep(3000);
}

for (const t of timers) clearInterval(t);
clearInterval(progress);
const wall = (Date.now() - t0) / 1000;
const after = await getJson(`/room/${ROOM}/stats`);
for (const c of clients) try { c.ws.close(1000); } catch { /* gone */ }

const sent = clients.reduce((a, c) => a + c.sent, 0);
const got = clients.reduce((a, c) => a + c.got, 0), gotBytes = clients.reduce((a, c) => a + c.gotBytes, 0);
const pings = clients.flatMap((c) => c.pings).sort((a, b) => a - b);
const s = after.body || {};
const tickWindows = (s.windows || []).filter((w) => w.ticks > 0);
const tickRates = tickWindows.map((w) => w.ticks / w.sec);

console.log('\n==== Result ====');
console.log(JSON.stringify({
  test: TEST, room: ROOM, seconds: Math.round(wall),
  clients: { connected: open.length, disconnectedEarly: clients.filter((c) => c.closed && c.closed.at < t0 + wall * 1000 - 1000).map((c) => ({ id: c.id, ...c.closed })) },
  sent: { messages: sent, perClientPerSecond: +(sent / Math.max(1, open.length) / wall).toFixed(2) },
  received: { messages: got, KBPerClientPerSecond: +(gotBytes / 1024 / Math.max(1, open.length) / wall).toFixed(2) },
  pingMs: pings.length ? { p50: pings[Math.floor(pings.length / 2)], p95: pings[Math.floor(pings.length * 0.95)] } : null,
  durableObject: after.status === 200 ? {
    msgsInCounted: s.msgsIn, ticks: s.ticks, lateTicks: s.lateTicks, maxTickGapMs: s.maxTickGapMs,
    tickRatePerWindow: tickRates.length ? { min: +Math.min(...tickRates).toFixed(1), max: +Math.max(...tickRates).toFixed(1) } : null,
    wakes: s.wakes, alarms: s.alarms, rehome: s.rehome, matchesStarted: s.matchesStarted, closeCodes: s.closeCodes, errors: s.errors, current: s.current,
  } : { status: after.status, body: after.body },
}, null, 2));

if (TEST === 'flood') {
  console.log('\nIs the Worker still answering after the flood? A fresh room must still open:');
  const probe = await getJson(`/room/probe-${Date.now().toString(36)}/stats`);
  console.log(`  status ${probe.status}${probe.status === 200 ? ' -> yes: those messages did NOT use up 100,000 requests (the 20:1 ratio, or better, applies on Free)' : ` -> NO: ${JSON.stringify(probe.body).slice(0, 200)}`}`);
}
process.exit(0);
