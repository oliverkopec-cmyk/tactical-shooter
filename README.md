# Breachline

A browser-based multiplayer 3D tactical attack/defend shooter. Three.js + Vite on the client, Node.js + Socket.IO on an authoritative server. One Node process serves both the game client and the realtime server, so the whole thing deploys as a single Render web service.

## Status: Stage 19 (finishing up)

- **New barricade look:** 6 horizontal wooden planks, parallel and evenly spaced across the doorway or window. The bottom 0.45 m is left open with no plank: a drone (0.28 m tall) can drive through it, but a player can't (even lying prone they are 0.5 m tall).
- **Breaking:** a barricade breaks completely after **3 melee hits** (right click). Bullets still knock out single planks (to shoot or look through), and breach charges, frag and impact grenades destroy a whole barricade at once. Melee hits on a barricade only count in the action phase.
- **Windows start barricaded:** every window begins every round already barricaded (Dockside 8, Meridian Hotel 44), using the same breakable barricades, and they are put back each round. Doors are not included. These free barricades don't use up the defenders' 8 per round and don't count towards the barricade quest.
- **Map fix:** in the hotel (and Dockside), windows stacked above each other in one wall could fill in the lower window with solid wall. Walls are now cut slice by slice, so every window really is a window.

### Earlier: Stage 18 (friends and parties)

