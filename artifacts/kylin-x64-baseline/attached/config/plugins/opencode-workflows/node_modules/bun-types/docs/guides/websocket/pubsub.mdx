---
title: Build a publish-subscribe WebSocket server
sidebarTitle: Pub-sub server
mode: center
---

Bun's server-side `WebSocket` API provides a native pub-sub API. Sockets can be subscribed to a set of named channels using `socket.subscribe(<name>)`; messages can be published to a channel using `socket.publish(<name>, <message>)`.

This code snippet implements a single-channel chat server.

```ts server.ts icon="/icons/typescript.svg"
const server = Bun.serve({
  fetch(req, server) {
    const cookies = req.headers.get("cookie");
    const username = getUsernameFromCookies(cookies);
    const success = server.upgrade(req, { data: { username } });
    if (success) return undefined;

    return new Response("Hello world");
  },
  websocket: {
    // TypeScript: specify the type of ws.data like this
    data: {} as { username: string },

    open(ws) {
      const msg = `${ws.data.username} has entered the chat`;
      ws.subscribe("the-group-chat");
      server.publish("the-group-chat", msg);
    },
    message(ws, message) {
      // the server re-broadcasts incoming messages to everyone
      server.publish("the-group-chat", `${ws.data.username}: ${message}`);
    },
    close(ws) {
      const msg = `${ws.data.username} has left the chat`;
      server.publish("the-group-chat", msg);
      ws.unsubscribe("the-group-chat");
    },
  },
});

console.log(`Listening on ${server.hostname}:${server.port}`);
```
