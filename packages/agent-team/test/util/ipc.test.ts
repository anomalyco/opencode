import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs"
import os from "os"
import { IPCServer, IPCClient } from "../../src/util/ipc.js"

function sock(id: string) {
  return path.join(os.tmpdir(), `ipc-test-${id}-${Date.now()}.sock`)
}

describe("IPCServer + IPCClient", () => {
  test("client connects and server tracks", async () => {
    const sp = sock("connect")
    const server = new IPCServer(sp)
    await server.listen()
    const client = new IPCClient(sp)
    await client.connect()
    await Bun.sleep(10)
    expect(server.connectedClients.length).toBe(1)
    client.close()
    server.close()
  })

  test("client sends message → server receives", async () => {
    const sp = sock("send")
    const server = new IPCServer(sp)
    await server.listen()
    const received = new Promise<any>((resolve) => server.once("message", (_id: string, msg: any) => resolve(msg)))
    const client = new IPCClient(sp)
    await client.connect()
    await Bun.sleep(10)
    client.send({ hello: "world" })
    const msg = await received
    expect(msg.hello).toBe("world")
    client.close()
    server.close()
  })

  test("server sends message → client receives", async () => {
    const sp = sock("recv")
    const server = new IPCServer(sp)
    await server.listen()
    const client = new IPCClient(sp)
    await client.connect()
    await Bun.sleep(10)
    const clientId = server.connectedClients[0]
    const received = new Promise<any>((resolve) => client.onMessage((msg) => resolve(msg)))
    server.send(clientId, { from: "server" })
    const msg = await received
    expect(msg.from).toBe("server")
    client.close()
    server.close()
  })

  test("server close removes socket file", async () => {
    const sp = sock("cleanup")
    const s = new IPCServer(sp)
    await s.listen()
    expect(fs.existsSync(sp)).toBe(true)
    s.close()
    expect(fs.existsSync(sp)).toBe(false)
  })
})
