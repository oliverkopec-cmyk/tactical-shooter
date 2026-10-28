# Breachline

A browser-based multiplayer 3D tactical attack/defend shooter. Three.js + Vite on the client, Node.js + Socket.IO on an authoritative server. One Node process serves both the game client and the realtime server, so the whole thing deploys as a single Render web service.

## Status: Stage 8 (barricades, melee, props, models)

- Enter a name, create a room (4-letter code) or join one
- Pick Attack or Defense in the lobby (max 5 per team); the host starts the match
- First-person movement: WASD, mouse look (pointer lock), Shift sprint, Ctrl or Z crouch, Q/E lean
- Server-authoritative movement with client-side prediction, reconciliation and interpolation of other players
- Two-storey map with interior and exterior stairs, a balcony, and the objective box
- Hitscan weapons (rifle, SMG, shotgun) with recoil, spread, magazines and reload (R)
- Server-side, lag-compensated hit detection; headshots deal extra damage
- Health, death and spectating teammates until the round ends
- HUD: health, ammo, dynamic crosshair, hit markers, damage direction, kill feed
- Interior walls are grids of ~0.5 m panels; bullets knock panels out, synced to everyone
- Attackers carry 1 breach charge (G to plant on a wall, G again to detonate)
- Round flow: get ready (6 s) → prep (30 s) → action (3 min) → score screen; first team to 4 rounds wins the match, then everyone returns to the lobby
- Attackers win by eliminating all defenders or holding the objective zone for 10 s (frozen while a defender contests it, reset if nobody holds it); defenders win by eliminating all attackers or running out the clock
- Dead players spectate teammates until the round ends (no respawns); sides swap after round 3; late joiners wait for the next round
- Breach charges only work in the action phase, wall reinforcement only in prep, and attackers wait in spawn during prep (drones arrive in stage 5)
- Operator select (20 s, ends early once everyone has picked) before every round. One player per team per operator; a Recruit with no ability is always available for the 5th player. Each operator sets weapon, speed and armor ratings, and one ability on **F**:

  | Operator | Weapon | Ability |
  | --- | --- | --- |
  | Spark (A) | Rifle | Heavy breach charge, 1 use. F plants, F detonates. Breaks reinforced walls |
  | Hawk (A) | SMG | Sonar ping on a 8 s cooldown: pings the enemy under his crosshair exactly like a drone pilot does (marker over their head for 3 s, no outlines through walls). Also pilots 2 extra drones (3 total) |
  | Bulwark (A) | Shotgun | Portable bulletproof shield, F deploys and F next to it picks it up |
  | Flash (A) | Rifle | 3 stun grenades: blind and slow enemies in sight for 4 s |
  | Warden (D) | Shotgun | 2 barbed wire traps that slow anyone walking through |
  | Jammer (D) | SMG | Device that disables drones and breach charges within 5 m |
  | Lookout (D) | Rifle | 2 security cameras on walls; **C** cycles through the feeds. Everyone can see them, and one shot from an attacker (or a melee hit) destroys a camera and throws any defender watching it back to their body |
  | Mason (D) | Rifle | 2 extra wall reinforcements in prep, on top of the team's 10 |

  Speed rating changes walking speed (-8% / 0 / +8%), armor rating changes damage taken (+15% / 0 / -15%).
