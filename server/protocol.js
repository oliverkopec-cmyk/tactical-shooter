// The realtime protocol's message handling, shared by the Node server (server/realtime.js) and the Cloudflare
// match rooms (worker/matchRoom.js). The protocol itself is described at the top of server/realtime.js.

// Events only the server raises: a client can't send them
export const RESERVED = new Set(['disconnect', 'batch', 'connection']);

export const encode = (event, payload) => JSON.stringify(payload === undefined ? [event] : [event, payload]);

/**
 * One message from a client. socket needs dispatch(event, args) (runs that event's handlers) and sendText(text).
 *   ["e", event, payload]       -> handlers get (payload)
 *   ["r", id, event, payload]   -> handlers get (payload, reply); the reply goes back as ["~ack", id, result]
 *   ["b", { i, a, p }]          -> the 'batch' handlers
 */
export function receive(socket, text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (!Array.isArray(msg) || typeof msg[0] !== 'string') return;
  const [kind] = msg;
  if (kind === 'e' && typeof msg[1] === 'string' && !RESERVED.has(msg[1])) {
    socket.dispatch(msg[1], msg.length > 2 ? [msg[2]] : []);
  } else if (kind === 'r' && typeof msg[2] === 'string' && !RESERVED.has(msg[2])) {
    const id = msg[1];
    let answered = false;
    const reply = (result) => {
      if (answered) return;
      answered = true;
      socket.sendText(JSON.stringify(['~ack', id, result === undefined ? null : result]));
    };
    socket.dispatch(msg[2], msg.length > 3 ? [msg[3], reply] : [reply]);
  } else if (kind === 'b' && msg[1] && typeof msg[1] === 'object') {
    socket.dispatch('batch', [msg[1]]);
  }
}
