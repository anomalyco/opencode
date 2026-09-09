import { expect, test } from "bun:test"
import { createServer, type Socket } from "node:net"
import { request } from "node:http"
import { once } from "node:events"
import { Effect, Fiber } from "effect"
import { Browser } from "../src/rpc.js"
import { BrowserTunnel } from "../src/tunnel.js"
import { BrowserProxy } from "../src/proxy.js"

test("TCP relay preserves bounded binary chunks and half-close", async () => {
  const server = createServer((socket) => socket.pipe(socket))
  await once(server.listen(0, "127.0.0.1"), "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No TCP address")
  const tunnel = BrowserTunnel.make()
  try {
    const id = await Effect.runPromise(tunnel.open({ host: "127.0.0.1", port: address.port }))
    const received = (async () => {
      const chunks: Uint8Array[] = []
      while (true) {
        const chunk = await Effect.runPromise(tunnel.read(id))
        expect(chunk.data.byteLength).toBeLessThanOrEqual(Browser.TUNNEL_CHUNK_BYTES)
        if (chunk.eof) return Buffer.concat(chunks)
        chunks.push(chunk.data)
      }
    })()
    const bytes = Buffer.alloc(Browser.TUNNEL_CHUNK_BYTES * 3 + 17, 203)
    for (let offset = 0; offset < bytes.length; offset += Browser.TUNNEL_CHUNK_BYTES)
      await Effect.runPromise(tunnel.write(id, bytes.subarray(offset, offset + Browser.TUNNEL_CHUNK_BYTES)))
    await Effect.runPromise(tunnel.write(id, new Uint8Array(), true))
    expect(await received).toEqual(bytes)
    await Effect.runPromise(tunnel.close(id))
  } finally {
    tunnel.dispose()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 15_000)

test("cancelled reads release their listener and attachment disposal closes sockets", async () => {
  const accepted = Promise.withResolvers<Socket>()
  const server = createServer((socket) => accepted.resolve(socket))
  await once(server.listen(0, "127.0.0.1"), "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No TCP address")
  const tunnel = BrowserTunnel.make()
  try {
    const id = await Effect.runPromise(tunnel.open({ host: "127.0.0.1", port: address.port }))
    const peer = await accepted.promise
    const pending = Effect.runFork(tunnel.read(id))
    await Effect.runPromise(Fiber.interrupt(pending))
    peer.end("still readable")
    expect(Buffer.from((await Effect.runPromise(tunnel.read(id))).data).toString()).toBe("still readable")
    expect((await Effect.runPromise(tunnel.read(id))).eof).toBe(true)
    tunnel.dispose()
    await expect(Effect.runPromise(tunnel.open({ host: "127.0.0.1", port: address.port }))).rejects.toThrow("closed")
    await expect(Effect.runPromise(tunnel.write(id, new Uint8Array([1])))).rejects.toThrow("not writable")
  } finally {
    tunnel.dispose()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}, 15_000)

test("HTTP proxy requires local credentials and resolves targets only through its transport", async () => {
  const target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      return Response.json({
        body: await req.text(),
        proxyAuthorization: req.headers.get("proxy-authorization"),
        host: req.headers.get("host"),
      })
    },
  })
  const port = target.port
  if (port === undefined) throw new Error("No HTTP port")
  const tunnel = BrowserTunnel.make()
  const destinations: Browser.TunnelTarget[] = []
  const proxy = await BrowserProxy.make({
    open: (destination, signal) => {
      destinations.push(destination)
      return Effect.runPromise(tunnel.open({ ...destination, host: "127.0.0.1" }), { signal })
    },
    read: (id, signal) => Effect.runPromise(tunnel.read(id), { signal }),
    write: (id, data, end, signal) => Effect.runPromise(tunnel.write(id, data, end), { signal }),
    close: (id) => Effect.runPromise(tunnel.close(id)),
  })
  const send = (authorization?: string) =>
    new Promise<{ status?: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          hostname: proxy.host,
          port: proxy.port,
          method: "POST",
          path: `http://vps-only.invalid:${port}/echo`,
          headers: authorization ? { "Proxy-Authorization": authorization } : {},
        },
        (response) => {
          let body = ""
          response.on("data", (chunk) => {
            body += chunk
          })
          response.on("end", () => resolve({ status: response.statusCode, body }))
        },
      )
      req.on("error", reject)
      req.end("from the browser")
    })
  try {
    expect((await send()).status).toBe(407)
    expect(destinations).toEqual([])
    const response = await send(
      `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}`,
    )
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      body: "from the browser",
      host: `vps-only.invalid:${port}`,
      proxyAuthorization: null,
    })
    expect(destinations).toEqual([{ host: "vps-only.invalid", port }])
  } finally {
    await proxy.close()
    tunnel.dispose()
    target.stop(true)
  }
}, 15_000)
