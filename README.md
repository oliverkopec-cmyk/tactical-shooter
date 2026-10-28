# Breachline

A browser-based multiplayer 3D tactical attack/defend shooter. Three.js + Vite on the client, Node.js + Socket.IO on an authoritative server. One Node process serves both the game client and the realtime server, so the whole thing deploys as a single Render web service.

## Status: Stage 2 (shooting)

- Enter a name, create a room (4-letter code) or join one
- Pick Attack or Defense in the lobby (max 5 per team); the host starts the match
- First-person movement: WASD, mouse look (pointer lock), Shift sprint, Ctrl or Z crouch, Q/E lean
- Server-authoritative movement with client-side prediction, reconciliation and interpolation of other players
- Two-storey map with interior and exterior stairs, a balcony, and the objective box
- Hitscan weapons (rifle, SMG, shotgun) with recoil, spread, magazines and reload (R)
- Server-side, lag-compensated hit detection; headshots deal extra damage
- Health, death, spectating teammates, and a temporary 5 s respawn until the round system lands
- HUD: health, ammo, dynamic crosshair, hit markers, damage direction, kill feed
- Keys 1/2/3 switch weapon for testing until operators choose weapons

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 in two tabs. Vite serves the client with hot reload and proxies `/socket.io` to the game server on port 3000.

To run the production build the same way Render does:

```bash
npm run build && npm start
```

Then open http://localhost:3000.

Add `?debug` to the URL to expose `window.breachline` (game, network, ui) in the console.

## Project layout

```
shared/            Code used by BOTH client and server
  constants.js     tuning values, key bit flags, team colours
  map.js           map geometry (axis-aligned boxes), spawns, objective
  movement.js      deterministic movement + collision (prediction and authority)
  weapons.js       weapon stats + deterministic ammo/fire-rate/reload/spread
  raycast.js       ray tests against the map and player hitboxes
server/
  index.js         Express static hosting + Socket.IO events
  rooms.js         room codes, join/leave, teams, host
  gameState.js     authoritative simulation and snapshots per room
  combat.js        pose history (lag compensation) and shot resolution
client/
  index.html       lobby screens + HUD markup
  src/main.js      wires UI, network, game
  src/network.js   Socket.IO wrapper, server clock estimate
  src/game.js      Three.js scene and frame loop
  src/player.js    local player: input, prediction, reconciliation, camera
  src/avatars.js   other players: bodies, guns, name tags, interpolation
  src/weapons.js   first-person gun models, recoil/reload animation
  src/effects.js   tracers, bullet holes, impact puffs
  src/audio.js     synthesised gunshots and UI sounds
  src/map.js       renders the shared map, lighting
  src/ui.js        lobby and HUD DOM
```

## Netcode

- The client samples input every frame, simulates it immediately with `shared/movement.js` (prediction), and sends batches to the server 30 times a second.
- The server replays each input through the same movement code. A per-player time budget stops a client from moving faster by sending inputs faster than real time.
- 20 times a second the server broadcasts a snapshot with each player's state and the last input it processed.
- The local player rewinds to the server state and replays unacknowledged inputs; any small difference is smoothed out over a few frames.
- Other players are drawn 100 ms in the past, interpolated between snapshots.
- Firing is part of the input stream, so ammo, fire rate and spread are simulated identically on both sides (spread uses a PRNG seeded by the input number). Each firing input carries the time the shooter was viewing other players at; the server rewinds targets to that moment (at most 350 ms) and tests the ray against their hitboxes and the map.

## Deploying to Render

`render.yaml` describes the service. Settings if you create it by hand:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm install --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/healthz` |

Render provides `PORT`; the server reads it automatically. WebSockets work on Render web services without extra configuration.
