# Breachline

A browser-based multiplayer 3D tactical attack/defend shooter. Three.js + Vite on the client, Node.js + Socket.IO on an authoritative server. One Node process serves both the game client and the realtime server, so the whole thing deploys as a single Render web service.

## Status: Stage 2F (bug fixes and quick changes)

- **Bots on rappel:** if the window a bot is heading for gets blocked (an armour panel goes on it) or it hangs at the window for 3.5 s without getting in, it picks another window on the same rope, else goes up and in through a roof hatch. If a rope has nothing usable it tries another rope or walks.
- **Stuck check (all bots):** a bot that is trying to move but makes no progress (under 1.2 m) for 5 s drops its plan and chooses a new one: lets go of a rope, switches between walking and rappelling, picks another angle to hold, and walks to a nearby spot first (`watchProgress` / `replan` in `server/bots.js`).
- **Attackers push the objective:** they stage for at most 6 s once the first bots are ready, and never after 30 s of the action phase; from then on (or in the last 80 s, 100 s in Defuser mode before the plant) they push: no ducking into cover after a kill or a scratch, no walking over to help a fight, and they keep walking in while shooting (stopping only within 3.5 m of a target). If an attacker's route to the site doesn't get shorter for 14 s the whole team is told to push and that bot replans.
- **Rappel crosshair:** hanging still or creeping on a rope uses the normal crosshair and spread; it only widens while moving fast on the rope (`rapSpeed` in the player state, `currentSpread` in `shared/weapons.js`).
- **Aegis shield:** bulletproof from the whole front, not just the shield's box. Any bullet fired from within 60° of where the operator faces is stopped (with the shield held to the side, only the left half of that). Bullets from behind and the sides still hit.
- **Top bar:** under each teammate's operator icon a thin health bar (green, then yellow, then red as it drops, empty when dead). Enemies don't show health.

Stage names: the original numbered stages ran 1-27 and the first lettered batch A-F, so this next batch is called 2F-2L to avoid clashing with Stage F below.

### Earlier: Stage F (round flow and operator selection)

Every round now runs **location (10 s) → loadout (15 s) → prep (30 s) → action**, with the step's name and timer at the top of each screen (`client/src/preRound.js`; the server's `RoundManager` keeps both steps inside the intro phase as `step`).

