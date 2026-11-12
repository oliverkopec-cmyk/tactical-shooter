// Creating, joining and admin-joining rooms on the Node server, where every room lives in this process
// (server/menuEvents.js calls these). The Cloudflare central object has its own (worker/central.js).

export function nodeRooms({ rooms, social, admin }) {
  return {
    create(socket) {
      const me = socket.data.account.id;
      const party = social.partyOf.get(me);
      // A party's room is made by its leader, and the whole party comes with them
      if (party && party.leader !== me) {
        return { ok: false, error: 'Only the party leader can create a room for the party. Leave the party to make your own.' };
      }
      if (socket.data.room) socket.data.room.remove(socket);
      socket.data.spectating?.removeSpectator(socket);
      const room = rooms.createRoom();
      room.add(socket);
      const joined = [], busy = [];
      if (party) {
        const leaderTeam = room.members.get(socket.id).team;
        for (const id of party.members) {
          if (id === me) continue;
          const member = social.socketOf(id);
          if (!member) continue;
          if (member.data.room) { busy.push(member.data.account.username); social.notice(me, `${member.data.account.username} is in another room, so they didn't join.`); continue; }
          room.add(member);
          room.setTeam(member.id, leaderTeam);   // the party plays together
          joined.push(member.data.account.username);
        }
      }
      return { ok: true, code: room.code, id: socket.id, party: party ? { joined, busy } : null };
    },

    join(socket, code) {
      const room = rooms.get(code);
      if (!room) return { ok: false, error: 'No room with that code.' };
      if (room.isFull()) return { ok: false, error: 'That room is full.' };
      if (socket.data.room) socket.data.room.remove(socket);
      socket.data.spectating?.removeSpectator(socket);
      room.add(socket);
      return { ok: true, code: room.code, id: socket.id };
    },

    adminJoin(socket, req) { return admin.join(socket, req); },
  };
}
