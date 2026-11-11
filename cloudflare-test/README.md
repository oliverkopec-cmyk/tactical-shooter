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