- **Location** (`client/src/topMap.js`): a top-down plan of the map, drawn from its boxes: floors, outside and inside walls, doors (orange), windows (blue), stairs and furniture, with a floor switcher (Ground, 1st floor, ... Roof; a dot marks floors with a site). Attackers click a spawn point (pins on the edge of the plan point the way to them), defenders vote for a site; your teammates' names appear under what they picked, live, on the map and in the list beside it. The vote is decided when the step ends.
- **Loadout**: on the left a grid of your side's operators, 7 a row, which scrolls when there are more than fit: each is its icon on its coloured square; hovering enlarges it with a glow and its name in a coloured label; the one you're looking at stays enlarged with a white outline; a teammate's locked pick is dimmed with their name, operators you don't own are greyed with a lock, and a corner badge counts the matches you've played with each. On the right: the operator turning slowly in 3D holding their primary with your skin and charm (`client/src/opPreview.js`, its own small renderer only while the screen is open), name, side, speed and armour bars, the ability with its icon, both guns (stats on hover) with **Skin** and **Charm** buttons that change them right there (everyone in the match sees the new look), the two utilities, and LOCK IN. Along the bottom: your team's names and operator icons (or "?"), live. The step ends 1.5 s after everyone has locked in; anyone who hasn't gets their equipped operator (or a free one if it's taken).
- **Prep**: attackers press **6** (rebindable: "Loadout in prep") to open the loadout again, with an Operator tab and a Spawn point tab (the map), and go back with 6 or "Back to drone". The drone stays where it is and can still be shot; no input reaches it while the screen is open. Changing operator in prep retunes your drones (Hawk's extras roll out next to the one you're driving, Wasp's become shock drones, used taser shots stay used). Repicking stops 2 s before the action phase, and an open screen closes by itself. Defenders can't change operator after the loadout.
- Matches played per operator are counted on the account when a match is settled (the operator each player took into each round's action).
- Short fade and slide transitions between steps, a soft tick on hover, a click on select and a chord on lock in. Sized for laptops down to about 1024 × 640 (and narrower: the grid drops to 5 a row, the map stacks).

### Earlier: Stage E (9 new operators)

Nine operators to buy with Money, each built around how a real Rainbow Six Siege operator's gadget works (named in brackets) with original names, models and icons. Each has its own icon, two guns (shared with at most one other operator) and two utilities, and bots play them all.

Attackers:

- **Aegis** (Blackbeard, and how shield operators work), 3,500: the primary is the **Breakwater shield**, a full-height ballistic shield (curved, chamfered, with a viewport, a steel rim and armour ribs; skins and Exclusive skins work on it), and the secondary the **Anvil .45**. With the shield drawn you hold only the shield: it fills most of your view and you look out through its viewport. It can't shoot, but it stops every bullet and melee swing from the front (60° either side); a standing player's shins show below it, a crouching one is covered, and sprinting swings it aside. Draw the pistol to shoot: the shield moves to your left side, the pistol close beside it, and it still covers the left half of your body from the front. It works on a rope too. Ability: **shield charge** (3, 8 s apart, shield drawn): a short dash that smashes through soft walls and barricades in the way and leaves you dazed (slowed, blurred) for 1.5 s. Aegis bots fight with the pistol and raise the shield again 3 s after losing sight of you.
- **Blackout** (Thatcher): 3 EMP grenades, a 2 s fuse, reaching through walls: every defender electronic within 5 m is destroyed (cameras, jammers, shock traps, alarm sensors, shock wires, interceptors).
- **Wasp** (Twitch): both drones are shock drones. Driving one in prep, the ability key fires its taser (6 zaps per drone, 5 m, 1.2 s apart): it destroys the defender gadget it hits, or stings a defender for 8.
- **Flint** (Hibana): 3 volleys of sticky pellets from 20 m. Fire one, then press again to set it off: a hole in a soft wall, a hatch opened, a barricade or armour panel broken, or one panel knocked out of a reinforced wall (three volleys make a hole you can see through). Jammers stop them and shock wires fry them.
- **Ram** (Sledge): a breaching hammer, 20 swings, 1.1 s apart: a big hole in a soft wall, a barricade or the hatch under you gone, an armour panel in two. Reinforced walls make it bounce off; it never hurts people.

Defenders:

- **Rampart** (Castle; replaces the planned Trapper, whose floor trap overlapped Volt's): 3 armour panels. Aim at a doorway or window and hold still for 1.5 s: a bulletproof slab fills it (any wooden barricade there goes). Bullets, frags and impacts do nothing; it takes 12 melee hits, 2 hammer swings, a breach charge or a pellet volley. Nobody can swing in through it on a rope.
- **Current** (Bandit): 4 shock wires for reinforced walls, hatches and armour panels. An electrified wall destroys breach charges (heavy ones too) and pellets stuck to it, and shocks attackers touching it (12 every half second). One bullet, an EMP or a shock drone destroys a battery.
- **Medic** (Doc): 3 stim darts: +40 health to the teammate under the crosshair (30 m) or to yourself, up to 140; the extra drains back to 100 at 1 a second. The health panel turns pink while overhealed.
- **Interceptor** (Jäger): 2 devices on walls or floors, each shooting down 2 enemy grenades (frags, impacts, flashes, smokes, stuns, fire canisters, EMPs) within 4.5 m in its sight. One bullet destroys one.

- Bots: Aegis bots draw the pistol to fight and charge through walls in the way with the shield, Ram bots hammer open walls near the site, Flint bots set off their pellets, Wasp bots drive up to gadgets and zap them, Rampart bots armour the site entrances, Current bots electrify the walls they reinforce, Interceptor bots put devices by the site and Medic bots stim when hurt. Bots aim at the feet of a raised shield and the head of a lowered one.
- Tuning numbers live in `ABILITY_STATS` in `shared/utilities.js` and the shield charge speed in `shared/movementConfig.js`.

### Earlier: Stage D (main menu remodel)

- **A rooftop at dusk** behind the operator (`client/src/menuBackdrop.js`, all built in code): a wet concrete roof with a parapet, air-conditioning units with turning fans, a stair hut with a lamp over its door, a water tower, crates, vent pipes and a mast with a blinking red light. Across the gap the target building rises with its windows lit and red warning lights on top. A city of towers spreads to the horizon (one draw call; the windows are worked out in a shader from the world position, so they are the same size on every tower, and a few flicker). A dusk sky fades from the last orange of the sun on the left to deep blue with twinkling stars. A searchlight sweeps slowly through the haze, banks of fog drift past, light rain falls, and every so often an aircraft light crosses the sky.
- **Cinematic camera drift:** the camera sways slowly around its spot (a few combined slow waves, so it never repeats quickly) and keeps the operator framed; the scene is never fully still.
- **Operator lighting:** a warm key light from the low sun with soft shadows, a rim light from behind in the operator's colour, a cool sky fill and a faint blue bounce from the city. The pad is dark metal with two glowing rings in the operator's colour, a pool of light under their feet and a gently pulsing light.
- **Restyled top bar, tabs and panels:** Rajdhani for headings, tabs and main buttons and Inter for text (Google Fonts, falling back to system fonts), a dark glass top bar with a glowing line under it and a diamond by the name, spaced capital tabs with a glow on hover and a bar that slides to the active tab, darker glass panels that slide in when their tab opens, buttons that lift and glow on hover and press in on click, and tiles that rise on hover. A soft vignette keeps the panels readable over the scene. Turned off for people who ask their system for reduced motion.
- **Menu music** (`client/src/menuMusic.js`): an original slow ambient piece played live with Web Audio (no audio files): a warm pad drifting through four chords over a soft bass, a few plucked notes echoing, and light rain. It fades in on the menu and out when a match starts, pauses in a background tab, and has its own **Menu music** volume in Settings (0 turns it off). Browsers only start sound after the first click or key press.
- **Graphics setting** (Settings: Auto, High, Low). Low: 1x resolution, no shadows, no extra lights, fewer city towers (120 instead of 300), raindrops (350 instead of 1300) and fog banks; about 40% fewer draw calls in the menu. In matches Low also renders at 1x without shadows. Auto picks Low on devices with 4 GB of memory or less, two cores or less, or a phone.
- Everything is generated in code, so the page loads nothing new apart from two web fonts.

### Earlier: Stage C (announcements, gifts and Exclusive skins)

- **Announcements** (Admin tab → Send to players → Announcement): type a message, choose 5, 10 or 30 seconds, and everyone online gets a banner across the top of the screen, in the menu and in matches, with a bar showing how long it stays (× closes it early). Nothing is stored, so offline players never see it.
- **40 Exclusive skins** (`shared/exclusiveSkins.js`): a new **Exclusive** rarity above Legendary, gift-only (never in a crate or the shop) and owned on every gun once given. Each is drawn by an animated shader effect (`client/src/exclusiveSkins.js`) over the normal lighting: the body and furniture carry the pattern, the metal parts get a sheen sliding along them, the sights, vents and optic housing pulse with light, and many have particles floating around the gun (embers, snow, petals, sparks, bubbles, stars). Twenty effects, each used for two skins with different colours, scale, speed and particles: Molten Core / Cobalt Magma (flowing lava cracks), Deep Space / Nebula Bloom (drifting nebula and twinkling stars), Electric Storm / Violet Tempest (clouds and flashing lightning), Frozen Crystal / Rose Quartz (facets and sparkles), Neon City / Night Market (lit windows and scanlines), Dragon Scales / Wyrm Ember (colour-shifting scales), Golden Circuitry / Quantum Trace (traces with running pulses), Ocean Waves / Tidal Abyss (rolling swells with glowing crests), Aurora / Solar Flare (swaying curtains of light), Cherry Blossom / Midnight Sakura (turning petals), Carbon Gold / Carbon Frost (woven carbon with glinting inlay), Glitch / Corrupted Signal (jumping blocks and colour splits), Holographic / Prism Shard (rainbow foil that changes with the viewing angle), Plasma Core / Acid Rush (swirling plasma), Gold-Veined Marble / Obsidian Vein, Energy Shield / Hive Pulse (hex grids with energy waves), Phoenix Flame / Spirit Fire (rising flames), Toxic Bloom / Venom (swelling bubbles), Synthwave (neon grid), Damascus / Royal Damascus (folded steel), Pixel Shift (shifting pixel camo).
- Exclusive skins show an animated white-gold-rainbow **EXCLUSIVE** tag wherever skins are shown (skin list, gun rows, gift results, the killcam) and a glowing tile. They only appear in your skin list once you own one; the rarity legend says "gifts only". Crate odds and contents leave them out.
- **Gifts** (Admin tab → Gift): a title, a message and any mix of Money (up to 10,000,000), a skin (picked from a scrolling gallery of every skin, each drawn on a rifle with its name and grouped by rarity, Exclusive first; the one you pick also shows on your operator's gun), a charm and a crate (a gun's crate or the charm crate). Send it to **one player** (username, with suggestions as you type), **everyone online**, or the **whole server** (every account that exists when it's sent; offline players find it at their next login). Online and whole-server sends ask to confirm. **Send Money** is the quick version: an amount, an optional message, the same three choices.
- **Opening gifts:** each unopened gift is a wrapped present on the platform in front of your operator in the menu (more stack on top), hopping and glowing; one holding an Exclusive skin is white-gold and glows in the shifting Exclusive colours. The Play tab also says "You have N gifts!" (clicking it opens one). Clicking a present plays the unwrapping: the bow pops off, the lid flies away, confetti bursts out and the item rises from the box (the skin on your gun, the crate's prize, the charm, or a gold coin for Money). Then the title, who sent it, the message and everything inside show, with Equip (for a skin), Open the next gift, and Close.
- **Safe on the server** (`server/gifts.js`): what is inside is only ever read from the database. A claim checks the gift is yours and unopened, works out the reward (a crate is opened then, with the usual duplicate refund), and writes the claim and the reward in one statement whose claim row can only exist once, so a gift can't be opened twice, by someone else, or faked. Money stops at the column's limit.
- **Gifts sent** (Admin tab, right): the last 50 gifts with what they held, who they went to, who sent them and how many players have opened them out of how many could.

### Earlier: Stage B (movement physics)

- **All movement numbers are in one file: `shared/movementConfig.js`.** Speeds, acceleration, braking, strafe and backwards speed, momentum, stance and lean speeds, aiming, operator speed ratings, and the camera and gun feel. Rebuild and restart after changing it (the simulation part runs on the server too).
- **Acceleration and braking:** you reach full speed in 0.15 s and stop in 0.1 s from walking (0.17 s from a sprint), instead of starting and stopping instantly.
- **Direction:** strafing is 85% and walking backwards 75% of forward speed (diagonals in between). Changing direction carries your old momentum for a moment: forward to backward takes about a quarter of a second, and sideways speed fades a little more slowly than when you stop.
- **Speed** still comes from stance, aiming, the gun's mobility and the operator's speed rating (now `SPEED_RATING` in the config), multiplied together.
- **Camera:** a subtle head bob in step with your footsteps (2 cm walking, 5 cm sprinting, less crouched or aiming, with a slight side sway and tilt), a small springy dip when you stop sharply from a run, and a bigger one when you land a vault. Only the camera moves; your aim and hitbox don't.
- **Weapon sway:** the gun trails slightly behind the mouse and catches up, and moves in step with your footsteps (it breathes a little standing still). Much less while aiming down sights.
- **Stances:** crouching takes about 0.22 s and the eye height eases in and out of crouch and prone instead of moving in a straight line.
- **No rubber-banding:** the new physics is shared code, so prediction and the server agree exactly (in a test walk, strafe, reverse, sprint, stop, crouch and aim session the client was corrected by 0.0 m over 99 server updates).

### Earlier: Stage A (controls and gameplay fixes)

- **No jumping:** Space only vaults (and swings you in through a window from a rope). Drones keep their hop and Shift boost. Bots that get stuck vault instead of hopping.
- **Lean: Toggle or Hold** (Settings, default Toggle). In Toggle, Q leans left, Q again stands you up, E leans right straight away. Sprinting cancels the lean (in Hold too, even with the key held).
- **Aim down sights:** right mouse (rebindable "Aim down sights", Settings: Hold or Toggle, default Hold). The gun comes up to the middle with its sights on your line of aim, over 0.2 s. Iron sights zoom 1.3×, red dots 1.6× (you look through the sight at a red dot), scopes 2.4× and the Longview marksman rifle's long scope 3.2× (a scope view with a black surround). While aiming: 60% less spread, 38% slower walking, no sprinting (pressing sprint in Toggle mode lowers the sights), much less gun bob, and no crosshair. **Aiming sensitivity** (Settings) is a multiplier on top of your mouse sensitivity, already corrected for the zoom, so 1.00× feels the same as hip-fire. Normal and Hard bots aim down their sights at targets over 10 m away.
- **Melee moved to 3** because aiming took right click. Saved keybinds are moved over automatically: if melee was on right click, aiming gets right click and melee goes to 3; a key you chose yourself is never taken by a new action.
- **Rappel fix:** hanging upside down, W/S/A/D and the mouse move you and the view the way they look on screen (W goes toward the top of the screen, the mouse isn't reversed).
- **Jammers can be shot:** two bullet hits from an attacker destroy one (a shotgun blast counts as one hit). Each hit throws sparks with an electric crackle; the second also scatters debris.
- **Defenders break barricades from inside during prep** with bullets and melee (the invisible prep barrier still keeps them in). The game has no window glass, so there is nothing else to break.
- **Reinforcing in the action phase:** V (and Mason's extra two) now works in prep and action, from the same team count of 10.
- **Barbed wire only slows the enemy team.** Teammates walk through at full speed. Anyone walking through it makes a rustling noise others can hear.

### Earlier: Stage 26 (bots)

- **Adding bots:** in the room lobby the host picks a difficulty (**Easy, Normal, Hard**) and adds a bot to Attack or Defense, or presses **Fill empty slots** to fill both sides up to 5. Bots show as "bot · normal" in the lobby; the host can remove one with ×. A room with only bots left closes.
- **Rewards:** a match with any bot in it gives **half Money and no rank points** (the match summary says so), and leaving it early costs no rank points either.
- **How bots play** (all on the server, with the same inputs and actions as players, so they follow every rule):
  - **Aim:** they turn onto a target smoothly, like a hand on a mouse (a spring with a top speed, never a snap), with an aim error that is large when you first appear and settles quickly. Hard bots go for the head most of the time. They shoot in short bursts at range so their spread stays tight and hold the trigger up close; semi-automatic guns are tapped. Bot shots are checked against where you are now (bots have no network delay to make up for).
  - **Losing sight:** for a moment after you go behind cover they keep aiming, and shooting, where they last saw you. If they hear you moving close behind a soft wall, Normal and Hard bots shoot through it.
  - **Moving:** they walk one way while looking another, so they pre-aim doorways, corners and where they heard something. In a fight they strafe left and right (Hard also crouch-peeks); they never stand still in the open. When their magazine runs low or they're badly hurt, they fall back to a nearby spot you can't see, crouch and reload. After a kill or being shot they move.
  - **Defenders:** each takes a different entrance to the site (doors and windows on its floor), barricades it and, with a claymore, plants it just inside, reinforces walls near the site, then holds an angle on that entrance from a spot 3.5 to 8 m back, off the straight line through the door and against a wall where possible, crouched. The nearest free defender rotates to help a teammate in a fight.
  - **Attackers:** they drone during prep and remember the defenders the drones saw. In the action phase they gather short of the site and **push together** (when three are ready, after 9 s, or when time is short); one may blow a soft wall with a breach charge for a new angle first. Flashes go in before they enter, frags and impacts at enemies hiding behind cover, smoke to cover a plant. About a quarter go up a rope instead (swing in through a window, or break a roof hatch). When time runs low they stop waiting and play the objective.
  - **Hearing and sharing:** they hear footsteps (sprinting far, walking closer, crouching barely), gunshots, explosions, breaking barricades and walls, and drones (defenders), and turn towards the sound ready to shoot. What one bot sees or hears its whole team knows; when one dies, its teammates turn on the killer and react faster (they trade).
  - **Flashes and stuns** blind bots just like people.
  - **Getting around:** a walking grid built from the map (`server/nav.js`). A barricade in the way is smashed with melee; when stuck they hop (which vaults low things), then sidestep.
- **Difficulty:** Easy reacts in 0.75 to 1.1 s, aims loosely, turns slowly and doesn't use the tactics above. Normal reacts in 0.45 to 0.6 s with the same tactics as Hard and less accurate aim. Hard reacts in 0.2 to 0.3 s, settles its aim on the head within about a quarter second, turns fast and hears further. In a test against a target strafing in the open 12 to 24 m away, Hard killed it in about 0.5 to 0.7 s (reaction included), Normal in about 0.9 to 2 s, Easy in 3 s or more.
- **Light on the server:** each bot thinks 10 times a second and steers every tick; ten bots cost about 1 ms per server tick. The walking grid is built once per map, in small slices so the server never pauses (a few MB; about 0.3 s for Dockside, 1.2 s for the hotel, started as soon as a bot is added). Paths come from cached distance fields worked out on demand; contact lists and remembered sounds are small and cleared every round.

### Earlier: Stage 25 (killcam)

- **Killcam:** when another player kills you, you watch a **4 second replay** of your death **through the killer's eyes**: their movement and aim, their gun firing on each of their shots (with tracers and the sound), and your own body going down where you stood. Then spectating carries on as before. **Click, Space or Enter skips it.**
- **Shown during it:** a red-edged KILLCAM banner with the killer's name and operator, their gun with its **skin and charm**, and the **health they had left** (a bar and a number). The gun in view is their actual gun, skin and charm.
- **Server:** `server/killcam.js` keeps only the last 4.5 seconds of each player's movement (20 samples a second, about 90 small arrays each) and of their shots, so memory stays tiny. On a kill it sends the victim just the last 4 seconds of the killer's and the victim's movement, the killer's shots in that time, and their operator, gun, skin, charm and health. Nothing new is recorded on the client. No killcam when you kill yourself (your own charge, say).
- The replay is driven by real time, so a slow frame rate can't stretch it past 4 seconds.

### Earlier: Stage 24 (pings and voice lines)

- **Team pings:** the **middle mouse button** (rebindable: "Ping (tap) / ping wheel (hold)") in prep or action.
  - **Tap:** pings what you aim at, for **your team only**, for **5 seconds**: a coloured diamond with a label and your name, seen through walls, with a chirp from where it landed. The server traces your aim itself. If an **enemy in plain view** is under the crosshair it becomes an "Enemy" ping and that enemy is **marked for 2 seconds** (the usual red arrow); behind a wall they are not. Otherwise the ping names what it hit: Claymore, Jammer, Shock trap, Barbed wire, Breach charge, Shield, Barricade, Hatch / Reinforced hatch, Soft wall / Reinforced wall, Wall, or just "Ping". Defenders' hidden cameras are only named for defenders.
  - **Hold:** opens the **ping wheel** (the view stops turning); move the mouse towards **Enemy here, Go here, Danger, Need help** or **Defending here** and let go. Letting go in the middle cancels. Each choice has its own colour; enemy and danger pings sound an alarm tone.
  - Limits: one ping every 0.6 s, at most two of yours showing at once (the oldest goes).
- **Operator voice lines:** operators speak short lines with the browser's speech synthesis, each operator with their own voice pitch and speed: using the ability or utility, reloading, pinging (one line per wheel choice), getting a kill, spotting an enemy (drone ping or a ping on an enemy), planting and disabling the defuser.
  - Only your team hears them, quieter with distance (out to 40 m). The browser's speech can't be placed in 3D, so each line also appears on screen under the kill feed with an **arrow pointing to the speaker** ("↖ Spark: Reloading!").
  - The server decides when someone speaks, with cooldowns so it never spams (1.8 s between any two lines from one player, 6 s before the same kind again).
  - **Settings → Voice lines** sets their volume; at 0 they are off (the on-screen line still shows).
  - **All the text is in one file, `shared/voiceLines.js`**, with a note on how to swap in recorded audio files later.

### Earlier: Stage 23 (Defuser mode)

- **Game mode picker:** the host chooses **Secure the objective** (the original mode) or **Defuser** in the room lobby, above the map choice. It is locked once the match starts.
- **Defuser mode:**
  - **The carrier:** when the action phase starts, one random attacker carries the defuser. A yellow arrow shows who it is over their head to their teammates (through walls), and they see "You carry the defuser". Defenders are only told when the carrier goes down. If the carrier dies or leaves, the defuser drops where they fell, with a yellow beacon only attackers can see, and **any attacker who walks over it picks it up**.
  - **Planting:** the carrier holds **Y** (rebindable: "Plant / disable the defuser") for **7 seconds**, standing still inside the defenders' chosen objective zone. Letting go, moving, leaving the zone or dying cancels it. Defenders get a warning ("The defuser is being planted!") the moment it starts.
  - **Planted:** a device with a blinking light sits at the site, visible to everyone. It counts down **45 seconds**; the round clock turns into the countdown, the light blinks and it beeps faster and faster. Eliminating every attacker after the plant does **not** end the round.
  - **Disabling:** any defender holds Y for **7 seconds**, standing still inside the zone beside it. The attackers are warned.
  - **Winning:** defenders win by disabling it, by eliminating all attackers before it is planted, or by running out the timer before a plant. Attackers win when the countdown finishes ("The defuser went off") or by eliminating all defenders at any time.
  - **Feedback:** banners and sounds for the carrier, a drop, planting started, planted, disabling started, disabled and the explosion; a progress bar and a ticking sound while you plant or disable; prompts for the carrier and the defenders.
- **Server:** `server/defuser.js` decides everything (the client only sends the held key bit `KEY.INTERACT`, and draws what the snapshot's `df` field says). Attackers' snapshots carry the carrier and the dropped position, everyone's carry the planted device and its time left. Everything resets each round. Standard mode is unchanged.

### Earlier: Stage 22 (vaulting, rappelling, hatches and run-out detection)

- **Vaulting:** press **Space** with a low obstacle (a crate, a counter, a window sill; up to 1.3 m) right in front of you and you hop over or through it with a short tucked hop (about half a second, you can't act during it). It needs room above the obstacle and a free place to land, so an **intact barricade blocks it**; a hole broken in a barricade doesn't. A "Press Space to vault" prompt shows when it will work. Others hear you.
- **Rappelling** (everyone, outside walls only, action phase): a rope hangs from a steel anchor at the roof edge down every outside wall (Dockside 8, Meridian Hotel 11), and one hangs down each roof hatch once it is open. Press **N** (rebindable) to attach: at the foot of an outside wall while facing it, at the roof edge looking outward, or beside an open roof hatch. Then **W/S** climb and descend (at the top, W takes you up onto the roof; at the bottom, S steps you off), **A/D** move sideways along the wall, hold **M** to flip upside down (the camera turns over and drops low, to look in through a window from above), and **N** again lets go (you drop). **Space beside a window or door swings you in through it and breaks its barricade**, if it has one. You can shoot while hanging, with 2.2 times the spread. Ropes are drawn for everyone hanging on them, clipping on and sliding make a sound others can hear, and you can be shot. Not available during prep.
- **Hatches:** square (1 m) wooden covers in floors and roofs, each one a single breakable panel. Dockside has one in the upper floor and one in the roof, the hotel two in the first-floor slab and three in the roofs. Bullets (150 damage), melee and breach charges break them (a hole you can see and drop through; players fall to the floor below), and defenders can **reinforce** one in prep like a wall (V; reinforced covers shrug off bullets, melee and basic charges, and only a heavy charge breaks them). **Drones can't fall in**: for them an open hatch is still floor. Every round they are back.
- **Defender run-out detection** (action phase only): when a defender leaves the building's footprint (the hotel's balconies count as inside), a **3 second countdown** appears on their screen ("LEAVING THE BUILDING · 3"). If they are still outside at zero they are **detected**: their screen shows **DETECTED** and every attacker sees them highlighted red through walls. Being back inside for **1 second** clears it and resets the countdown. The server decides inside or outside from each map's building boundary (`building` in the map file) using its own copy of the player's position.
- **Server and shared code:** movement lives in `shared/movement.js` (vault and rappel are part of the player state, predicted and checked like walking). The snapshot carries `vt` and `rk` only while a player is vaulting or on a rope.

### Earlier: Stage 21 (gun rework and charms)

- **Every gun rebuilt with far more detail**, all drawn in code (no image or model files), in `client/src/gunModels.js`: receiver, handguard, barrel, muzzle device, rails with teeth, stock, grip, trigger and trigger guard, magazine, sights or optics, ejection ports, vents, bolt and more (up to about 100 small shapes per gun). Eight original designs with their own silhouettes: assault rifle, SMG, shotgun (pump, shell loops, tube magazine), LMG (box magazine with belt, carry handle, bipod), marksman rifle (long scope, bipod), pistol, revolver (cylinder with six chambers, hammer) and machine pistol. Guns of the same type differ by their optic (red dot, scope or iron sights) and muzzle device (flash hider, compensator or suppressor), picked from the gun's id, so they don't all look alike. None copies a real branded gun.
- **Named parts with roles:** every part has a name (`receiver.main`, `barrel.main`, `magazine.body`, `stock.tube`...) and a role: **body** (receiver, handguard, slide), **accent** (stock, grip, magazine, trigger guard), **steel** (barrel, muzzle, rails, bolt) and **trim** (sights, optic housing, vents), plus unchanging glass.
- **Skins use the parts:** every skin now has `body`, `accent`, optional `steel` and `trim` colours, so the barrel, the furniture and the sights can each get their own look (a gilded skin has gold metal, circuit has glowing cyan sights, and so on). Patterns (stripes, camo, circuit, flames, void) are drawn on every body part, including the handguard and slide, and glow on bright skins.
- **Used everywhere:** the first-person view, other players' hands, the menu stage, the Operators tab and the crate opening all build their guns from the same function.
- **Animations:** the bolt, slide or pump kicks back with every shot (the revolver turns its cylinder and drops its hammer), and during a reload the magazine drops out and slides back in. Other players' guns animate the same way.
- **Gun charms:** 30 original charms hang from the left side of a gun on a short string and swing like a pendulum with movement and recoil (a faint idle sway when still). Common (12): Dog Tag, Brass Bullet, Lucky Dice, Padlock, Old Key, Cog, Four-Leaf Clover, Horseshoe, Feather, Gold Coin, Compass, Hex Nut. Rare (9): Little Skull, Service Medal, Tiny Shield, Gold Star, Heart, Crescent Moon, Mini Grenade, Lightning Bolt, Anchor. Epic (6): Crown, Cut Diamond, Dragon Fang, Crystal Orb, Toy Rocket, Living Flame. Legendary (3): **White Eagle** (the Polish white eagle with a gold crown and beak, on a red shield with a white band: the colours of the Polish flag), Golden Dragon, Galaxy Orb.
  - **How you get them:** levelling up gives a charm **every 2 levels** (level 2 Dog Tag, 4 Brass Bullet, 6 Lucky Dice ... up to level 30; the list is the 12 commons, then Little Skull, Service Medal and Tiny Shield). Levels are worked out on the server, so nothing extra is stored. The **Charm crate** in the Shop (first card) holds all 30: 900 Money, the same odds as skin crates (Common 60%, Rare 25%, Epic 12%, Legendary 3%), a **duplicate refunds 450 Money**, and the same opening animation (the charm rises out of the crate). The server takes the Money and draws the charm.
  - **Equipping:** one charm per gun, in the Operators tab under the gun's skins (locked ones show the level that unlocks them and send you to the Shop when clicked). Other players see your charm: it is part of the loadout the server sends with the match.
  - **Server:** two new columns (`owned_charms`, `equipped_charms`) are added automatically. `PUT /api/equip/charm` checks you own the charm; `POST /api/crates/charm` is locked per account like the skin crates.

### Earlier: Stage 20 (owner and admin tools)

- **Owner and admins come from environment variables**, never from inside the game: `OWNER_USERNAME` (one username) and `ADMIN_USERNAMES` (comma-separated, optional). The owner is automatically an admin. Usernames are matched ignoring upper/lower case. See "Owner and admins" below for how to set them.
- **Owner badge:** a gold **OWNER** tag next to the owner's name in the menu top bar, the room lobby, the Tab scoreboard, the kill feed, the end-of-match screen and the Friends tab (friends, search results, requests and the party). The server tells clients who the owner is; nobody else can get the tag.
- **Admin tab** (only admins see it; the server checks the caller's role again on every admin request):
  - **Online:** everyone online with username, rank, level and whether they're in the menu, a lobby or a match (with the room code). Refreshes every 3 seconds while the tab is open.
  - **Matches:** every room with its code, map, players on each team, round and score. Each has three buttons:
    - **Spectate (invisible):** a free camera you fly with WASD (Space/C up and down, Shift fast). Click to follow each living player in turn (first person), **F** goes back to the free camera, **Backspace** or the "Stop spectating" button leaves. You see everyone's operator and gun and nothing is hidden. You aren't a member of the room: you never appear in the lobby, the scoreboard, the player counts or the friends' "in a match" status. When the match ends you are sent back to the menu.
    - **Join attack / Join defense:** join as a player on that side if it has space (5 per team). Joining mid-match works like any late joiner (you play from the next round).
- The spectator uses almost no extra server memory: one more copy of the snapshot per tick, only while someone is watching.

### Earlier: Stage 19 (finishing up) + barricade X design

- **X design:** a barricade is now **7 thinner horizontal planks** (same overall size) with **two diagonal planks forming an X** over the front (the side facing away from the map centre). Doors keep the low gap at the bottom for drones. The X planks have no collision of their own: they are drawn in pieces, one per plank segment, so they break together with the section they cross.
- **Melee grid:** 3 columns by the height you aim at. Each hit breaks a hole a third of the width and **2 planks tall** at the aimed height (with 7 thin planks the holes are smaller than before), through both layers. If that section is already broken, the nearest section that still has two planks standing breaks instead. The 3rd hit still breaks everything. Bullets and explosives work as before.

### Earlier: melee barricade grid

- **Melee breaks one section at a time:** each barricade is a grid of 3 columns (left, middle, right) and 3 rows of 2 planks (bottom, middle, top). A melee hit knocks out the one section you are aiming at: a hole a third of the width and 2 planks tall, with ragged splintered plank ends. If that section is already gone, the nearest section that still has anything standing breaks instead, so no hit is wasted. The **3rd hit** breaks the whole barricade. Holes are real gaps (you can see and shoot through them), synced to everyone, and the pieces fall off as wood debris with a breaking sound.
- Bullets still break one piece at a time (each plank is now 3 pieces), and breach charges and grenades still destroy the whole barricade.


- **New barricade look:** a solid green panel of 6 horizontal wooden planks with two yellow straps and a yellow cross on both faces. A **window** is covered completely. A **door** barricade leaves the bottom 0.32 m open with no plank: a drone (0.28 m tall) can drive through it, but a player can't (even lying prone they are 0.5 m tall). The straps and cross disappear once the panel is damaged.
- **Breaking:** a barricade breaks completely after **3 melee hits** (right click; the first two each knock out one grid section, see above). Bullets still knock out single pieces (to shoot or look through), and breach charges, frag and impact grenades destroy a whole barricade at once. Melee hits on a barricade only count in the action phase.
- **Windows and outside doors start barricaded:** every window and every door leading outside begins every round already barricaded, using the same breakable barricades (doors keep the drone gap at the bottom), and they are put back each round. Doors between rooms are not included. These free barricades don't use up the defenders' 8 per round and don't count towards the barricade quest.
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
  - **Claymore**: sticks to a floor or wall and arms after 1.2 s, then shoots out three thin laser tripwires in a narrow fan (left, middle, right, each up to 2 m). Each line stops at the first wall, prop, shield or barricade in its way. It only goes off when an **enemy player's body touches a line**; teammates and drones don't trigger it. The blast hits enemies in front of it within 3.4 m and **kills them outright** (full health or armour make no difference); anyone behind it is safe. The lines are thin and faintly visible to everyone, clearest next to the claymore and fading to almost nothing at the far end, and enemies can shoot the claymore (or hit it with melee) to destroy it without it going off
  - **Flash grenade**: blinds enemies who can see the burst for 3.2 s (40% as long if they look away); no slow
  - **Impact grenade**: explodes the moment it hits anything, including an enemy; 60 damage within 3.2 m, smashes barricades and blows a small hole (0.8 m) in soft walls
  - **Smoke grenade**: a thick cloud that blocks sight for 12 s
  - **Frag grenade**: bounces, bursts after 2.2 s; 95 damage within 5.5 m (falling off, blocked by walls), smashes barricades and blows a bigger hole (1.3 m) in soft walls
- Utilities are placed or thrown in prep (defenders) and action. They only ever hurt enemies. Reinforced walls are never affected by grenades.
- **Prep wall damage:** during prep, defenders can damage soft walls with bullets, melee and frag/impact grenades, to open sight lines and shooting holes before the round (attackers have no body in prep, so it's defenders only). Walls can't be damaged during operator select. Barricades still only take damage in the action phase.

### Earlier: Stage 10 (movement and keybinds)

- Jump (Space) for players and drones (players lost the jump in Stage A; Space only vaults now); players can't shoot in mid-air. A drone hop arcs about 0.5 m up and 1.5 m forward, once per second
- Prone (Z, toggle): slow, no sprinting, a smaller hitbox lying along the body; crouch moved to C and defender cameras to T
- Settings → Keybinds: rebind every action to any key or mouse button, reset to default; saved to the account

### Earlier: Stage 9 (accounts)

- Log in or create an account (username + password); you stay logged in between visits
- Your profile shows your level, Money, Polish Money and rank points, and saves your settings
- Create a room (4-letter code) or join one; your username is your name in the lobby and in matches
- Pick Attack or Defense in the lobby (max 5 per team); the host starts the match
- First-person movement: WASD, mouse look (pointer lock), Shift sprint, Space vault, C crouch, Z prone, Q/E lean, right click aim, N rappel, M flip (all rebindable)
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
- **Melee (3, was right click before Stage A):** 45 damage to an enemy in front of you (about 2 m), 0.8 s cooldown. It also smashes barricades (3 hits break one completely), knocks out **one wall panel per hit** (never a reinforced wall), and attackers can use it to smash cameras
- **Barricades (B, defenders, prep only):** nail wooden planks over a doorway or window (1 second, 8 per team per round, not while someone stands in the gap). A barricade is a solid panel of 7 thin wooden planks with a diagonal X over the front (`barricadePlanks()` in `shared/barricade.js`); a door's has a 0.32 m open gap at the bottom that a drone can drive through but a player can't, a window's is closed: bullets (2 rifle hits per plank) break planks one by one, each melee hit breaks one grid section (a third of the width, 2 planks tall, at the height you aim) and the 3rd breaks the whole barricade, while a breach charge or a grenade destroys it at once. Each plank is 3 segments (`barricadePlanks()` returns 21 for the 7 planks), index = plank * 3 + column. Planks block movement and bullets until broken. Windows and outside doors start every round already barricaded for free (`Gadgets.placeStartBarricades`)
- **Props:** furniture, crates, barrels, concrete barriers, pallets, planters and parked vehicles inside and outside the building. They are solid, so waist-high ones are cover; rugs, pictures, monitors and plants are decoration only
- **Player models:** other players are drawn as a humanoid with helmet, head, vest, arms holding the (detailed, skinned, charmed) gun, and bending legs with a walk cycle, crouch pose and a melee swing
- **Three objective sites** in different rooms (upstairs office, ground-floor back room, upstairs west room). During operator select the defenders vote on one (ties and no votes are settled at random). Attackers aren't told which; a drone that gets within 6 m with a clear view of the objective, or an attacker walking into its zone, reveals it to everyone. Defenders start in or right next to the site they voted for (five spawn points per site, facing the objective); they are moved there the moment the vote is decided. Only the chosen site can be captured, the three boxes look identical, and the zone ring and "Objective:" label only appear once you know the site
- **Sound** is positional: you hear other players from the right direction, quieter and duller with distance, through walls and from another floor. Footsteps: sprinting is loud and carries about 40 m, walking about 14 m, crouch-walking only a couple of metres. Also reloading, landing from a fall, barricades and walls breaking, gadgets being placed, melee swings and drone motors. Volume is in the settings menu
- Defenders reinforce wall sections (V, 10 per team, in prep and action): darker, immune to bullets and basic charges; only a heavy charge (Spark, stage 6) breaks them

## Planned: later stages

Written down so they aren't forgotten (see Status for what is built). They are built one at a time, one PR each, and the next one starts once the previous is confirmed. Server memory must stay low enough for Render's 512 MB plan.

### Stage 2G - Gun feel, recoil and sound
- Every gun gets its own recoil pattern: vertical climb, horizontal kick and randomness that suit its type (LMG climbs steadily, SMG jitters fast, shotgun one big kick, pistol snaps up and resets). Overall recoil noticeably stronger than now and controllable by pulling the mouse down.
- Recoil moves the gun model and the camera, then recovers smoothly.
- Muzzle flash, shell casings, small camera shake, gun kick-back, impact effects on different surfaces (wood, metal, concrete, glass).
- Better sounds: each gun type sounds different, a sharp close sound and an echoey distant one; indoors more muffled than outdoors; reload, empty-click and bolt sounds. Generated in code or layered synthesised samples, no copied audio.
- All recoil and sound settings per gun in the gun config file.

### Stage 2H - First-person hands
- The player's arms and gloved hands holding the gun in first person: one hand on the grip with a finger by the trigger, the other on the front of the gun. Pistols are held with both hands.
- Hands use the operator's outfit colours (sleeves and gloves).
- Hands animate: reloading (magazine out and in), switching weapons, throwing utilities, placing gadgets, melee, and holding a grenade before the throw.
- Built in code, original design, no external assets.

### Stage 2I - Tester role, chat, reports and admin inbox
- Tester role set by the `TESTER_USERNAMES` environment variable on Render (comma-separated; the account "max" is a tester). Testers get a black and white "TESTER" badge wherever names show, like OWNER.
- Testers can open the admin tab but STRICTLY only: see everyone online, see all active matches and join or spectate them, and send announcements. Reports, chat logs, gifts, Money, warn/suspend/ban are hidden and refused by the server for testers.
- In-match chat: Y for all, U for team (rebindable); messages bottom left for a few seconds with name, badge and [TEAM] or [ALL]; max length and a short cooldown.
- Report player from the scoreboard or end-of-match screen: reason (cheating, abusive chat, offensive name, griefing, other) and optional comment.
- Owner-only inboxes: Reports (who, why, when, match and its chat log; mark resolved, warn, suspend for a chosen time (1 minute, 1 hour, 1 day, 3 days, 7 days, 30 days or custom), ban, lift early), Chat (all messages from all matches, newest first, searchable by username, kept 14 days), and a list of everyone currently suspended or banned. Suspended players can't log in and see how long is left.

### Stage 2J - Settings and update notes
- Graphics settings: presets (Low, Medium, High, Ultra) plus separate shadows, render resolution, effects/particles, view distance and anti-aliasing, and an FPS counter option. Low runs smoothly on weak laptops.
- "What's new": a `CHANGELOG` file in the repo with a plain-English entry for every merged PR; the first login after an update shows a popup with that update's changes, reopenable from the menu.

### Stage 2K - Shop redesign
- Per-gun skin crates removed (owned skins stay owned). One combined crate with every crate skin and charm for every gun, odds and contents shown before buying, duplicate refund stays.
- Daily shop: a pool of 50 new original skins; every day at the same time 6 are picked at random for 24 hours with a countdown. Roughly Rare 3000, Epic 5000, Legendary 8000 Money. Some daily items are skin packs: one skin applied to 5 randomly chosen guns each time the pack appears.
- A "Limited" section with a few special skins available for a set number of days, then gone.
- Money only, never Polish Money; the server handles every purchase.
- Much better looking: large item cards with the gun in slowly turning 3D, rarity colour borders and glows, price tags, "OWNED" labels, a featured banner for the best daily item and smooth hover animations.

### Stage 2L - Two new detailed maps
- Two new, much more detailed maps; the original maps are not changed, and all future maps use this level of detail.
- Furniture built from many shapes (couches with cushions and armrests, beds, tables with legs, shelves with items, kitchen counters, lamps, rugs) with textures drawn in code (fabric, wood grain, tiles, carpet).
- A mix of soft (destructible) and hard (indestructible) walls that clearly look different; paintings, posters, clocks, light switches, shelves, windows with frames and curtains.
- Outside terrain that isn't flat: hills, slopes, paths, steps, low walls, fences, bushes and trees, with at least one attacker spawn at the bottom of a path leading up to the building.
- Detailed vehicles (wheels, windows, lights, doors, no real brands) as cover.
- Each map: 3 objective sites, hatches, rappel points, barricade spots, attacker spawns and a building boundary for run-out detection; both get top-down minimaps for the location select screen. Light enough for the Low graphics setting.

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
  movementConfig.js  MOVEMENT TUNING: speeds, acceleration, strafing, stances, aiming, head bob, weapon sway
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
  voiceLines.js    every voice line, operator voices, ping types
  modes.js         the game modes and the Defuser numbers (7 s, 7 s, 45 s)
  progression.js   rank ladder, level maths, daily quest definitions
  skins.js         gun skin catalog: rarities, colours, patterns
  exclusiveSkins.js  the 40 gift-only Exclusive skins (effect, colours, particles)
  charms.js        the 30 gun charms, level rewards and the charm crate odds
server/
  index.js         Express static hosting + Socket.IO events
  bots.js          the bots' brains (server side)
  nav.js           the walking grid and distance fields bots move by
  killcam.js       the last 4.5 s of everyone's movement and shots, sent to a player who is killed
  defuser.js       the Defuser mode: carrier, drop, plant, countdown, disable
  roles.js         owner and admin lookup from the environment variables
  admin.js         the admin tools: online list, matches, join as spectator or player
  gifts.js         announcements, sending gifts, the gift list and claiming (one claim per account)
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
  src/menuScene.js 3D scene behind the main menu: operator, lights, camera drift, gifts and crates
  src/menuBackdrop.js  the rooftop at dusk: sky, city, target building, searchlight, fog, rain
  src/menuMusic.js the ambient menu music (Web Audio)
  src/graphics.js  the graphics setting (auto / high / low)
  src/network.js   Socket.IO wrapper, server clock estimate
  src/game.js      Three.js scene and frame loop
  src/preRound.js  the location and loadout screens before each round (and the attackers' prep loadout)
  src/topMap.js    the top-down map plan on the location screen
  src/opPreview.js the turning 3D operator on the loadout screen
  src/player.js    local player: input, prediction, reconciliation, camera
  src/avatars.js   other players: bodies, guns, name tags, interpolation
  src/weapons.js   first-person gun models, recoil/reload animation
  src/effects.js   tracers, bullet holes, impact puffs
  src/audio.js     synthesised sound effects, positional playback (range, direction, muffling)
  src/soundscape.js  footsteps, landing, reloads, drones, gadgets: what you hear and from where
  src/gadgets.js   visuals for operator gadgets and grenades
  src/exclusiveSkins.js  the animated shader effects and particles of Exclusive skins
  src/giftScene.js the presents in the menu and the unwrapping animation
  src/skinThumbs.js  pictures of skins (each on a rifle) for the admin gift gallery
  src/drones.js    drone models for everyone, smoothing, destroyed effect
  src/destruction.js  instanced wall panels, charges, explosions
  src/map.js       renders the shared map, lighting
  src/ui.js        lobby and HUD DOM
```

## Movement and keybinds

- Vault and prone are input bits (`KEY.JUMP`, `KEY.PRONE`) simulated by `shared/movement.js` on both sides, so prediction and the server agree. `KEY.JUMP` only vaults for players (there is no jump); for drones it is the hop. Prone is a toggle on the client, which sends the PRONE bit while it's on; crouching or vaulting gets you up.
- Aiming is `KEY.AIM`. `state.ads` (0..1) moves toward it over `ADS.time` and is sent in snapshots as `ad`; it scales walking speed and spread (`ADS` in `shared/constants.js`). Toggle lean and toggle aim are client-side: the client sends the lean or aim bits while the toggle is on (`leanOn`, `aimOn` in `client/src/player.js`). The zoom comes from the gun's sight (`sightOf()` in `client/src/gunModels.js`, which also decides which sight each gun model gets).
- `state.prone` (0..1) blends height, eye height and speed. Getting up needs head room; if standing doesn't fit, you end up crouched.
- Lying down (`prone >= 0.5`), the hitbox in `shared/raycast.js` is a low box along the facing direction with the head in front. The avatar in `client/src/avatars.js` uses the same measurements, and lag compensation records `prone` with every pose.
- No shooting mid-air: `weaponInput()` drops the trigger while `!onGround`.
- The page and the server must run the same `shared/` code, or prediction disagrees with the server and things jitter. `npm run build` stamps the page with a fingerprint of `shared/*.js` (`server/sharedVersion.js`); the server rejects a connection with a different one, and the page reloads once (or shows a message). After changing shared code locally, rebuild **and** restart `npm start`. `npm run dev` skips the check.
- Keybinds live in `settings.keybinds` (action → `KeyboardEvent.code` or `MouseN`). The server cleans them with `sanitizeKeybinds()`: unknown actions are dropped, bad codes reset, and duplicates unbound. Esc can't be rebound. Keys 1-3 also choose the entry point while an attacker is in prep, whatever they're bound to (1/2/4 are the default weapon and utility keys). Binding a key that's already used swaps the two actions.
- Hints, prompts and ability descriptions use `keyFor(action)` / `{action}` placeholders, so they show the player's own keys.

## Owner and admins

Set two environment variables on the server:

- `OWNER_USERNAME`: the owner's username (one name).
- `ADMIN_USERNAMES`: extra admins, comma-separated (for example `Anna, Ben`). Optional.

**On Render:** open the `breachline` service, then **Environment**, then **Add Environment Variable**. Add `OWNER_USERNAME` with your username as the value, and (if you want) `ADMIN_USERNAMES`. Save, and Render redeploys. **Create your account in the game first, then set the variable**: whoever registers that username owns the role, so don't leave it unregistered.

**Locally:** put `OWNER_USERNAME=yourname` (and optionally `ADMIN_USERNAMES=...`) in the `.env` file in the project folder (git ignores it), then restart the server.

Admins get an **Admin** tab: announcements, gifts and Send Money, the gifts sent so far, everyone online, and every match (spectate or join). Gifts are stored in the `gifts`, `gift_recipients` and `gift_claims` tables (created automatically).

There is no in-game way to become owner or admin. Roles are worked out on the server from the username stored at login (`server/roles.js`), and each admin action (`server/admin.js`) checks again.

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

Other players' sounds are derived on each client from the snapshots (speed, stance, reload state, walking through barbed wire), so they cost no extra network traffic. `Audio.play()` takes a source position and a range, and handles falloff, stereo direction (from the camera's facing), and muffling for walls (one ray per sound) and other floors. Add a new sound by adding a recipe to `SOUNDS` in `client/src/soundscape.js`. There is no jumping in the game, so "landing" sounds play for falls only.

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
4. Draw its icon in `client/src/operatorIcons.js`. A gun may be shared by at most 2 operators.

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
