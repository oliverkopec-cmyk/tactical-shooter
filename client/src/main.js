// Client entry: wires login, the lobby UI, network, and game together.

import { Network } from './network.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { getSession, signUp, logIn, logOut, syncSettingsToAccount } from './account.js';
import { applyAccountSettings } from './settings.js';
import { Menu } from './menu.js';
import { Social } from './social.js';
import { AdminPanel } from './admin.js';
import { ModPanel } from './modAdmin.js';
import { ReportDialog, WarningPopup } from './moderation.js';
import { WhatsNew } from './whatsNew.js';
import { PRESENT_BASE } from '../../shared/christmas.js';
import * as THREE from 'three';
import { makeGunModel, animateGun } from './gunModels.js';
import { sheet } from './gunSheet.js';
import { makeCharmModel, attachCharm } from './charmModels.js';
import { usernameError, passwordError } from '../../shared/account.js';

const network = new Network();
const ui = new UI();
const game = new Game(document.getElementById('game'), network, ui);
// The loadout screen changes skins and charms through the account
game.getAccount = () => account;
game.setAccount = (profile) => setAccount(profile);

let room = null;
let account = null;   // profile from the server, null when logged out
let replaced = false; // this tab was kicked because the account logged in elsewhere
let outdated = '';    // set when the server runs different game code than this page
ui.bindCopyCode();

// Main menu: tabs, 3D operator, Operators tab. Server-sent profile changes redraw it.
function setAccount(profile) {
  account = profile;
  ui.renderProfile(profile);
  document.querySelector('[data-tab=admin]').classList.toggle('hidden', !profile.admin);
  admin.setRole(profile.staffLevel);
  modPanel.setEnabled(profile.staffLevel === 'owner');   // the reports and chat inboxes are the owner's alone
  menu.refresh();
}
const admin = new AdminPanel({ network, onPreviewSkin: (skin) => menu.previewSkin(skin) });
const modPanel = new ModPanel({ network });
new ReportDialog({ network });
const warnings = new WarningPopup({ network });
const whatsNew = new WhatsNew();
const social = new Social({ network, getAccount: () => account, onCreateRoom: () => createRoom() });
const menu = new Menu({
  getAccount: () => account, setAccount, onSettings: () => ui.openSettings(false),
  onTab: (tab) => { social.setVisible(tab === 'friends'); admin.setVisible(tab === 'admin'); modPanel.setVisible(tab === 'admin'); },
  claimGift: (id) => (id >= PRESENT_BASE ? network.request('christmasClaim', id - PRESENT_BASE) : network.request('giftClaim', id)),
  christmasRequest: (name, value) => network.request(name, value),
});
ui.onShow = (screen) => { menu.setActive(screen === 'home'); if (screen === 'home' && account) warnings.check(); };   // unread warnings show up in the menu
syncSettingsToAccount(() => !!account);

function enterAccount(profile) {
  applyAccountSettings(profile.settings);
  setAccount(profile);
  setTimeout(() => whatsNew.showIfNew(), 600);   // the first login after an update shows what changed
  ui.homeError('');
  ui.show('home');
  network.connect();
  social.updatePlayTab();
  social.refresh();
}

function leaveAccount(message = '') {
  ui.hideMatchSummary();
  social.reset();
  social.updatePlayTab();
  account = null;
  room = null;
  game.stop();
  network.disconnect();
  ui.clearPassword();
  ui.show('auth');
  ui.authError(message);
  menu.setGifts([]);
  menu.setChristmas(null);
}

ui.bindAuth({
  onSubmit: async (mode, username, password) => {
    const local = mode === 'signup' ? usernameError(username) || passwordError(password) : (!username || !password) && 'Enter your username and password.';
    if (local) return ui.authError(local);
    ui.authError('');
    ui.authBusy(true);
    const res = await (mode === 'signup' ? signUp : logIn)(username, password);
    ui.authBusy(false);
    if (res.error) return ui.authError(res.error);
    ui.clearPassword();
    enterAccount(res.account);
  },
  onLogout: async () => {
    leaveAccount();
    await logOut();
  },
});

/** Create a room (a party's leader brings the whole party). */
async function createRoom() {
  ui.homeError('');
  if (!(await network.ensureConnected())) return ui.homeError(outdated || 'Could not connect to the server.');
  const res = await network.request('createRoom');
  if (!res.ok) return ui.homeError(res.error || 'Could not create room.');
  if (network.rooms === 'worker') {
    // Rooms on Cloudflare: the central object claimed a code (and told the party); connect to that room's own object
    const joined = await network.openRoom(res.code);
    if (!joined.ok) return ui.homeError(joined.error || 'Could not create room.');
  }
}

ui.bindHome({
  onCreate: createRoom,
  onJoin: async () => {
    ui.homeError('');
    if (ui.code.length !== 4) return ui.homeError('Enter a 4-letter room code.');
    if (!(await network.ensureConnected())) return ui.homeError(outdated || 'Could not connect to the server.');
    const res = network.rooms === 'worker' ? await network.openRoom(ui.code) : await network.request('joinRoom', { code: ui.code });
    if (!res.ok) return ui.homeError(res.error || 'Could not join room.');
  },
});

