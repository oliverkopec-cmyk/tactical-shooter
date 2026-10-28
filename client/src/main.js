// Client entry: wires the lobby UI, network, and game together.

import { Network } from './network.js';
import { UI } from './ui.js';
import { Game } from './game.js';

const network = new Network();
const ui = new UI();
const game = new Game(document.getElementById('game'), network, ui);

let room = null;
ui.show('home');

ui.bindHome({
  onCreate: async () => {
    ui.homeError('');
    const res = await network.request('createRoom', { name: ui.name });
    if (!res.ok) return ui.homeError(res.error || 'Could not create room.');
  },
  onJoin: async () => {
    ui.homeError('');
    if (ui.code.length !== 4) return ui.homeError('Enter a 4-letter room code.');
    const res = await network.request('joinRoom', { name: ui.name, code: ui.code });
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

network.on('disconnect', () => {
  if (!room) return;
  room = null;
  game.stop();
  ui.show('home');
  ui.homeError('Disconnected from the server.');
});

// Guard against Ctrl+W (crouch + forward on Windows) closing the tab mid-match.
window.addEventListener('beforeunload', (e) => {
  if (game.running) e.preventDefault();
});

// ?debug exposes internals in the console for testing.
if (new URLSearchParams(location.search).has('debug')) window.breachline = { game, network, ui };
