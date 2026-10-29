# Breachline

A browser-based multiplayer 3D tactical attack/defend shooter. Three.js + Vite on the client, Node.js + Socket.IO on an authoritative server. One Node process serves both the game client and the realtime server, so the whole thing deploys as a single Render web service.

## Status: Stage 10 (movement and keybinds)

- Jump (Space) for players and drones; players can't shoot in mid-air. A drone hop arcs about 0.5 m up and 1.5 m forward, once per second
- Prone (Z, toggle): slow, no sprinting, a smaller hitbox lying along the body; crouch moved to C and defender cameras to T
- Settings → Keybinds: rebind every action to any key or mouse button, reset to default; saved to the account

### Earlier: Stage 9 (accounts)

- Log in or create an account (username + password); you stay logged in between visits
- Your profile shows your level, Money, Polish Money and rank points, and saves your settings
- Create a room (4-letter code) or join one; your username is your name in the lobby and in matches
- Pick Attack or Defense in the lobby (max 5 per team); the host starts the match
- First-person movement: WASD, mouse look (pointer lock), Shift sprint, Space jump, C crouch, Z prone, Q/E lean (all rebindable)
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
- **Melee (right click):** 45 damage to an enemy in front of you (about 2 m), 0.8 s cooldown. It also breaks barricade planks, knocks out **one wall panel per hit** (never a reinforced wall), and attackers can use it to smash cameras
- **Barricades (B, defenders, prep only):** nail wooden planks over a doorway or window (1 second, 8 per team per round, not while someone stands in the gap). A barricade is a grid of 0.5 m planks: bullets (2 rifle hits per plank) and melee (1 hit) break them one by one, and a breach charge destroys the whole barricade at once. Planks block movement, bullets and drones until broken
- **Props:** furniture, crates, barrels, concrete barriers, pallets, planters and parked vehicles inside and outside the building. They are solid, so waist-high ones are cover; rugs, pictures, monitors and plants are decoration only
- **Player models:** other players are drawn as a humanoid with helmet, head, vest, arms holding the gun, and bending legs with a walk cycle, crouch pose and a melee swing
- **Three objective sites** in different rooms (upstairs office, ground-floor back room, upstairs west room). During operator select the defenders vote on one (ties and no votes are settled at random). Attackers aren't told which; a drone that gets within 6 m with a clear view of the objective, or an attacker walking into its zone, reveals it to everyone. Defenders start in or right next to the site they voted for (five spawn points per site, facing the objective); they are moved there the moment the vote is decided. Only the chosen site can be captured, the three boxes look identical, and the zone ring and "Objective:" label only appear once you know the site
- **Sound** is positional: you hear other players from the right direction, quieter and duller with distance, through walls and from another floor. Footsteps: sprinting is loud and carries about 40 m, walking about 14 m, crouch-walking only a couple of metres. Also reloading, landing from a fall, barricades and walls breaking, gadgets being placed, melee swings and drone motors. Volume is in the settings menu
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

Each browser keeps one login, and an account can only be connected from one tab at a time (a new tab takes over). To play two accounts on one computer, use a normal window and a private window, or open one tab at `localhost` and the other at `127.0.0.1`.

Without `DATABASE_URL`, accounts are saved to a local file database in `.data/` (PGlite: real Postgres running inside Node), so nothing needs installing. To use your hosted database locally instead, put `DATABASE_URL=...` in a `.env` file in the project folder (git ignores it).

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
  account.js       username/password rules, which operators an account owns
  settings.js      setting defaults and limits (the server cleans saved settings with these)
  keybinds.js      rebindable actions, default keys, key names, keybind cleaning
server/
  index.js         Express static hosting + Socket.IO events
  db.js            Postgres connection (DATABASE_URL) or local PGlite fallback, table setup
  accounts.js      sign-up/log-in API, session cookies, profiles, socket login check
  rooms.js         room codes, join/leave, teams, host
  gameState.js     authoritative simulation and snapshots per room
  combat.js        pose history (lag compensation) and shot resolution
  destruction.js   panel damage, breach charges, reinforcement
  abilities.js     ability handlers (F) and gadget state: shields, wire, jammers, cameras, grenades
  rounds.js        round/match state machine, scores, halftime, win conditions
client/
  index.html       lobby screens + HUD markup
  src/main.js      wires login, UI, network, game
  src/account.js   calls the account API (session, sign-up, log-in, settings)
  src/controls.js  current keybinds: action for a key, key name for an action
  src/network.js   Socket.IO wrapper, server clock estimate
  src/game.js      Three.js scene and frame loop
  src/player.js    local player: input, prediction, reconciliation, camera
  src/avatars.js   other players: bodies, guns, name tags, interpolation
  src/weapons.js   first-person gun models, recoil/reload animation
  src/effects.js   tracers, bullet holes, impact puffs
  src/audio.js     synthesised sound effects, positional playback (range, direction, muffling)
  src/soundscape.js  footsteps, landing, reloads, drones, gadgets: what you hear and from where
  src/gadgets.js   visuals for operator gadgets and grenades
  src/drones.js    drone models for everyone, smoothing, destroyed effect
  src/destruction.js  instanced wall panels, charges, explosions
  src/map.js       renders the shared map, lighting
  src/ui.js        lobby and HUD DOM