- **Friends tab:** search players by username (even one letter lists the players whose names start with it, up to 8), send a friend request, accept or decline requests that were sent to you, cancel one you sent, and remove friends. Asking someone who already asked you makes you friends straight away. You can have 100 friends and 20 requests waiting. A badge on the tab counts requests waiting for you.
- **Who is online:** every friend shows **Online · in the menu**, **In a lobby**, **In a match** or **Offline**, updated live (no refresh needed), with their rank icon.
- **Parties:** press **Invite to party** on an online friend (you can only invite friends; a party holds up to 5, the size of a team). They get a **pop-up** to Accept or Decline, open for 60 seconds. The Friends tab shows the party with a crown on the leader and each member's status; anyone can leave. If the leader leaves, the next member leads; a party of one disbands; disconnecting leaves the party.
- **Party room:** the party leader presses **Create room for the party** (also the Play tab's create button, which then shows the party size). Everyone in the party who is in the menu joins the room, **on the leader's team**. Anyone already in another room is skipped and the leader is told. Other members can't create a room while in the party (they can still join a room by code).
- Removing a friend who is in your party takes them out of it.
- **Server:** friendships are in the database (new table `friendships`, created automatically). Presence is worked out from live connections and parties are kept in memory only, so memory use stays tiny. Friend searches are limited to 60 a minute per address.

### Earlier: Stage 17 (crates, operator icons and match top bar)

- **Crates replace buying skins directly.** The Shop tab is a grid of 32 crates, one per gun, each showing the gun, the price (**900 Money**) and how many of its 13 skins you own. **Money only: Polish Money can't be used.** Click a crate to see the odds (**Common 60%, Rare 25%, Epic 12%, Legendary 3%**) and the full list of possible skins, with the ones you own ticked.
- **The server picks the result** (`POST /api/crates/open`, a secure random draw). The client only names the gun; any price, skin or rarity it sends is ignored. The Money is taken and the skin recorded under a per-account lock, so a double click can't open two crates on one balance.
- **Duplicates:** if you already own that skin for that gun you get **450 Money back** (half the price) and the screen says so.
- **Skins are now owned per gun.** A skin won from the Rifle crate can be equipped on the Rifle. Skins you bought in the old shop stay owned on every gun. Common skins are no longer free for everyone (they are crate drops): any Common you had equipped is kept for that gun automatically.
- **Daily Money cap: 3,500 Money per UTC day** from matches and quests (there wasn't one before). Money is paid in order (match first, then quest rewards). After the cap a match pays nothing, the end-of-match screen says "Daily Money limit reached", and XP and rank still count. Crate refunds don't count towards the cap. The Shop shows how much you've earned today.
- **Crate opening (about 4 seconds, click to skip):** the crate drops onto the platform with a thud and dust, shakes and glows in pulses whose colour climbs grey, blue, purple, gold and stops on your skin's rarity, the lid bursts off with a flash and particles in that colour, then the gun rises out spinning, wearing the skin, with its name and rarity. Legendary pulls get more particles, gold light beams and a fanfare. Duplicates show "Duplicate: +450 Money refunded". Buttons: Equip, Open another, Back to shop. Your balance in the top bar only changes at the reveal.
- **Operator icons and the Operators tab:** every operator has an original icon drawn in code (a bold symbol of their ability on a square in their colour). The tab is now two grids side by side, ATTACKERS and DEFENDERS, with a large faint symbol behind each. Hover for the name, click for the details. Operators you don't own are greyed out with a lock and their price. The same icons are on the operator select screen.
- **Match top bar:** next to the score and timer, your team's operator icons on the left and the enemy's on the right (your own team is always shown). **Enemy icons are a "?" until your team has seen them**: a teammate has a clear view of them, a defender camera sees them, they are marked (drone ping, Hawk, Tremor, a Volt trap, a Picket sensor) or they are killed. Once revealed they stay revealed for the rest of the round. Dead players' icons are crossed out and darkened for both teams. A new round starts hidden again.
- **No cheating:** the server decides what is revealed. It doesn't send an enemy's operator or gun (in the start payload, the snapshots or the shot messages) to a team that hasn't seen them.
- Memory: nothing new is kept per match beyond two small sets of player ids, and the crate data is a few small tables, so the server stays well inside Render's 512 MB plan.

### Earlier: Stage 16 (new operators)

Six new operators, bought with Money in the Operators tab (the original eight and both Recruits stay free). Each has a unique primary and secondary gun, two utilities and an ability on F:

| Operator | Price | Ability | Primary / Secondary | Utilities |
| --- | --- | --- | --- | --- |
| Tremor (A) | 2,500 | **Seismic pulse** (3): reveals every moving enemy within 12 m through walls for 3 s, as markers for your team | Rift AR / Tick | Flash, Claymore |
| Cinder (A) | 3,000 | **Fire canister** (2): thrown; leaves a fire patch for 8 s that burns enemies standing in it (7 damage every half second) | Kiln / Pyre | Frag, Smoke |
| Surge (A) | 3,000 | **EMP burst** (2): destroys defender cameras and signal jammers within 10 m of where you aim | Arc SMG / Jolt | Flash, Impact |
| Volt (D) | 2,500 | **Shock trap** (3): a floor trap; an attacker who steps on it takes 30 damage, is slowed for 2 s and marked for 4 s | Livewire / Static | Claymore, Smoke |
| Tonic (D) | 3,000 | **Healing field** (2): heals teammates inside it about 5 HP a second for 10 s | Syringe PDW / Dose | Smoke, Flash |
| Picket (D) | 2,000 | **Alarm sensor** (3): three faint green lines (like a claymore's); an attacker touching one is marked for 3 s. It never goes off | Watchman BR / Chirp | Claymore, Frag |

- **Buying:** the Operators tab shows locked operators with their price and a Buy button. The server checks the price, your Money and that you don't own them in one statement, so double clicks can't spend Money twice. Only owned operators can be picked in operator select (the server refuses others and locked cards are greyed out), and an equipped operator you don't own is never your starting pick.
- Enemy markers now show for whichever team spotted them, so defenders' marks (Volt, Picket) show on attackers just like attackers' marks show on defenders.
- Unlike the idea in the proposal, EMP does not affect drones (drones belong to the attackers, so it only hits defender gadgets).

### Earlier: Stage 15 (bigger map)

- **New map: Meridian Hotel.** A 40 x 28 m, three-floor hotel in a large 150 x 150 m grounds: 9 rooms on the ground floor, 13 on the first floor, 3 on the second (west wing), two interior staircases, a third staircase to the top floor, two balconies with outside stairs, 81 doors and windows (all barricade spots), about 3,200 destructible wall panels, furniture, rugs and pictures, and cover all around the outside (crates, containers, vehicles, barriers, a fountain, a back garden).
- **Three objective sites on three floors:** Kitchen (ground), Gallery (first floor), Penthouse suite (second floor). Defenders vote as before and start next to the winning site.
- **Attackers enter from the West, South or East** edge of the grounds, about 52 m from the hotel.
- **The host chooses the map in the lobby;** everyone sees the choice and it locks when the match starts. **Dockside House (the old map) is unchanged.**
- Maps now live in `shared/maps/` and are built with `shared/mapkit.js`; client and server look a map up by id (`getMap`). The map's boxes are drawn in batches, so the big map stays fast.
- **Walkability check:** `npm run check:maps` walks every map with the game's own collision code and reports unreachable rooms, blocked spawns and doors that can't be reached. Run it after editing a map. (It is conservative on the old map's narrow doors; the hotel passes.)

### Earlier: Stage 14 (shop)

- **Shop tab:** gun skins for Money, sorted by rarity, with prices that rise with rarity: **Rare 1,000**, **Epic 2,500**, **Legendary 6,000**. Common skins are free and every account already owns them, so they aren't sold.
- **Featured today:** three skins, one of each rarity, picked from the date so everyone sees the same ones. They change at 00:00 UTC (the shop shows a countdown). Featured is a highlight, not a discount.
- **Preview before you buy:** click any skin to see it on a big copy of your equipped operator's primary gun. Cards show Owned, the price, or how much more Money you need.
- **Buying is done on the server** and saved to the account. One database statement checks the price, your Money and that you don't already own the skin, and takes the Money, so a double click or two tabs can't spend the same Money twice or buy a skin twice. The client only says which skin; it can't send a price. Bought skins can then be equipped in the Operators tab (locked skins there link to the shop).
- **Developer tool:** on a local test database (no `DATABASE_URL`) the shop shows a "+10,000 Money" button so you can try buying. The server only allows it on a local database and never when `RENDER` is set, so it can't be used on the live site. `UNLOCK_ALL_SKINS=1` (unlock everything) still exists for testing.

### Earlier: Stage 13 (main menu, operators tab and skins)

- **Main menu:** after logging in you land on a full-screen menu with a 3D scene: your equipped operator stands on a lit platform holding their primary gun (with its skin). Drag to turn them. The top bar shows your username, rank (icon, tier and progress), level and XP, Money and Polish Money (always 0, display only).
- **Tabs:** Play (create or join a room, daily quests), Operators, Shop and Friends (placeholders for now) and Settings (opens the settings panel).
- **Operators tab:** choose Attack or Defense, click an operator to see their guns (hover for stat bars), ability and both utilities. **Equip operator** makes them your pick for that side (they start the operator select already chosen) and the one shown in the menu. The operator steps to the side and a big copy of the selected gun turns beside them so you can see its skin.
- **Gun skins with rarities:** Common (grey), Rare (blue), Epic (purple) and Legendary (gold). 13 skins; each recolours the gun, changes how shiny or glowing it is, and draws a pattern in code (stripes, camo, neon circuit, flames, void). Any skin fits any gun and each gun has its own equipped skin. No image files.
- **Equipped skins show in matches for everyone:** your own gun in first person and every other player's gun in third person.
- **Ownership:** every account owns the Common skins. The server checks that you own what you equip. Rare, Epic and Legendary skins are bought in the shop (Stage 14).

### Earlier: Stage 12 (rewards, quests and ranks)

- **Money after every match**, worked out by the server: 100 for playing, +150 for winning, +25 per round your side won, +10 per kill (+5 more for a headshot kill), +2 per second on the objective (up to +80) and +5 per breach charge planted. A typical loss pays about 150, a typical win 350-550.
- **XP and levels:** the match Money is also XP. Level 2 needs 250 XP in total, level 3 750, level 4 1500 (`125 × n × (n−1)`).
- **3 daily quests** that pay Money when completed and refresh 24 hours after they were handed out. Progress counts finished matches: kills, headshot kills, matches won or played, rounds won, utilities used, time on the objective, and (for one side only) breach charges planted, walls reinforced or barricades built. A set never has more than one side-specific quest.
- **Ranked points:** a win is about +25 and a loss about −20, nudged by up to 7 points by how you did (kills minus deaths per round, plus time on the objective). Wins stay between +15 and +35, losses between −8 and −30. Points never drop below 0.
- **Ranks with icons:** Bronze, Silver, Gold, Platinum and Diamond, three tiers each (I-III, 100 points per tier), then Champion at 1500 points. The icons are drawn in code: a shield in the rank's colour with 1-3 chevrons, or a star for Champion.
- **End-of-match screen:** a summary with the result, a rank before/after with the points change (and PROMOTED/Demoted), every Money line, completed quests and level-ups. It stays up until you press Continue.
- The home screen now shows your rank, progress to the next tier, level XP and the three quests with a countdown.
- **Fair play rules, all on the server:** a match only counts for players who were in it for at least 2 rounds; leaving a match that is still going costs 25 rank points and pays nothing (so you can't dodge a loss by quitting); a match is paid once; matches that end early because a side emptied pay nothing.

### Earlier: Stage 11 (weapons and loadouts)

- **Every operator has a unique primary and secondary gun** (20 guns in all: assault rifles, a carbine, SMGs, shotgun, LMG, marksman and battle rifles, pistols, revolvers, a hand cannon and machine pistol), plus their F ability. The two Recruits are the standard-issue loadouts.
- **Weapon keys:** `1` primary, `2` secondary (drawing a gun takes 0.4 s; ammo is kept per gun). Both are rebindable.
- **Mobility is real:** each gun has a mobility rating that multiplies walking speed while it is drawn (heavy LMG -14%, light pistols +10%).
- **Gun stats on hover:** hover any gun name in the operator select screen for a card with damage, fire rate, range, magazine, reload and mobility bars plus a short description. Any element with `data-gun="<weapon id>"` gets the card, so later menus only need that attribute.
- **Utilities:** every operator offers two; you pick one on the operator select screen before each round (your choice is remembered). `4` uses it (rebindable). 2 charges each, 0.8 s between uses:
  - **Claymore**: sticks to a floor or wall and arms after 1.2 s, then shoots out three thin laser tripwires in a narrow fan (left, middle, right, each up to 2 m). Each line stops at the first wall, prop, shield or barricade in its way. It only goes off when an **enemy player's body touches a line**; teammates and drones don't trigger it. The blast hits enemies in front of it within 3.4 m (85 damage, falling off with distance); anyone behind it is safe. The lines are faintly visible to everyone, and enemies can shoot the claymore (or hit it with melee) to destroy it without it going off
  - **Flash grenade**: blinds enemies who can see the burst for 3.2 s (40% as long if they look away); no slow
  - **Impact grenade**: explodes the moment it hits anything, including an enemy; 60 damage within 3.2 m, smashes barricades and blows a small hole (0.8 m) in soft walls
  - **Smoke grenade**: a thick cloud that blocks sight for 12 s
  - **Frag grenade**: bounces, bursts after 2.2 s; 95 damage within 5.5 m (falling off, blocked by walls), smashes barricades and blows a bigger hole (1.3 m) in soft walls
- Utilities are placed or thrown in prep (defenders) and action. They only ever hurt enemies. Reinforced walls are never affected by grenades.
- **Prep wall damage:** during prep, defenders can damage soft walls with bullets, melee and frag/impact grenades, to open sight lines and shooting holes before the round (attackers have no body in prep, so it's defenders only). Walls can't be damaged during operator select. Barricades still only take damage in the action phase.

### Earlier: Stage 10 (movement and keybinds)

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
- Hitscan weapons with recoil, spread, magazines and reload (R)
- Server-side, lag-compensated hit detection; headshots deal extra damage
- Health, death and spectating teammates until the round ends
- HUD: health, ammo, dynamic crosshair, hit markers, damage direction, kill feed
- Interior walls are grids of ~0.5 m panels; bullets knock panels out, synced to everyone
- Attackers carry 1 breach charge (G to plant on a wall, G again to detonate)
- Round flow: get ready (6 s) → prep (30 s) → action (3 min) → score screen; first team to 4 rounds wins the match, then everyone returns to the lobby
- Attackers win by eliminating all defenders or holding the objective zone for 10 s (frozen while a defender contests it, reset if nobody holds it); defenders win by eliminating all attackers or running out the clock
- Dead players spectate teammates until the round ends (no respawns); sides swap after round 3; late joiners wait for the next round
- Breach charges only work in the action phase, wall reinforcement only in prep, and attackers wait in spawn during prep (drones arrive in stage 5)
- Operator select (20 s, ends early once everyone has picked) before every round. One player per team per operator; a Recruit with no ability is always available for the 5th player. Each operator sets guns, utilities, speed and armor ratings, and one ability on **F**:

  | Operator | Primary | Secondary | Utilities | Ability |
  | --- | --- | --- | --- | --- |
  | Spark (A) | Ember AR | Sidewinder (revolver) | Impact / Frag | Heavy breach charge, 1 use. F plants, F detonates. Breaks reinforced walls |
  | Hawk (A) | Hornet SMG | Sting (machine pistol) | Smoke / Flash | Sonar ping on a 8 s cooldown: pings the enemy under his crosshair exactly like a drone pilot does (marker over their head for 3 s, no outlines through walls). Also pilots 2 extra drones (3 total) |
  | Bulwark (A) | Breaker 12 (shotgun) | Anvil .45 (heavy pistol) | Frag / Claymore | Portable bulletproof shield, F deploys and F next to it picks it up |
  | Flash (A) | Gale Carbine | Needle (light pistol) | Smoke / Impact | 3 stun grenades: blind and slow enemies in sight for 4 s |
  | Recruit (A) | Vanguard AR | Sidekick 9 | Frag / Smoke | None |
  | Warden (D) | Bastion LMG | Gavel (hand cannon) | Claymore / Frag | 2 barbed wire traps that slow anyone walking through |
  | Jammer (D) | Pulse PDW | Zap 18 | Claymore / Flash | Device that disables drones and breach charges within 5 m |
  | Lookout (D) | Longview DMR | Peep 7 | Flash / Smoke | 2 security cameras on walls; **T** cycles through the feeds. Everyone can see them, and one shot from an attacker (or a melee hit) destroys a camera and throws any defender watching it back to their body |
  | Mason (D) | Keystone BR | Trowel (revolver) | Claymore / Impact | 2 extra wall reinforcements in prep, on top of the team's 10 |
  | Recruit (D) | Garrison AR | Holdout | Frag / Flash | None |

  Speed rating changes walking speed (-8% / 0 / +8%), armor rating changes damage taken (+15% / 0 / -15%).
- Attackers have no body during prep, so nobody can camp them: they appear at one of three entry points around the outside of the map (West, South, East) when the action phase starts. They pick one from the drone cam with keys 1-3
- Defenders are sealed inside the building during prep (invisible barriers fill every exterior door and window, for defenders in prep only)
- During the 30 s prep phase every attacker pilots a rolling drone (WASD, mouse, Shift to go faster; X switches drone when an operator has several) while their body waits in spawn; drones are recalled when the action phase starts
- Drones fit through doors and windows and climb stairs. Defenders can shoot them (40 HP: two rifle shots)
- The pilot left-clicks to ping an enemy under the crosshair (30 m, clear line of sight, about 4° aim tolerance): a small red marker shows above that enemy's head for 3 s for the whole attacking team. Only the marker shows through walls, never the body
- Polish: **Tab** shows a scoreboard (kills, deaths, your team's operators), **Esc** opens a pause menu with sensitivity, volume and field-of-view sliders (also on the home and lobby screens, saved in your browser), **H** hides the key hints (which change with your role and phase), round and phase banners, a low-health glow, a "Copy code" button and player counts in the lobby
- **No shooting while sprinting:** pressing fire cancels a sprint, and the first shot comes 0.25 s later (you can't sprint while holding fire)
- **Melee (right click):** 45 damage to an enemy in front of you (about 2 m), 0.8 s cooldown. It also smashes barricades (3 hits break one completely), knocks out **one wall panel per hit** (never a reinforced wall), and attackers can use it to smash cameras
- **Barricades (B, defenders, prep only):** nail wooden planks over a doorway or window (1 second, 8 per team per round, not while someone stands in the gap). A barricade is 6 thin wooden planks (`barricadePlanks()` in `shared/barricade.js`) with a 0.45 m open gap at the bottom that a drone can drive through but a player can't: bullets (2 rifle hits per plank) break planks one by one, 3 melee hits break the whole barricade, and a breach charge or a grenade destroys it at once. Planks block movement and bullets until broken. Windows start every round already barricaded for free (`Gadgets.placeWindowBarricades`)
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
  weapons.js       the 20 guns + deterministic ammo/fire-rate/reload/spread/swap, stat rows for menus
  utilities.js     claymore, flash, impact, smoke and frag grenade definitions
  raycast.js       ray tests against the map and player hitboxes
  world.js         destructible wall panels/sections + the collidable world
  drone.js         drone physics (shared prediction + authority) and tuning
  operators.js     OPERATOR CONFIG: one entry per operator (shared by client and server)
  rules.js         which inputs are allowed in each round phase, objective zone test
  account.js       username/password rules, which operators an account owns
  settings.js      setting defaults and limits (the server cleans saved settings with these)
  keybinds.js      rebindable actions, default keys, key names, keybind cleaning
  progression.js   rank ladder, level maths, daily quest definitions
  skins.js         gun skin catalog: rarities, colours, patterns
server/
  index.js         Express static hosting + Socket.IO events
  db.js            Postgres connection (DATABASE_URL) or local PGlite fallback, table setup
  accounts.js      sign-up/log-in API, session cookies, socket login check
  profile.js       what an account's profile looks like to its owner
  progression.js   match rewards, rank points, daily quests, forfeits
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
  src/menu.js      main menu tabs and the Operators tab
  src/menuScene.js 3D scene behind the main menu
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
- Keybinds live in `settings.keybinds` (action → `KeyboardEvent.code` or `MouseN`). The server cleans them with `sanitizeKeybinds()`: unknown actions are dropped, bad codes reset, and duplicates unbound. Esc can't be rebound. Keys 1-3 also choose the entry point while an attacker is in prep, whatever they're bound to (1/2/4 are the default weapon and utility keys). Binding a key that's already used swaps the two actions.
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

`MAP.openings` lists every door and window gap (generated in `shared/map.js`; `findOpening()` finds the one a ray passes through). A barricade is a set of dynamic plank boxes added to the shared `World` (`kind: 'barricade'`), so movement and bullets on both sides treat the planks as solid. The server owns plank health and the melee hit count and sends `barricadeBroken` / `barricadeHit` events; the barricade record sent to clients only lists the opening and which planks still stand, and clients build the same planks from the shared function. Props live in the same `MAP.boxes` list as walls (`prop()` in `shared/map.js`), with `MAP.details` for visual-only decoration. Run the reachability check idea from the commit when you move props: every room, both staircases and all spawn points must stay open.

## Shop

- Prices are in `SKIN_PRICES` in `shared/skins.js` (by rarity). The featured set comes from `featuredSkins(day)` there, seeded by the UTC day number, and the client asks `GET /api/shop` for it so the server's clock decides.
- `POST /api/shop/buy` runs one `UPDATE ... WHERE money >= price AND NOT owned` that takes the Money and appends the skin to `owned_skins`; no row updated means refused (not enough Money, or already owned). Skin ownership is read through `ownedSkinsOf` in `server/profile.js`, so equipping only ever accepts owned skins.
- `POST /api/dev/money` adds 10,000 Money and only exists when the database is local and `RENDER` is unset (`devTools` in `server/profile.js`).

## Main menu, operators and skins

- `client/src/menu.js` runs the tabs and the Operators tab; `client/src/menuScene.js` is the 3D scene (it reuses the in-game avatar and gun models, so the menu always matches the game). The scene only renders while the menu is showing.
- `shared/skins.js` is the skin catalog (rarities, colours, patterns). `makeGunModel(id, skinId)` in `client/src/weapons.js` applies a skin; the first-person gun, other players' guns and the menu all go through it.
- Equipping is `PUT /api/equip/skin` and `PUT /api/equip/operator`. The server only accepts skins in the account's owned list (`ownedSkinsOf` in `server/profile.js`: the common ones, what it bought, or everything in dev mode) and operators it owns on the right side. What is stored is re-checked every time it is read.
- Skins reach the match from the account: the socket carries the account's equipped skins and operators, `Room.start` refreshes them when a match begins, and every player entry in the room state and start payload includes `skins`.
- `equipped_operators` (a new column, added automatically) holds `{ attack, defense, menu }`.

## Rewards, quests and ranks

- `shared/progression.js` has what menus need: the rank ladder (`rankInfo()`), level maths and the quest list. `server/progression.js` has the numbers that decide rewards (`REWARD`, `RANK`) and the database side.
- The game tallies each player's stats itself (`p.stats`: kills and headshots at the kill, plants and reinforcements when they happen, time on the objective each tick). When a side reaches 4 rounds, `rounds.endRound` calls `GameState.settleMatch`, which hands each account to `Progression.settle`. That reads the account, adds Money, XP, rank points and quest progress, writes it back and sends the player a `matchSummary` plus a fresh `profile`. A per-account lock makes two matches ending at once safe.
- Nothing in the client can ask for Money, XP or rank points: there are no socket events for it, only the server pushes `profile` and `matchSummary`.
- `Progression.forfeit` handles leavers. Daily quests live on the account (`quests` column: ids and progress; labels, targets and rewards are looked up from the shared list) and are replaced when `expiresAt` passes, checked at login, on each page load and at match end.
- To tune the economy, change `REWARD` / `RANK` in `server/progression.js` and the quest list in `shared/progression.js`.

## Weapons and utilities

- `shared/weapons.js` holds every gun (`gun({...})` fills in defaults) and the deterministic weapon simulation. A weapon state is the drawn gun plus the stowed one (`other`); `input.wsel` (1 or 2) is the slot the player wants, sent with every input, so the client predicts swaps exactly like the server does. `weaponStats()` turns a gun into the rows and bar fractions the hover card shows.
- Gun mobility multiplies walking speed through `state.gunMul`, set from the drawn gun before every movement step on both sides.
- `shared/utilities.js` lists the five utilities and their numbers (`UTIL_STATS`). Thrown ones share the grenade code in `server/abilities.js` (Flash's stun ability uses it too). A claymore's tripwires come from `claymoreLines()` in the same file, which both the server's trigger (`checkClaymores`) and the client's drawing use, so what you see is what trips it. Smoke is only a visual on the client (`GadgetView.addSmoke`), the server just sends `smokeStart`.
- The server owns utility charges and the pick: `pickUtility` only works during operator select and only for utilities the operator offers.
- To add a gun: add an entry in `shared/weapons.js` (use an existing `model` or add one in `client/src/weapons.js`), give it a shot tone in `client/src/audio.js`, and assign it in `shared/operators.js`.

## Adding an operator

1. Add one entry to `shared/operators.js` (name, team, colour, `weapons: { primary, secondary }`, two `utilities`, speed/armor, and an `ability` with `id`, `name`, `desc` and either `charges` or `cooldown`).
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
