# Stage C0: can Breachline run on Cloudflare Workers Free?

A throwaway test, not part of the game. Nothing here changes how Breachline runs on Render: the live game, `server/`,
`client/` and the root `package.json` are untouched. This folder has its own `package.json`, and the test deploys as
its own Worker, `breachline-c0-test`.

## What it tests

`src/worker.js` is a Worker with one Durable Object class, `MatchTest` (SQLite backend, the only kind Workers Free
allows). Each test room is one Durable Object running **the real match code**: `server/rooms.js`, `GameState`, bots,
rounds, gadgets and snapshots at 60 ticks a second, with a small stand-in for Socket.IO (`src/harness.js`). Players
connect with plain WebSockets through the Hibernation API (`ctx.acceptWebSocket`). The object counts messages both
ways, ticks and late ticks (gaps over 40 ms), and wakes from hibernation, and saves the counts in its storage.

`load.mjs` plays the clients from your computer. `bench.mjs` runs the same match code in Node to measure CPU and
memory, which the Workers runtime can't measure from the inside (its clock stands still while code runs).

| Test | Question it answers |
|---|---|
| `bench.mjs` (local) | CPU per tick and memory for a 10-player match, and for 4 matches sharing 128 MB |
| `load.mjs --test play` | Does the 60 Hz loop keep up on Cloudflare with 10 players sending 7 batches a second? |
| `load.mjs --test silent` | 1 player + 9 bots and no incoming messages for 6 minutes: is the object stopped for CPU? (Each incoming message resets its CPU allowance. Dead players, spectators and menus will send nothing in Stage C1.) |
| `load.mjs --test idle` | With connections open and no match, does the object hibernate (no duration charged)? |
| `load.mjs --test flood` | Do 105,000 incoming WebSocket messages use up the 100,000 requests a day, or does 20:1 apply on Free? |
| `/cpu?kind=pbkdf2`, `/cpu?kind=bcrypt` | Can a plain Worker (10 ms CPU on Free) check a password? Same again inside a Durable Object at `/room/x/cpu?kind=...` |

## Deploying it

You need Node 20 or newer and your Cloudflare account. From the repo:

```bash
cd cloudflare-test
npm install
npx wrangler login
```

`wrangler login` opens Cloudflare in your browser: log in and press **Allow**. Back in the terminal it says
"Successfully logged in". `npx wrangler whoami` shows the account. Then:

```bash
npx wrangler deploy
```

The first time, if your account has no `workers.dev` subdomain yet, wrangler asks you to pick one (any name you like).
When it's done it prints the address, like `https://breachline-c0-test.<your-subdomain>.workers.dev`. Opening it
in a browser shows "Breachline Stage C0 test Worker".

## Running the tests

Replace `URL` with that address. Each prints a result at the end.

```bash
node load.mjs --url URL --test play
node load.mjs --url URL --test silent
node load.mjs --url URL --test idle
curl "URL/cpu?kind=pbkdf2"
curl "URL/cpu?kind=bcrypt"
curl "URL/room/cpu/cpu?kind=bcrypt"
```

While they run, `npx wrangler tail` in a second terminal shows each event, with `exceededCpu` or `exceededMemory` if a
limit is hit. Afterwards the dashboard shows the same: Workers & Pages → breachline-c0-test → Metrics and
Observability (CPU time per invocation), and Storage & Databases → Durable Objects.

### The flood test (optional, run it last)

```bash
node load.mjs --url URL --test flood
```

It sends 105,000 tiny messages in about 4 minutes. If 20 messages count as 1 request on Free, that is about 5,250
requests and nothing happens. If they count 1 to 1, it uses up the whole day's 100,000 Durable Object requests:
every Durable Object on the account stops answering until 00:00 UTC (11:00 in Sydney in summer). Breachline on
Render isn't affected. Run it shortly before 11:00 Sydney time so that, at worst, it is only out for a short while.

## Removing it

```bash
npx wrangler delete
```

## Local runs