- Attackers have no body during prep, so nobody can camp them: they appear at one of three entry points around the outside of the map (West, South, East) when the action phase starts. They pick one from the drone cam with keys 1-3
- Defenders are sealed inside the building during prep (invisible barriers fill every exterior door and window, for defenders in prep only)
- During the 30 s prep phase every attacker pilots a rolling drone (WASD, mouse, Shift to go faster; X switches drone when an operator has several) while their body waits in spawn; drones are recalled when the action phase starts
- Drones fit through doors and windows and climb stairs. Defenders can shoot them (40 HP: two rifle shots)
- The pilot left-clicks to ping an enemy under the crosshair (30 m, clear line of sight, about 4° aim tolerance): a small red marker shows above that enemy's head for 3 s for the whole attacking team. Only the marker shows through walls, never the body
- Polish: **Tab** shows a scoreboard (kills, deaths, your team's operators), **Esc** opens a pause menu with sensitivity, volume and field-of-view sliders (also on the home and lobby screens, saved in your browser), **H** hides the key hints (which change with your role and phase), round and phase banners, a low-health glow, a "Copy code" button and player counts in the lobby
- **No shooting while sprinting:** pressing fire cancels a sprint, and the first shot comes 0.25 s later (you can't sprint while holding fire)
- **Melee (right click):** 45 damage to an enemy in front of you (about 2 m), 0.8 s cooldown. It also breaks barricade planks and attackers can use it to smash cameras
- **Barricades (B, defenders, prep only):** nail wooden planks over a doorway or window (1 second, 8 per team per round, not while someone stands in the gap). A barricade is a grid of 0.5 m planks: bullets (2 rifle hits per plank) and melee (1 hit) break them one by one, and a breach charge destroys the whole barricade at once. Planks block movement, bullets and drones until broken
- **Props:** furniture, crates, barrels, concrete barriers, pallets, planters and parked vehicles inside and outside the building. They are solid, so waist-high ones are cover; rugs, pictures, monitors and plants are decoration only
- **Player models:** other players are drawn as a humanoid with helmet, head, vest, arms holding the gun, and bending legs with a walk cycle, crouch pose and a melee swing
- Defenders reinforce wall sections (V, 10 per team): darker, immune to bullets and basic charges; only a heavy charge (Spark, stage 6) breaks them

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
  world.js         destructible wall panels/sections + the collidable world
  drone.js         drone physics (shared prediction + authority) and tuning
  operators.js     OPERATOR CONFIG: one entry per operator (shared by client and server)
  rules.js         which inputs are allowed in each round phase, objective zone test
server/
  index.js         Express static hosting + Socket.IO events
  rooms.js         room codes, join/leave, teams, host
  gameState.js     authoritative simulation and snapshots per room
  combat.js        pose history (lag compensation) and shot resolution
  destruction.js   panel damage, breach charges, reinforcement
  abilities.js     ability handlers (F) and gadget state: shields, wire, jammers, cameras, grenades
  rounds.js        round/match state machine, scores, halftime, win conditions
client/
  index.html       lobby screens + HUD markup
  src/main.js      wires UI, network, game
  src/network.js   Socket.IO wrapper, server clock estimate
  src/game.js      Three.js scene and frame loop
  src/player.js    local player: input, prediction, reconciliation, camera
  src/avatars.js   other players: bodies, guns, name tags, interpolation
  src/weapons.js   first-person gun models, recoil/reload animation
  src/effects.js   tracers, bullet holes, impact puffs
  src/audio.js     synthesised gunshots, explosions and UI sounds
  src/gadgets.js   visuals for operator gadgets and grenades
  src/drones.js    drone models for everyone, smoothing, destroyed effect
  src/destruction.js  instanced wall panels, charges, explosions
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

## Rounds

`server/rounds.js` runs `intro → prep → action → roundEnd`. Scores belong to a *squad* (A starts attacking, B starts defending), so they follow the players when sides swap after round 3; the HUD shows them by current side. The server broadcasts `roundStart` (full reset: map, spawns, health, charges), `phase` and `roundEnd` events plus the capture progress inside each snapshot. Phase rules in `shared/rules.js` are applied by both the server and the client's prediction, so frozen players don't rubber-band. Set `TIME_SCALE=0.1` when starting the server to run every phase 10× faster for testing.

## Barricades, melee and props

`MAP.openings` lists every door and window gap (generated in `shared/map.js`; `findOpening()` finds the one a ray passes through). A barricade is a set of dynamic boxes added to the shared `World` (`kind: 'barricade'`), so movement and bullets on both sides treat the planks as solid. The server owns plank health and sends `barricadeBroken` events; clients remove the same planks. Props live in the same `MAP.boxes` list as walls (`prop()` in `shared/map.js`), with `MAP.details` for visual-only decoration. Run the reachability check idea from the commit when you move props: every room, both staircases and all spawn points must stay open.

## Adding an operator

1. Add one entry to `shared/operators.js` (name, team, colour, weapon, speed/armor, and an `ability` with `id`, `name`, `desc` and either `charges` or `cooldown`).
2. If it has a new ability, add a handler with the same `id` to `ABILITIES` in `server/abilities.js`. It receives the gadget manager, the player's socket id, the player, and the ability config, and can use `p.ability.charges` / `p.ability.cdUntil`.
3. If the gadget is visible in the world, add a visual to `client/src/gadgets.js` and send it with `gadgetAdd`.

The select screen, HUD panel, loadout and ratings come from the config automatically.

## Spawn points and the prep barrier

`MAP.spawns.attack` holds the three entry points; `attackSpawnPoint()` in `shared/rules.js` spreads attackers who share one. During prep an attacker has `spawned = false`: they are left out of snapshots' visible players (`u` flag), pose history and hit detection, and take no damage. `beginAction()` places them and sends an `attackerSpawn` event so the client teleports (and keeps the facing). `MAP.barriers` are generated from the exterior wall openings; `World.barrierView` is the collision world defenders use during prep, on both server and client prediction, so there is no rubber-banding. Bullets ignore the barriers.

## Drones

Drone control rides the normal input stream: during prep, an attacker's inputs steer their active drone instead of their body (`input.drone` tags each input so reconciliation replays it correctly). Drone state is in every snapshot, so defenders see and can shoot the drones; the server applies damage and broadcasts `droneDestroyed`. A left click sends a `ping` action; the server checks the aim and line of sight from the drone and sets `spottedUntil` on the enemy, sent as `sp` in snapshots. Only the attacking team's clients draw the marker. `DRONES_PER_ATTACKER` in `shared/constants.js` is the hook operators use in stage 6 (Hawk).

## Destruction

Every interior wall piece in `shared/map.js` is split into a grid of panels by `shared/world.js`. Panel ids and sections are derived deterministically from the map, so the server only broadcasts which panels were destroyed and which sections were reinforced; the client applies the same changes to its copy of the world so movement prediction and raycasts see the holes. Players joining mid-match receive the current wall state.

## Deploying to Render

`render.yaml` describes the service. Settings if you create it by hand:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build command | `npm install --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/healthz` |

Render provides `PORT`; the server reads it automatically. WebSockets work on Render web services without extra configuration.