ui.bindLobby({
  onTeam: async (team) => {
    const res = await network.request('setTeam', team);
    ui.lobbyError(res.error);
  },
  onBot: async (cmd) => {
    const res = cmd.type === 'add' ? await network.request('addBot', { team: cmd.team, difficulty: cmd.difficulty })
      : cmd.type === 'fill' ? await network.request('fillBots', { difficulty: cmd.difficulty })
        : await network.request('removeBot', cmd.id);
    ui.lobbyError(res.error);
  },
  onMode: async (mode) => {
    const res = await network.request('setMode', mode);
    ui.lobbyError(res.error);
  },
  onMap: async (mapId) => {
    const res = await network.request('setMap', mapId);
    ui.lobbyError(res.error);
  },
  onStart: async () => {
    const res = await network.request('startMatch');
    ui.lobbyError(res.error);
  },
  onLeave: () => {
    network.leaveRoom();
    room = null;
    game.stop();
    ui.show('home');
  },
});

network.on('roomState', (state) => {
  room = state;
  ui.renderLobby(state, network.id);
  if (state.phase === 'lobby') {
    if (game.running) game.stop();
    ui.show('lobby');
  }
  else game.syncRoster(state.players);
});

network.on('matchStart', (payload) => {
  ui.show('game');
  game.start(payload);
});

network.on('matchStart', () => ui.lobbyError(''));

// An admin watching a match leaves back to the menu (their own button, or the match ending)
function stopWatching(message = '') {
  network.leaveRoom();
  room = null;
  game.stop();
  ui.show('home');
  if (message) ui.homeError(message);
}
game.onSpectateExit = () => stopWatching();
document.getElementById('spec-leave').addEventListener('click', () => stopWatching());
network.on('spectateEnd', ({ message }) => { room = null; game.stop(); ui.show('home'); if (message) ui.homeError(message); });
network.on('notice', ({ message }) => ui.lobbyError(message));

// The server pays out rewards and rank changes itself and tells us the new numbers.
network.on('profile', (profile) => {
  if (!account) return;
  setAccount({ ...account, ...profile });
});
// Gifts waiting to be opened (sent when we connect and whenever an admin sends one), and admin announcements
network.on('gifts', (list) => menu.setGifts(list));
network.on('christmas', (state) => menu.setChristmas(state));
network.on('announcement', (a) => ui.showAnnouncement(a));
network.on('matchSummary', (summary) => ui.showMatchSummary({ ...summary, name: account?.username, owner: !!account?.owner, tester: !!account?.tester, reportable: game.reportablePlayers() }));

network.on('sessionReplaced', () => { replaced = true; });
// Our party's leader made a room on Cloudflare: join it (on Render the server puts us in it itself)
network.on('partyRoom', async ({ code } = {}) => {
  if (room || !code) return;
  const res = await network.openRoom(code);
  if (!res.ok) ui.homeError(res.error || 'Could not join your party\'s room.');
});
// A Cloudflare room's connection dropped (the main one may still be fine): back to the menu
network.on('roomClosed', (why) => {
  if (!room || why === 'blocked') return;   // blocked: 'sanctioned' on the main connection says why
  room = null;
  game.stop();
  ui.show('home');
  ui.homeError(why === 'replaced' ? 'You joined that room from another tab, so this one left it.' : 'Disconnected from the room.');
});
// The owner warned us (while we were in the menu), or suspended or banned us (we are disconnected)
network.on('warnings', ({ warnings: list }) => warnings.show(list));
network.on('sanctioned', ({ message }) => { if (account) leaveAccount(message); });

// The server refuses the connection when the login has expired or was logged out elsewhere.
network.on('connect_error', (err) => {
  if (err.message === 'outdated') onOutdated();
  else if (err.message === 'unauthorized' && account) leaveAccount('You were logged out. Log in again.');
});

// The server was updated (or restarted with other code): reload once to get the
// matching page. If that didn't help, say so instead of reloading forever.
function onOutdated() {
  network.disconnect();
  let last = 0;
  try { last = Number(sessionStorage.getItem('breachline:reloaded')) || 0; } catch { /* storage unavailable */ }
  if (Date.now() - last > 60000) {
    try { sessionStorage.setItem('breachline:reloaded', String(Date.now())); } catch { /* storage unavailable */ }
    location.reload();
    return;
  }
  outdated = 'This page doesn\'t match the game server. Reload the page. If you run the server yourself: npm run build, then restart it.';
  ui.homeError(outdated);
}

network.on('disconnect', (reason) => {
  if (!account || reason === 'io client disconnect') return;
  if (network.inCloudRoom) return;   // the menu connection dropped, but a Cloudflare room has its own: keep playing
  const message = replaced ? 'This account logged in from another tab or device, so this one was disconnected.'
    : room ? 'Disconnected from the server.' : '';
  replaced = false;
  if (room) {
    room = null;
    game.stop();
    ui.show('home');
  }
  if (message) ui.homeError(message);
});

getSession().then((res) => {
  ui.showStorageWarning(res.storage === 'local');
  network.rooms = res.rooms === 'worker' ? 'worker' : 'node';   // the Cloudflare Worker's rooms are Durable Objects
  if (res.account) enterAccount(res.account);
  else {
    ui.show('auth');
    ui.authError(res.blocked || res.error);   // a suspended or banned account sees why, and for how long
  }
});

// Guard against Ctrl+W (if Ctrl is bound to an action) closing the tab mid-match.
window.addEventListener('beforeunload', (e) => {
  if (game.running) e.preventDefault();
});

// ?debug exposes internals in the console for testing.
if (new URLSearchParams(location.search).has('debug')) window.breachline = { game, network, ui, menu, guns: { makeGunModel, animateGun, THREE, sheet, makeCharmModel, attachCharm } };
