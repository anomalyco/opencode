---
title: UDP
description: Use Bun's UDP API to implement services with advanced real-time requirements, such as voice chat.
---

## Bind a UDP socket (`Bun.udpSocket()`)

To create a new (bound) UDP socket:

```ts
const socket = await Bun.udpSocket({});
console.log(socket.port); // assigned by the operating system
```

Specify a port:

```ts
const socket = await Bun.udpSocket({
  port: 41234, // [!code ++]
});

console.log(socket.port); // 41234
```

### Send a datagram

Specify the data to send, as well as the destination port and address.

```ts
socket.send("Hello, world!", 41234, "127.0.0.1");
```

Note that the address must be a valid IP address - `send` does not perform
DNS resolution, as it is intended for low-latency operations.

### Receive datagrams

When creating your socket, add a callback to specify what should be done when packets are received:

```ts server.ts icon="/icons/typescript.svg"
const server = await Bun.udpSocket({
  socket: {
    data(socket, buf, port, addr) {
      console.log(`message from ${addr}:${port}:`);
      console.log(buf.toString());
    },
  },
});

const client = await Bun.udpSocket({});
client.send("Hello!", server.port, "127.0.0.1");
```

### Connections

While UDP does not have a concept of a connection, many UDP communications (especially as a client) involve only one peer.
In such cases it can be beneficial to connect the socket to that peer, which specifies to which address all packets are sent
and restricts incoming packets to that peer only.

```ts server.ts icon="/icons/typescript.svg"
const server = await Bun.udpSocket({
  socket: {
    data(socket, buf, port, addr) {
      console.log(`message from ${addr}:${port}:`);
      console.log(buf.toString());
    },
  },
});

const client = await Bun.udpSocket({
  connect: {
    port: server.port,
    hostname: "127.0.0.1",
  },
});

client.send("Hello");
```

Because connections are implemented on the operating system level, you can potentially observe performance benefits, too.

### Send many packets at once using `sendMany()`

If you want to send a large volume of packets at once, it can make sense to batch them all together to avoid the overhead
of making a system call for each. This is made possible by the `sendMany()` API:

For an unconnected socket, `sendMany` takes an array as its only argument. Each set of three array elements describes a packet:
The first item is the data to be sent, the second is the target port, and the last is the target address.

```ts server.ts icon="/icons/typescript.svg"
const socket = await Bun.udpSocket({});

// sends 'Hello' to 127.0.0.1:41234, and 'foo' to 1.1.1.1:53 in a single operation
socket.sendMany(["Hello", 41234, "127.0.0.1", "foo", 53, "1.1.1.1"]);
```

With a connected socket, `sendMany` takes an array, where each element represents the data to be sent to the peer.

```ts server.ts icon="/icons/typescript.svg"
const socket = await Bun.udpSocket({
  connect: {
    port: 41234,
    hostname: "localhost",
  },
});

socket.sendMany(["foo", "bar", "baz"]);
```

`sendMany` returns the number of packets that were successfully sent. As with `send`, `sendMany` only takes valid IP addresses
as destinations, as it does not perform DNS resolution.

### Handle backpressure

It may happen that a packet that you're sending does not fit into the operating system's packet buffer. You can detect that this
has happened when:

- `send` returns `false`
- `sendMany` returns a number smaller than the number of packets you specified. In this case, the `drain` socket handler will be called once the socket becomes writable again:

```ts
const socket = await Bun.udpSocket({
  socket: {
    drain(socket) {
      // continue sending data
    },
  },
});
```

### Socket options

UDP sockets support setting various socket options:

```ts
const socket = await Bun.udpSocket({});

// Enable broadcasting to send packets to a broadcast address
socket.setBroadcast(true);

// Set the IP TTL (time to live) for outgoing packets
socket.setTTL(64);
```

### Multicast

Bun supports multicast operations for UDP sockets. Use `addMembership` and `dropMembership` to join and leave multicast groups:

```ts
const socket = await Bun.udpSocket({});

// Join a multicast group
socket.addMembership("224.0.0.1");

// Join with a specific interface
socket.addMembership("224.0.0.1", "192.168.1.100");

// Leave a multicast group
socket.dropMembership("224.0.0.1");
```

Additional multicast options:

```ts
// Set TTL for multicast packets (number of network hops)
socket.setMulticastTTL(2);

// Control whether multicast packets loop back to the local socket
socket.setMulticastLoopback(true);

// Specify which interface to use for outgoing multicast packets
socket.setMulticastInterface("192.168.1.100");
```

For source-specific multicast (SSM), use `addSourceSpecificMembership` and `dropSourceSpecificMembership`:

```ts
socket.addSourceSpecificMembership("10.0.0.1", "232.0.0.1");
socket.dropSourceSpecificMembership("10.0.0.1", "232.0.0.1");
```
