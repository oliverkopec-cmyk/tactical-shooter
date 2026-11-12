// Refusing a WebSocket the way server/realtime.js does: accept it, send ["~error", message], close with 4000. A browser
// can't read the HTTP status of a refused upgrade, so this is how the page learns why (client/src/network.js).

export function refuseSocket(message) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.send(JSON.stringify(['~error', message]));
  server.close(4000, String(message).slice(0, 100));
  return new Response(null, { status: 101, webSocket: client });
}