`npx wrangler dev` runs it on http://localhost:8787 (no Cloudflare limits apply there). `npm run bench -- --map villa`
runs the Node benchmark.

## Results on Cloudflare (11 November 2026, Workers Free)

**Verdict: yes.** Breachline can run on Workers Free, for roughly **30 to 75 player-hours a day**. The match loop has to be restarted from an alarm every 15 seconds (see "CPU" below), or the room is reset after about 5 minutes.

| Test | Result |
|---|---|
| `play`: 10 clients, Dockside, 5 min | 20,981 messages in, all counted. 62.5 ticks/s through intro, prep, action and round 2. 0 late ticks, longest gap between ticks 16 ms. Ping p50 38 ms, p95 113 ms. No disconnects |
| `silent`: 1 player + 9 bots, Dockside, 6 min | Passed. The loop used 18.1 s of CPU, about 50 ms per second of match |
| `silent`: 1 player + 9 bots, Villa, 10 min | **Reset after about 350 s**: "Durable Object exceeded its CPU time limit and was reset" (`exceededCpu`), at 32.5 s of CPU, about 92 ms per second of match |
| `silent --keepalive 10`: Villa, 9 min | Passed. 34,028 ticks, 0 late. Each keepalive takes over the loop's CPU (1.0–1.9 s per 10 s) |
| `silent --rehome`: Villa, 9 min | Passed. 34,024 ticks, 0 late, 36 alarms, each owning 1.3–3.5 s of CPU |
| `idle`: 5 sockets, no match, 60 s | Hibernated (wakes 1 → 2), all 5 sockets stayed connected |
| `flood`: 105,000 tiny messages in 226 s | All counted. A fresh Durable Object still opened afterwards. About 126,000 incoming messages that day, so they don't count 1:1. **20:1 (or better) applies on Free** |
| `/cpu` in a plain Worker | PBKDF2 100,000 iterations: 17 ms CPU. bcrypt cost 11: 176 ms. Spin: 301 ms. All succeeded despite the nominal 10 ms limit |
| `/cpu` in a Durable Object | PBKDF2 19 ms, bcrypt 177 ms, both fine (30 s limit) |
| Memory | No `exceededMemory`. In Node, a match keeps 15–31 MB live, and 4 matches together 25 MB |

### CPU: what was learnt
- A Durable Object gets **30 s of CPU per invocation on Free**. Each incoming message, request or alarm is a new invocation.
- A `setInterval` loop's CPU is charged to the invocation that is current when it runs. If no message comes in, all the loop's CPU stays with the message that started it, and a busy match runs out after 5–10 minutes.
- **Stage C3 fix:** restart the 60 Hz loop from a Durable Object alarm every 15 s (`alarm()` in `src/worker.js`). It works when every player is dead, spectating or in menus, and costs about 240 requests (12 at 20:1) per match-hour.
- Clients may also send a keepalive, but the server must not depend on it.
- `setInterval(…, 1000 / 60)` runs at 62.5 Hz on Cloudflare (16 ms timers). The game uses real elapsed time, so play is correct. C3 should use a fixed-step loop for exactly 60.

### Capacity on Free
- **Duration** (13,000 GB-s a day, charged at 128 MB): about **29 match-hours a day** for all matches together. A match keeps its object awake the whole time. Lobbies and the central object must hibernate.
- **Requests** (100,000 a day; WebSocket messages 20:1): a living player sending 7 batches a second uses 1,260 an hour. Dead or spectating players send next to nothing.
- **All matches 1 player + 9 bots:** duration is the limit, about **29 player-hours a day**.
- **Full 10-human matches:** requests are the limit, about **75 player-hours a day** (about 7.5 match-hours), less page loads and API calls.
- Mixed lobbies fall in between.

### Passwords
bcrypt at cost 11 took 176 ms of CPU in a plain Worker and wasn't stopped, but the Free limit is 10 ms, so it could be stopped under load. Stage C2 should check passwords (old bcrypt and new PBKDF2) inside a Durable Object, which has 30 s of CPU, or accept that risk.
