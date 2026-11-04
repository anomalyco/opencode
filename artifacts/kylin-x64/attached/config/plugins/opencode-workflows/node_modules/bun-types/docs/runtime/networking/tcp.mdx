---
title: TCP
description: Use Bun's native TCP API to implement performance sensitive systems like database clients, game servers, or anything that needs to communicate over TCP (instead of HTTP)
---

This is a low-level API intended for library authors and for advanced use cases.

## Start a server (`Bun.listen()`)

To start a TCP server with `Bun.listen`:

```ts server.ts icon="/icons/typescript.svg"
Bun.listen({
  hostname: "localhost",
  port: 8080,
  socket: {
    data(socket, data) {}, // message received from client
    open(socket) {}, // socket opened
    close(socket, error) {}, // socket closed
    drain(socket) {}, // socket ready for more data
    error(socket, error) {}, // error handler
  },
});
```

<Accordion title="An API designed for speed">

In Bun, a set of handlers are declared once per server instead of assigning callbacks to each socket, as with Node.js `EventEmitters` or the web-standard `WebSocket` API.

```ts server.ts icon="/icons/typescript.svg"
Bun.listen({
  hostname: "localhost",
  port: 8080,
  socket: {
    open(socket) {},
    data(socket, data) {},
    drain(socket) {},
    close(socket, error) {},
    error(socket, error) {},
  },
});
```

For performance-sensitive servers, assigning listeners to each socket can cause significant garbage collector pressure and increase memory usage. By contrast, Bun only allocates one handler function for each event and shares it among all sockets. This is a small optimization, but it adds up.

</Accordion>

Contextual data can be attached to a socket in the `open` handler.

```ts server.ts icon="/icons/typescript.svg"
type SocketData = { sessionId: string };

Bun.listen<SocketData>({
  hostname: "localhost",
  port: 8080,
  socket: {
    data(socket, data) {
      socket.write(`${socket.data.sessionId}: ack`); // [!code ++]
    },
    open(socket) {
      socket.data = { sessionId: "abcd" }; // [!code ++]
    },
  },
});
```

To enable TLS, pass a `tls` object containing `key` and `cert` fields.

```ts server.ts icon="/icons/typescript.svg"
Bun.listen({
  hostname: "localhost",
  port: 8080,
  socket: {
    data(socket, data) {},
  },
  tls: {
    // can be string, BunFile, TypedArray, Buffer, or array thereof
    key: Bun.file("./key.pem"), // [!code ++]
    cert: Bun.file("./cert.pem"), // [!code ++]
  },
});
```

The `key` and `cert` fields expect the _contents_ of your TLS key and certificate. This can be a string, `BunFile`, `TypedArray`, or `Buffer`.

```ts server.ts icon="/icons/typescript.svg"
Bun.listen({
  // ...
  tls: {
    key: Bun.file("./key.pem"), // BunFile
    key: fs.readFileSync("./key.pem"), // Buffer
    key: fs.readFileSync("./key.pem", "utf8"), // string
    key: [Bun.file("./key1.pem"), Bun.file("./key2.pem")], // array of above
  },
});
```

The result of `Bun.listen` is a server that conforms to the `TCPSocket` interface.

```ts server.ts icon="/icons/typescript.svg"
const server = Bun.listen({
  /* config*/
});

// stop listening
// parameter determines whether active connections are closed
server.stop(true);

// let Bun process exit even if server is still listening
server.unref();
```

---

## Create a connection (`Bun.connect()`)

Use `Bun.connect` to connect to a TCP server. Specify the server to connect to with `hostname` and `port`. TCP clients can define the same set of handlers as `Bun.listen`, plus a couple client-specific handlers.

```ts server.ts icon="/icons/typescript.svg"
// The client
const socket = await Bun.connect({
  hostname: "localhost",
  port: 8080,

  socket: {
    data(socket, data) {},
    open(socket) {},
    close(socket, error) {},
    drain(socket) {},
    error(socket, error) {},

    // client-specific handlers
    connectError(socket, error) {}, // connection failed
    end(socket) {}, // connection closed by server
    timeout(socket) {}, // connection timed out
  },
});
```

To require TLS, specify `tls: true`.

```ts
// The client
const socket = await Bun.connect({
  // ... config
  tls: true, // [!code ++]
});
```

---

## Hot reloading

Both TCP servers and sockets can be hot reloaded with new handlers.

<CodeGroup>

```ts server.ts icon="/icons/typescript.svg"
const server = Bun.listen({
  /* config */
});

// reloads handlers for all active server-side sockets
server.reload({
  socket: {
    data() {
      // new 'data' handler
    },
  },
});
```

```ts client.ts icon="/icons/typescript.svg"
const socket = await Bun.connect({
  /* config */
});

socket.reload({
  data() {
    // new 'data' handler
  },
});
```

</CodeGroup>

---

## Buffering

Currently, TCP sockets in Bun do not buffer data. For performance-sensitive code, it's important to consider buffering carefully. For example, this:

```ts
socket.write("h");
socket.write("e");
socket.write("l");
socket.write("l");
socket.write("o");
```

...performs significantly worse than this:

```ts
socket.write("hello");
```

To simplify this for now, consider using Bun's `ArrayBufferSink` with the `{stream: true}` option:

```ts server.ts icon="/icons/typescript.svg"
import { ArrayBufferSink } from "bun";

const sink = new ArrayBufferSink();
sink.start({
  stream: true, // [!code ++]
  highWaterMark: 1024,
});

sink.write("h");
sink.write("e");
sink.write("l");
sink.write("l");
sink.write("o");

queueMicrotask(() => {
  const data = sink.flush();
  const wrote = socket.write(data);
  if (wrote < data.byteLength) {
    // put it back in the sink if the socket is full
    sink.write(data.subarray(wrote));
  }
});
```

<Note>
**Corking**

Support for corking is planned, but in the meantime backpressure must be managed manually with the `drain` handler.

</Note>
