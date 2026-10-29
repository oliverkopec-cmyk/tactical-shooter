// Client entry: wires login, the lobby UI, network, and game together.

import { Network } from './network.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { getSession, signUp, logIn, logOut, syncSettingsToAccount } from './account.js';
import { applyAccountSettings } from './settings.js';
import { Menu } from './menu.js';
import { usernameError, passwordError } from '../../shared/account.js';

const network = new Network();
const ui = new UI();
const game = new Game(document.getElementById('game'), network, ui);

let room = null;
let account = null;   // profile from the server, null when logged out
let replaced = false; // this tab was kicked because the account logged in elsewhere
let outdated = '';    // set when the server runs different game code than this page
ui.bindCopyCode();

// Main menu: tabs, 3D operator, Operators tab. Server-sent profile changes redraw it.
function setAccount(profile) {
  account = profile;
  ui.renderProfile(profile);
  menu.refresh();
}
const menu = new Menu({ getAccount: () => account, setAccount, onSettings: () => ui.openSettings(false) });
ui.onShow = (screen) => menu.setActive(screen === 'home');
syncSettingsToAccount(() => !!account);

function enterAccount(profile) {
  applyAccountSettings(profile.settings);
  setAccount(profile);
  ui.homeError('');
  ui.show('home');
  network.connect();
}

function leaveAccount(message = '') {
  ui.hideMatchSummary();
  account = null;
  room = null;
  game.stop();
  network.disconnect();
  ui.clearPassword();
  ui.show('auth');
  ui.authError(message);
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

ui.bindHome({
  onCreate: async () => {
    ui.homeError('');
    if (!(await network.ensureConnected())) return ui.homeError(outdated || 'Could not connect to the server.');
    const res = await network.request('createRoom');
    if (!res.ok) return ui.homeError(res.error || 'Could not create room.');
  },
  onJoin: async () => {
    ui.homeError('');
    if (ui.code.length !== 4) return ui.homeError('Enter a 4-letter room code.');
    if (!(await network.ensureConnected())) return ui.homeError(outdated || 'Could not connect to the server.');
    const res = await network.request('joinRoom', { code: ui.code });
    if (!res.ok) return ui.homeError(res.error || 'Could not join room.');
  },
});

ui.bindLobby({
  onTeam: async (team) => {
    const res = await network.request('setTeam', team);
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
network.on('notice', ({ message }) => ui.lobbyError(message));

// The server pays out rewards and rank changes itself and tells us the new numbers.
network.on('profile', (profile) => {
  if (!account) return;
  setAccount({ ...account, ...profile });
});
network.on('matchSummary', (summary) => ui.showMatchSummary(summary));

network.on('sessionReplaced', () => { replaced = true; });

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
  if (res.account) enterAccount(res.account);
  else {
    ui.show('auth');
    ui.authError(res.error);
  }
});

// Guard against Ctrl+W (if Ctrl is bound to an action) closing the tab mid-match.
window.addEventListener('beforeunload', (e) => {
  if (game.running) e.preventDefault();
});

// ?debug exposes internals in the console for testing.
if (new URLSearchParams(location.search).has('debug')) window.breachline = { game, network, ui, menu };
