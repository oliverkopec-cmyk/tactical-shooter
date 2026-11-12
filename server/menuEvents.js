// Everything a player does from the menus over their main connection: parties, gifts and Christmas presents,
// warnings, and the admin and owner tools. Shared by the Node server (server/index.js) and the Cloudflare central
// object (worker/central.js). Creating, joining and admin-joining a room work differently in the two (rooms live in
// this process on Render, in their own Durable Objects on Cloudflare), so `rooms` does those:
//   rooms.create(socket) -> { ok, code, party } | { error }
//   rooms.join(socket, code) -> { ok, code } | { error }
//   rooms.adminJoin(socket, { code, mode }) -> { ok, code, ... } | { error }

const reply = (ack, payload) => { if (typeof ack === 'function') ack(payload); };
const obj = (v) => (v && typeof v === 'object' ? v : {});

export function menuEvents(socket, { social, admin, gifts, christmas, moderation, rooms }) {
  const safely = (fn) => async (...args) => {
    const ack = typeof args.at(-1) === 'function' ? args.pop() : null;
    try { reply(ack, await fn(...args)); } catch (err) { console.error('Request failed:', err.message); reply(ack, { error: 'Server error.' }); }
  };

  // ---- rooms
  socket.on('createRoom', safely(() => rooms.create(socket)));
  socket.on('joinRoom', safely((req) => rooms.join(socket, obj(req).code)));

  // ---- parties (invites come from the Friends tab)
  socket.on('partyInvite', safely((accountId) => social.invite(socket.data.account.id, Number(accountId))));
  socket.on('partyRespond', (req, ack) => { const { partyId, accept } = obj(req); reply(ack, social.respondInvite(socket.data.account.id, Number(partyId), !!accept)); });
  socket.on('partyLeave', (ack) => { social.leaveParty(socket.data.account.id); reply(ack, { ok: true }); });
  socket.on('partyState', (ack) => reply(ack, { party: social.partyState(social.partyOf.get(socket.data.account.id)) }));

  // ---- admin tools (each one re-checks the caller's role on the server)
  socket.on('adminOnline', safely(() => admin.online(socket)));
  socket.on('adminMatches', safely(() => admin.matches(socket)));
  socket.on('adminJoin', safely((req) => rooms.adminJoin(socket, { code: String(obj(req).code || ''), mode: String(obj(req).mode || '') })));

  // ---- announcements and gifts (admins send, anyone opens their own)
  socket.on('adminAnnounce', safely((req) => gifts.announce(socket, obj(req))));
  socket.on('adminGift', safely((req) => gifts.create(socket, obj(req))));
  socket.on('adminGifts', safely(() => gifts.history(socket)));
  socket.on('adminFindPlayer', safely((q) => gifts.findPlayers(socket, q)));
  socket.on('giftClaim', safely((id) => gifts.claim(socket, id)));
  socket.on('giftList', safely(async () => ({ gifts: await gifts.pendingFor(socket.data.account.id) })));
  socket.on('christmasClaim', safely((day) => christmas.claim(socket, day)));
  socket.on('christmasState', safely(async () => ({ christmas: await christmas.stateFor(socket.data.account.id) })));
  socket.on('christmasDevDate', safely((date) => christmas.devDate(date)));
  socket.on('christmasDevReset', safely(() => christmas.devReset(socket)));

  // ---- warnings, and the owner's moderation tools (the owner-only ones re-check the caller on the server)
  socket.on('warnings', safely(() => moderation.deliverWarnings(socket)));
  socket.on('warningsSeen', safely((ids) => moderation.markWarningsSeen(socket, ids)));
  socket.on('modReports', safely((req) => moderation.reports(socket, obj(req))));
  socket.on('modReport', safely((req) => moderation.reportDetail(socket, obj(req))));
  socket.on('modResolve', safely((req) => moderation.resolve(socket, obj(req))));
  socket.on('modSanction', safely((req) => moderation.sanction(socket, obj(req))));
  socket.on('modLift', safely((req) => moderation.lift(socket, obj(req))));
  socket.on('modBlocked', safely(() => moderation.blocked(socket)));
  socket.on('modChat', safely((req) => moderation.chatLog(socket, obj(req))));
}
