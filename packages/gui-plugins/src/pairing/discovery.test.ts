import { expect, test } from "bun:test"
import { connect, type Socket } from "node:net"
import { listen } from "./discovery"

test("the listener hands each connection to the exchange", async () => {
  const accepted = Promise.withResolvers<Socket>()
  const listener = await listen((socket) => accepted.resolve(socket))

  const client = connect(listener.port, "127.0.0.1")
  const socket = await accepted.promise

  expect(socket.remoteAddress).toContain("127.0.0.1")
  client.destroy()
  socket.destroy()
  listener.server.close()
})