```

## Movement and keybinds

- Jump and prone are input bits (`KEY.JUMP`, `KEY.PRONE`) simulated by `shared/movement.js` on both sides, so prediction and the server agree. Prone is a toggle on the client, which sends the PRONE bit while it's on; crouching or jumping gets you up.
- `state.prone` (0..1) blends height, eye height and speed. Getting up needs head room; if standing doesn't fit, you end up crouched.
- Lying down (`prone >= 0.5`), the hitbox in `shared/raycast.js` is a low box along the facing direction with the head in front. The avatar in `client/src/avatars.js` uses the same measurements, and lag compensation records `prone` with every pose.
- No shooting mid-air: `weaponInput()` drops the trigger while `!onGround`.
- The page and the server must run the same `shared/` code, or prediction disagrees with the server and things jitter. `npm run build` stamps the page with a fingerprint of `shared/*.js` (`server/sharedVersion.js`); the server rejects a connection with a different one, and the page reloads once (or shows a message). After changing shared code locally, rebuild **and** restart `npm start`. `npm run dev` skips the check.
- Keybinds live in `settings.keybinds` (action → `KeyboardEvent.code` or `MouseN`). The server cleans them with `sanitizeKeybinds()`: unknown actions are dropped, bad codes reset, and duplicates unbound. Esc and 1-3 can't be rebound. Binding a key that's already used swaps the two actions.
- Hints, prompts and ability descriptions use `keyFor(action)` / `{action}` placeholders, so they show the player's own keys.

## Accounts

- Passwords are hashed with bcrypt; only the hash is stored.
- Logging in creates a random session token. The browser keeps it in an `httpOnly` cookie (page scripts can't read it) and the database stores only its SHA-256 hash. Sessions last 90 days and every visit extends them.
- The Socket.IO server refuses connections without a valid session, so every player in a room is a real account.
- The client can only read its profile and save its own settings (cleaned and clamped by the server). Money, level, rank points and owned items are only ever changed by server code.
- Polish Money is a placeholder: the column exists and is shown, but nothing can change it.
- Log-in and sign-up are limited to 20 attempts per IP address per 10 minutes.

## Netcode

- The client samples input every frame, simulates it immediately with `shared/movement.js` (prediction), and sends batches to the server 30 times a second.
- The server replays each input through the same movement code. A per-player time budget stops a client from moving faster by sending inputs faster than real time.
- 20 times a second the server broadcasts a snapshot with each player's state and the last input it processed.
- The local player rewinds to the server state and replays unacknowledged inputs; any small difference is smoothed out over a few frames.
- Other players are drawn 100 ms in the past, interpolated between snapshots.
- Firing is part of the input stream, so ammo, fire rate and spread are simulated identically on both sides (spread uses a PRNG seeded by the input number). Each firing input carries the time the shooter was viewing other players at; the server rewinds targets to that moment (at most 350 ms) and tests the ray against their hitboxes and the map.

## Rounds

`server/rounds.js` runs `intro → prep → action → roundEnd`. Scores belong to a *squad* (A starts attacking, B starts defending), so they follow the players when sides swap after round 3; the HUD shows them by current side. The server broadcasts `roundStart` (full reset: map, spawns, health, charges), `phase` and `roundEnd` events plus the capture progress inside each snapshot. Phase rules in `shared/rules.js` are applied by both the server and the client's prediction, so frozen players don't rubber-band. Set `TIME_SCALE=0.1` when starting the server to run every phase 10× faster for testing.

## Objective sites

`MAP.sites` holds the three sites. `GameState` keeps `site` (chosen by `finalizeSite()` at the end of operator select) and `siteFound`. Defenders get `siteChosen` right away; attackers get nothing until `updateSiteReveal()` (every 0.1 s in prep and action) sees a drone or an attacker at the site, then everyone gets `siteFound`. Round payloads only include the site for defenders, or for attackers once it has been found, so a late joiner learns nothing early. Capture progress is counted only for the chosen site.

## Sound

Other players' sounds are derived on each client from the snapshots (speed, stance, reload state), so they cost no extra network traffic. `Audio.play()` takes a source position and a range, and handles falloff, stereo direction (from the camera's facing), and muffling for walls (one ray per sound) and other floors. Add a new sound by adding a recipe to `SOUNDS` in `client/src/soundscape.js`. There is no jump key in the game, so "landing" sounds play for falls only.

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

Render provides `PORT`; the server reads it automatically.

### Database (accounts)

Saved data lives in a free hosted Postgres database. The server creates its tables on startup.

1. Go to https://neon.com and sign up (GitHub login is fine).
2. Create a project. Name it `breachline`, keep the latest Postgres version, and pick the region closest to your Render service's region.
3. On the project dashboard, click **Connect**. Copy the connection string (it starts with `postgresql://` and ends with `?sslmode=require`). Treat it like a password.
4. In the Render dashboard, open the `breachline` service → **Environment** → **Add Environment Variable**. Key `DATABASE_URL`, value: the connection string. Save; Render redeploys.
5. Check the deploy logs: the line `DATABASE_URL is not set` should be gone. On the live site, the yellow "Dev mode" note under the login form disappears.

Supabase also works: use the **Session pooler** connection string from Project Settings → Database, with your database password filled in. WebSockets work on Render web services without extra configuration.
