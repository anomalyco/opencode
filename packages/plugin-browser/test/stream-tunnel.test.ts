import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { createServer as createHttpServer, request as httpRequest } from "node:http"
import { createServer as createNetServer, type Socket } from "node:net"
import { connect as netConnect } from "node:net"
import type { Duplex } from "node:stream"
import { Effect, Schema } from "effect"
import { EgressPolicy } from "../src/egress-policy.js"
import { Browser } from "../src/rpc.js"
import { BrowserProxy } from "../src/proxy.js"
import { StreamMux } from "../src/stream-mux.js"
import { StreamWire } from "../src/stream-wire.js"
import { BrowserTunnel } from "../src/tunnel.js"
import { BrowserTunnelHost } from "../src/tunnel-host.js"

/**
 * In-memory paired BinarySockets with configurable send latency / backpressure simulation
 * for deterministic multiplexer tests without network flakes.
 */
function createSocketPair(options: { readonly delayMs?: number; readonly simulateBuffered?: boolean } = {}) {
  type Listener<T> = (value: T) => void
  type Side = {
    readyState: number
    bufferedAmount: number
    readonly messageListeners: Set<Listener<Uint8Array | string>>
    readonly closeListeners: Set<(code: number, reason: string) => void>
    readonly errorListeners: Set<Listener<Error>>
    readonly pongListeners: Set<() => void>
    peer: Side
    deliver(data: Uint8Array | string): void
    finishClose(code: number, reason: string): void
    toSocket(): BrowserTunnelHost.BinarySocket
  }
  const makeSide = (): Side => {
    const messageListeners = new Set<Listener<Uint8Array | string>>()
    const closeListeners = new Set<(code: number, reason: string) => void>()
    const errorListeners = new Set<Listener<Error>>()
    const pongListeners = new Set<() => void>()
    const side: Side = {
      readyState: 1,
      bufferedAmount: 0,
      messageListeners,
      closeListeners,
      errorListeners,
      pongListeners,
      peer: undefined as unknown as Side,
      deliver(data: Uint8Array | string) {
        if (this.readyState !== 1) return
        for (const listener of Array.from(this.messageListeners)) listener(data)
      },
      finishClose(code: number, reason: string) {
        if (this.readyState === 3) return
        this.readyState = 3
        for (const listener of Array.from(this.closeListeners)) listener(code, reason)
      },
      toSocket(): BrowserTunnelHost.BinarySocket {
        const self = side
        return {
          get readyState() {
            return self.readyState
          },
          get bufferedAmount() {
            return self.bufferedAmount
          },
          send(data, onWritten) {
            if (self.readyState !== 1) {
              onWritten?.(new Error("socket closed"))
              return
            }
            const copy = new Uint8Array(data)
            if (options.simulateBuffered) self.bufferedAmount += copy.byteLength
            const dispatch = () => {
              if (options.simulateBuffered) self.bufferedAmount = Math.max(0, self.bufferedAmount - copy.byteLength)
              onWritten?.()
              if (self.peer.readyState === 1) self.peer.deliver(copy)
            }
            if (options.delayMs && options.delayMs > 0) {
              setTimeout(dispatch, options.delayMs)
            } else {
              queueMicrotask(dispatch)
            }
          },
          ping() {
            if (self.readyState === 1 && self.peer.readyState === 1) {
              queueMicrotask(() => {
                for (const listener of Array.from(self.pongListeners)) listener()
              })
            }
          },
          close(code = 1000, reason = "") {
            self.finishClose(code, reason)
            queueMicrotask(() => self.peer.finishClose(code, reason))
          },
          terminate() {
            self.finishClose(1006, "terminated")
            queueMicrotask(() => self.peer.finishClose(1006, "terminated"))
          },
          onMessage(listener) {
            self.messageListeners.add(listener)
            return () => void self.messageListeners.delete(listener)
          },
          onClose(listener) {
            self.closeListeners.add(listener)
            return () => void self.closeListeners.delete(listener)
          },
          onError(listener) {
            self.errorListeners.add(listener)
            return () => void self.errorListeners.delete(listener)
          },
          onPong(listener) {
            self.pongListeners.add(listener)
            return () => void self.pongListeners.delete(listener)
          },
        }
      },
    }
    return side
  }
  const a = makeSide()
  const b = makeSide()
  a.peer = b
  b.peer = a
  return {
    clientRaw: a,
    serverRaw: b,
    client: a.toSocket(),
    server: b.toSocket(),
  }
}

describe("StreamWire codec and adversarial validation", () => {
  test("round-trips every frame type cleanly", () => {
    const frames: StreamWire.Frame[] = [
      { type: StreamWire.FrameType.OPEN, streamID: 1, host: "localhost", port: 5173, initialWindow: 65_536 },
      { type: StreamWire.FrameType.OPENED, streamID: 1, initialWindow: 131_072 },
      { type: StreamWire.FrameType.DATA, streamID: 1, data: new Uint8Array([1, 2, 3, 255]) },
      { type: StreamWire.FrameType.WINDOW_UPDATE, streamID: 1, delta: 32_768 },
      { type: StreamWire.FrameType.FIN, streamID: 1 },
      { type: StreamWire.FrameType.RESET, streamID: 1, code: StreamWire.ResetCode.POLICY_DENIED, reason: "blocked" },
      { type: StreamWire.FrameType.PING, token: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) },
      { type: StreamWire.FrameType.PONG, token: new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]) },
      { type: StreamWire.FrameType.GOAWAY, code: StreamWire.ResetCode.ATTACHMENT_CLOSED, reason: "replaced" },
    ]
    for (const frame of frames) {
      expect(StreamWire.decodeFrame(StreamWire.encodeFrame(frame))).toEqual(frame)
    }
  })

  test("rejects malformed, truncated, oversized, and protocol-violating frames", () => {
    // Truncated header
    expect(() => StreamWire.decodeFrame(new Uint8Array(9))).toThrow(StreamWire.WireProtocolError)
    // Unsupported version
    const badVersion = StreamWire.encodeFrame({ type: StreamWire.FrameType.FIN, streamID: 1 })
    badVersion[0] = 2
    expect(() => StreamWire.decodeFrame(badVersion)).toThrow(StreamWire.WireProtocolError)
    // Trailing garbage
    const withGarbage = new Uint8Array(StreamWire.encodeFrame({ type: StreamWire.FrameType.FIN, streamID: 1 }).length + 1)
    withGarbage.set(StreamWire.encodeFrame({ type: StreamWire.FrameType.FIN, streamID: 1 }))
    expect(() => StreamWire.decodeFrame(withGarbage)).toThrow(StreamWire.WireProtocolError)
    // Zero streamID on DATA
    const zeroStream = StreamWire.encodeFrame({
      type: StreamWire.FrameType.DATA,
      streamID: 1,
      data: new Uint8Array([1]),
    })
    zeroStream[5] = 0
    expect(() => StreamWire.decodeFrame(zeroStream)).toThrow(StreamWire.WireProtocolError)
    // Non-zero streamID on PING
    const badPing = StreamWire.encodeFrame({
      type: StreamWire.FrameType.PING,
      token: new Uint8Array(8),
    })
    badPing[5] = 1
    expect(() => StreamWire.decodeFrame(badPing)).toThrow(StreamWire.WireProtocolError)
    // Zero-delta WINDOW_UPDATE
    const zeroWindow = StreamWire.encodeFrame({ type: StreamWire.FrameType.WINDOW_UPDATE, streamID: 1, delta: 1 })
    zeroWindow[13] = 0
    expect(() => StreamWire.decodeFrame(zeroWindow)).toThrow(StreamWire.WireProtocolError)
    // Oversized frame length header (> MAX_FRAME_PAYLOAD_BYTES)
    const oversized = new Uint8Array(10)
    const view = new DataView(oversized.buffer)
    view.setUint8(0, 1)
    view.setUint8(1, StreamWire.FrameType.DATA)
    view.setUint32(2, 1, false)
    view.setUint32(6, StreamWire.MAX_FRAME_PAYLOAD_BYTES + 1, false)
    expect(() => StreamWire.decodeFrame(oversized)).toThrow(StreamWire.WireProtocolError)
    // Invalid host characters in OPEN
    expect(() =>
      StreamWire.encodeFrame({
        type: StreamWire.FrameType.OPEN,
        streamID: 1,
        host: "evil.com/path",
        port: 80,
        initialWindow: 4096,
      }),
    ).toThrow(StreamWire.WireProtocolError)
  })
})

describe("EgressPolicy protection and dev loopback support", () => {
  test("blocks cloud metadata, link-local, unspecified, multicast, and IPv4-mapped/NAT64/6to4 bypasses", () => {
    const policy = EgressPolicy.makePolicy({ allowPrivateLan: true })
    const blocked = [
      ["169.254.169.254", 80, "169.254.169.254"],
      ["169.254.170.2", 80, "169.254.170.2"],
      ["100.100.100.200", 80, "100.100.100.200"],
      ["metadata.google.internal", 80, "169.254.169.254"],
      ["metadata.goog", 80, "1.1.1.1"],
      ["fd00:ec2::254", 80, "fd00:ec2::254"],
      ["fe80::1", 80, "fe80::1"],
      ["::ffff:169.254.169.254", 80, "::ffff:169.254.169.254"],
      ["64:ff9b::169.254.169.254", 80, "64:ff9b::169.254.169.254"],
      ["2002:a9fe:a9fe::1", 80, "2002:a9fe:a9fe::1"],
      ["0.0.0.0", 80, "0.0.0.0"],
      ["::", 80, "::"],
      ["224.0.0.1", 80, "224.0.0.1"],
      ["255.255.255.255", 80, "255.255.255.255"],
    ] as const
    for (const [host, port, ip] of blocked) {
      expect(policy.evaluateAddress(host, port, ip).allowed).toBe(false)
    }
    // Non-standard decimal/hex IPv4 literals resolve and classify as metadata too
    expect(EgressPolicy.parseIpLiteral("2852039166")).toEqual({ address: "169.254.169.254", family: 4 })
    expect(EgressPolicy.parseIpLiteral("0xa9fea9fe")).toEqual({ address: "169.254.169.254", family: 4 })
  })

  test("allows dev loopback preview/HMR ports while blocking DNS rebinding and server management ports", async () => {
    const serverPorts = new Set([4096])
    const policy = EgressPolicy.makePolicy({
      reservedLocalPorts: () => serverPorts,
      resolve: async (host) => {
        if (host === "localhost" || host === "app.localhost") return [{ address: "127.0.0.1", family: 4 }]
        if (host === "rebind.attacker.example") return [{ address: "127.0.0.1", family: 4 }]
        if (host === "dual.attacker.example")
          return [
            { address: "93.184.216.34", family: 4 },
            { address: "127.0.0.1", family: 4 },
          ]
        if (host === "example.com") return [{ address: "93.184.216.34", family: 4 }]
        if (host === "intranet.local") return [{ address: "192.168.1.50", family: 4 }]
        return []
      },
    })

    // Dev loopback & HMR ports work out of the box
    expect(await policy.resolveTarget({ host: "localhost", port: 5173 })).toEqual({ address: "127.0.0.1", family: 4 })
    expect(await policy.resolveTarget({ host: "127.0.0.1", port: 5174 })).toEqual({ address: "127.0.0.1", family: 4 })
    expect(await policy.resolveTarget({ host: "app.localhost", port: 24678 })).toEqual({ address: "127.0.0.1", family: 4 })
    expect(await policy.resolveTarget({ host: "::1", port: 5173 })).toEqual({ address: "::1", family: 6 })
    // Public web works
    expect(await policy.resolveTarget({ host: "example.com", port: 443 })).toEqual({ address: "93.184.216.34", family: 4 })

    // OpenCode's own server port and SSH/Docker/K8s ports on loopback are blocked
    await expect(policy.resolveTarget({ host: "127.0.0.1", port: 4096 })).rejects.toThrow(EgressPolicy.EgressDeniedError)
    await expect(policy.resolveTarget({ host: "localhost", port: 22 })).rejects.toThrow(EgressPolicy.EgressDeniedError)
    await expect(policy.resolveTarget({ host: "localhost", port: 2375 })).rejects.toThrow(EgressPolicy.EgressDeniedError)

    // External hostnames resolving to loopback (including dual A records) are blocked
    await expect(policy.resolveTarget({ host: "rebind.attacker.example", port: 5173 })).rejects.toThrow(
      EgressPolicy.EgressDeniedError,
    )
    await expect(policy.resolveTarget({ host: "dual.attacker.example", port: 5173 })).rejects.toThrow(
      EgressPolicy.EgressDeniedError,
    )

    // Private LAN is blocked by default, but allowed after an explicit trusted attachment grant
    await expect(policy.resolveTarget({ host: "intranet.local", port: 5173 })).rejects.toThrow(
      EgressPolicy.EgressDeniedError,
    )
    policy.grant("intranet.local", 5173, [24678])
    expect(await policy.resolveTarget({ host: "intranet.local", port: 5173 })).toEqual({
      address: "192.168.1.50",
      family: 4,
    })
    expect(await policy.resolveTarget({ host: "intranet.local", port: 24678 })).toEqual({
      address: "192.168.1.50",
      family: 4,
    })
    // Ungranted port on the same private host stays blocked
    await expect(policy.resolveTarget({ host: "intranet.local", port: 9999 })).rejects.toThrow(
      EgressPolicy.EgressDeniedError,
    )
    // Cannot grant metadata or protected management ports
    expect(() => policy.grant("169.254.169.254", 80)).toThrow(EgressPolicy.EgressDeniedError)
    expect(() => policy.grant("127.0.0.1", 4096)).toThrow(EgressPolicy.EgressDeniedError)
    expect(() => policy.grant("192.168.1.50", 22)).toThrow(EgressPolicy.EgressDeniedError)
  })

  test("legacy RPC BrowserTunnel enforces the exact same egress policy", async () => {
    const policy = EgressPolicy.makePolicy({ reservedLocalPorts: () => new Set([4096]) })
    const tunnel = BrowserTunnel.make(policy)
    try {
      await expect(Effect.runPromise(tunnel.open({ host: "169.254.169.254", port: 80 }))).rejects.toThrow("blocked")
      await expect(Effect.runPromise(tunnel.open({ host: "127.0.0.1", port: 4096 }))).rejects.toThrow("blocked")
    } finally {
      tunnel.dispose()
    }
  })
})

describe("StreamMux flow control, fairness, half-close, and RESET cancellation", () => {
  test("transfers 1 MiB over a bounded 128 KiB window with batched credits and clean half-close", async () => {
    const payload = Buffer.alloc(1024 * 1024)
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 31) & 0xff
    const expectedHash = createHash("sha256").update(payload).digest("hex")

    const echo = createNetServer((socket) => socket.pipe(socket))
    await once(echo.listen(0, "127.0.0.1"), "listening")
    const addr = echo.address()
    if (!addr || typeof addr === "string") throw new Error("No TCP address")

    const pair = createSocketPair({ simulateBuffered: true })
    let windowUpdates = 0
    const offSpy = pair.server.onMessage((raw) => {
      if (raw instanceof Uint8Array && raw.byteLength >= 10 && raw[1] === StreamWire.FrameType.WINDOW_UPDATE) {
        windowUpdates += 1
      }
    })
    const serverMux = StreamMux.createServerMux(pair.server, {
      policy: EgressPolicy.makePolicy(),
      streamWindowBytes: 128 * 1024,
      creditBatchBytes: 32 * 1024,
      heartbeatIntervalMs: 0,
    })
    const clientMux = StreamMux.createClientMux(pair.client, {
      streamWindowBytes: 128 * 1024,
      creditBatchBytes: 32 * 1024,
      heartbeatIntervalMs: 0,
    })

    try {
      const stream = await clientMux.openStream({ host: "127.0.0.1", port: addr.port })
      const received = new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        stream.on("data", (chunk: Buffer) => chunks.push(chunk))
        stream.once("end", () => resolve(Buffer.concat(chunks)))
        stream.once("error", reject)
      })
      // Write 1 MiB then half-close (FIN)
      stream.end(payload)
      const got = await received
      expect(got.byteLength).toBe(payload.byteLength)
      expect(createHash("sha256").update(got).digest("hex")).toBe(expectedHash)
      // Credits returned in batches (not per 16 KiB frame)
      expect(windowUpdates).toBeGreaterThanOrEqual(8)
      expect(windowUpdates).toBeLessThan(64)
      expect(clientMux.activeStreams()).toBe(0)
    } finally {
      offSpy()
      clientMux.close()
      serverMux.close()
      await new Promise<void>((resolve) => echo.close(() => resolve()))
    }
  }, 15_000)

  test("fair bounded writer lets small interactive echo finish ahead of a concurrent bulk download", async () => {
    const bulkSize = 512 * 1024
    const bulkData = Buffer.alloc(bulkSize, 0xab)

    const bulkServer = createNetServer((socket) => {
      socket.end(bulkData)
    })
    const echoServer = createNetServer((socket) => {
      socket.on("data", (chunk) => socket.end(chunk))
    })
    await Promise.all([
      once(bulkServer.listen(0, "127.0.0.1"), "listening"),
      once(echoServer.listen(0, "127.0.0.1"), "listening"),
    ])
    const bulkAddr = bulkServer.address()
    const echoAddr = echoServer.address()
    if (!bulkAddr || typeof bulkAddr === "string" || !echoAddr || typeof echoAddr === "string") {
      throw new Error("No TCP address")
    }

    // Add 2 ms send latency and tight 32 KiB WS bufferedAmount cap to expose any unfair queueing.
    const pair = createSocketPair({ delayMs: 2, simulateBuffered: true })
    const serverMux = StreamMux.createServerMux(pair.server, {
      policy: EgressPolicy.makePolicy(),
      streamWindowBytes: 128 * 1024,
      creditBatchBytes: 32 * 1024,
      maxWsBufferedBytes: 32 * 1024,
      heartbeatIntervalMs: 0,
    })
    const clientMux = StreamMux.createClientMux(pair.client, {
      streamWindowBytes: 128 * 1024,
      creditBatchBytes: 32 * 1024,
      maxWsBufferedBytes: 32 * 1024,
      heartbeatIntervalMs: 0,
    })

    try {
      const bulkStream = await clientMux.openStream({ host: "127.0.0.1", port: bulkAddr.port })
      let bulkReceived = 0
      let bulkBytesWhenEchoDone = -1
      let echoStarted = false
      const echoDone = Promise.withResolvers<string>()
      const bulkDone = Promise.withResolvers<void>()

      bulkStream.on("data", (chunk: Buffer) => {
        bulkReceived += chunk.byteLength
        if (!echoStarted) {
          echoStarted = true
          void clientMux.openStream({ host: "127.0.0.1", port: echoAddr.port }).then((echoStream) => {
            const parts: Buffer[] = []
            echoStream.on("data", (d: Buffer) => parts.push(d))
            echoStream.once("end", () => {
              bulkBytesWhenEchoDone = bulkReceived
              echoDone.resolve(Buffer.concat(parts).toString())
            })
            echoStream.end("hmr-ping")
          })
        }
      })
      bulkStream.once("end", () => bulkDone.resolve())

      expect(await echoDone.promise).toBe("hmr-ping")
      await bulkDone.promise
      expect(bulkReceived).toBe(bulkSize)
      // Interactive echo finished well before the bulk download completed!
      expect(bulkBytesWhenEchoDone).toBeGreaterThan(0)
      expect(bulkBytesWhenEchoDone).toBeLessThan(bulkSize)
    } finally {
      clientMux.close()
      serverMux.close()
      await Promise.all([
        new Promise<void>((resolve) => bulkServer.close(() => resolve())),
        new Promise<void>((resolve) => echoServer.close(() => resolve())),
      ])
    }
  }, 15_000)

  test("destroying a client stream mid-transfer sends RESET and destroys the server target socket", async () => {
    const accepted = Promise.withResolvers<Socket>()
    const peerClosed = Promise.withResolvers<void>()
    const server = createNetServer((socket) => {
      accepted.resolve(socket)
      socket.once("close", () => peerClosed.resolve())
      // Flood continuously until peer closes (like an aborted video range request on seek)
      const chunk = Buffer.alloc(16 * 1024, 0x42)
      const timer = setInterval(() => {
        if (socket.destroyed) return
        socket.write(chunk)
      }, 5)
      socket.once("close", () => clearInterval(timer))
    })
    await once(server.listen(0, "127.0.0.1"), "listening")
    const addr = server.address()
    if (!addr || typeof addr === "string") throw new Error("No TCP address")

    const pair = createSocketPair()
    const serverMux = StreamMux.createServerMux(pair.server, {
      policy: EgressPolicy.makePolicy(),
      streamWindowBytes: 64 * 1024,
      heartbeatIntervalMs: 0,
    })
    const clientMux = StreamMux.createClientMux(pair.client, {
      streamWindowBytes: 64 * 1024,
      heartbeatIntervalMs: 0,
    })

    try {
      const stream = await clientMux.openStream({ host: "127.0.0.1", port: addr.port })
      await accepted.promise
      await new Promise<void>((resolve) => stream.once("data", () => resolve()))
      // Abort mid-stream (video seek / tab close)
      stream.destroy()
      await peerClosed.promise
      // Allow server cleanup microtask to finish
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
      expect(serverMux.activeStreams()).toBe(0)
      expect(serverMux.bufferedBytes()).toBe(0)
    } finally {
      clientMux.close()
      serverMux.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, 15_000)

  test("a stalled slow reader on stream 1 does not block stream 2 and respects window cap", async () => {
    const slowServer = createNetServer((socket) => {
      socket.write(Buffer.alloc(256 * 1024, 0x11))
    })
    const fastServer = createNetServer((socket) => {
      socket.end("fast-ok")
    })
    await Promise.all([
      once(slowServer.listen(0, "127.0.0.1"), "listening"),
      once(fastServer.listen(0, "127.0.0.1"), "listening"),
    ])
    const slowAddr = slowServer.address()
    const fastAddr = fastServer.address()
    if (!slowAddr || typeof slowAddr === "string" || !fastAddr || typeof fastAddr === "string") {
      throw new Error("No TCP address")
    }

    const pair = createSocketPair()
    const serverMux = StreamMux.createServerMux(pair.server, {
      policy: EgressPolicy.makePolicy(),
      streamWindowBytes: 32 * 1024,
      creditBatchBytes: 8 * 1024,
      heartbeatIntervalMs: 0,
    })
    const clientMux = StreamMux.createClientMux(pair.client, {
      streamWindowBytes: 32 * 1024,
      creditBatchBytes: 8 * 1024,
      heartbeatIntervalMs: 0,
    })

    try {
      // Open stream 1 and intentionally NEVER attach a data listener (stalled reader)
      const slow = await clientMux.openStream({ host: "127.0.0.1", port: slowAddr.port })
      await new Promise<void>((resolve) => setTimeout(resolve, 30))
      // Client buffered bytes stay strictly bounded by the 32 KiB window
      expect(clientMux.bufferedBytes()).toBeLessThanOrEqual(32 * 1024)

      // Stream 2 still opens and finishes immediately without blocking on stream 1!
      const fast = await clientMux.openStream({ host: "127.0.0.1", port: fastAddr.port })
      const fastData = await new Promise<string>((resolve) => {
        const parts: Buffer[] = []
        fast.on("data", (d: Buffer) => parts.push(d))
        fast.once("end", () => resolve(Buffer.concat(parts).toString()))
      })
      expect(fastData).toBe("fast-ok")
      slow.destroy()
    } finally {
      clientMux.close()
      serverMux.close()
      await Promise.all([
        new Promise<void>((resolve) => slowServer.close(() => resolve())),
        new Promise<void>((resolve) => fastServer.close(() => resolve())),
      ])
    }
  }, 15_000)

  test("rejects text WebSocket frames as a protocol error and closes cleanly", async () => {
    const pair = createSocketPair()
    const serverMux = StreamMux.createServerMux(pair.server, {
      policy: EgressPolicy.makePolicy(),
      heartbeatIntervalMs: 0,
    })
    pair.serverRaw.deliver("not-binary-frame")
    const closed = await serverMux.closed
    expect(closed.code).toBe(1002)
  })
})

describe("BrowserProxy safe per-origin HTTP/1.1 connection pooling", () => {
  test("pools 8 plain HTTP requests to one origin over a single upstream tunnel open", async () => {
    let targetConnections = 0
    const target = createHttpServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain", "content-length": String((req.url ?? "").length) })
      res.end(req.url ?? "")
    })
    target.on("connection", () => {
      targetConnections += 1
    })
    await once(target.listen(0, "127.0.0.1"), "listening")
    const addr = target.address()
    if (!addr || typeof addr === "string") throw new Error("No HTTP address")

    const pair = createSocketPair()
    const serverMux = StreamMux.createServerMux(pair.server, {
      policy: EgressPolicy.makePolicy(),
      heartbeatIntervalMs: 0,
    })
    const clientMux = StreamMux.createClientMux(pair.client, { heartbeatIntervalMs: 0 })

    let upstreamOpens = 0
    const proxy = await BrowserProxy.make({
      openStream(destination, signal) {
        upstreamOpens += 1
        return clientMux.openStream(destination, signal)
      },
    })
    const auth = `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}`

    const fetchViaProxy = (asset: string) =>
      new Promise<{ status?: number; body: string }>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: proxy.host,
            port: proxy.port,
            method: "GET",
            path: `http://127.0.0.1:${addr.port}${asset}`,
            headers: { "Proxy-Authorization": auth },
          },
          (res) => {
            const chunks: Buffer[] = []
            res.on("data", (chunk: Buffer) => chunks.push(chunk))
            res.once("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
          },
        )
        req.once("error", reject)
        req.end()
      })

    try {
      for (let i = 0; i < 8; i++) {
        const result = await fetchViaProxy(`/asset-${i}.js`)
        expect(result.status).toBe(200)
        expect(result.body).toBe(`/asset-${i}.js`)
      }
      // 8 sequential HTTP assets to one origin reuse 1 pooled upstream stream (vs 8 before)!
      expect(upstreamOpens).toBe(1)
      expect(targetConnections).toBe(1)
    } finally {
      await proxy.close()
      clientMux.close()
      serverMux.close()
      await new Promise<void>((resolve) => target.close(() => resolve()))
    }
  }, 15_000)

  test("TunnelTicket schema accepts only the fixed experimental browser tunnel path", () => {
    expect(
      Schema.decodeUnknownSync(Browser.TunnelTicket)({
        ticket: "tkt_1",
        expiresIn: 30,
        protocol: 1,
        path: BrowserTunnelHost.BROWSER_TUNNEL_PATH,
      }).path,
    ).toBe("/api/experimental/browser/tunnel")
    for (const bad of ["https://evil.example/api/experimental/browser/tunnel", "//evil.example/x", "/api/other"]) {
      expect(() =>
        Schema.decodeUnknownSync(Browser.TunnelTicket)({
          ticket: "tkt_1",
          expiresIn: 30,
          protocol: 1,
          path: bad,
        }),
      ).toThrow()
    }
  })

  test("normal detach tears down idle pooled HTTP sockets and active upgraded WebSocket without uncaught errors", async () => {
    const target = createHttpServer((req, res) => {
      if (req.url === "/big") {
        const body = Buffer.alloc(512 * 1024, 0x44)
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(body.length) })
        res.end(body)
        return
      }
      res.writeHead(200, { "content-length": "2" })
      res.end("ok")
    })
    const upgradedTargetSockets = new Set<Duplex>()
    target.on("upgrade", (_req, socket) => {
      upgradedTargetSockets.add(socket)
      socket.once("close", () => upgradedTargetSockets.delete(socket))
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n",
      )
      socket.on("error", () => socket.destroy())
    })
    await once(target.listen(0, "127.0.0.1"), "listening")
    const addr = target.address()
    if (!addr || typeof addr === "string") throw new Error("No HTTP address")

    const pair = createSocketPair({ simulateBuffered: true })
    const serverMux = StreamMux.createServerMux(pair.server, {
      policy: EgressPolicy.makePolicy(),
      heartbeatIntervalMs: 0,
    })
    const clientMux = StreamMux.createClientMux(pair.client, { heartbeatIntervalMs: 0 })
    const resetListeners = new Set<() => void>()
    const proxy = await BrowserProxy.make({
      openStream: (destination, signal) => clientMux.openStream(destination, signal),
      onReset(listener) {
        resetListeners.add(listener)
        return () => void resetListeners.delete(listener)
      },
    })
    void clientMux.closed.then(() => resetListeners.forEach((fn) => fn()))

    const auth = `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}`
    const uncaught: Error[] = []
    const onUncaught = (error: Error) => {
      uncaught.push(error)
    }
    process.on("uncaughtException", onUncaught)

    try {
      // 1. Run a 512 KiB HTTP transfer leaving an idle pooled socket in BrowserProxy's http.Agent
      const bigBytes = await new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: proxy.host,
            port: proxy.port,
            method: "GET",
            path: `http://127.0.0.1:${addr.port}/big`,
            headers: { "Proxy-Authorization": auth },
          },
          (res) => {
            let total = 0
            res.on("data", (chunk: Buffer) => {
              total += chunk.byteLength
            })
            res.once("end", () => resolve(total))
          },
        )
        req.once("error", reject)
        req.end()
      })
      expect(bigBytes).toBe(512 * 1024)

      // 2. Open a concurrent upgraded WebSocket tunnel and keep it open across detach
      const upgraded = await new Promise<Socket>((resolve, reject) => {
        const sock = netConnect(proxy.port, proxy.host, () => {
          sock.write(
            `GET http://127.0.0.1:${addr.port}/ws HTTP/1.1\r\n` +
              `Host: 127.0.0.1:${addr.port}\r\n` +
              `Proxy-Authorization: ${auth}\r\n` +
              `Connection: Upgrade\r\n` +
              `Upgrade: websocket\r\n` +
              `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
              `Sec-WebSocket-Version: 13\r\n\r\n`,
          )
        })
        let head = ""
        let resolved = false
        sock.on("data", (chunk: Buffer) => {
          if (resolved) return
          head += chunk.toString("latin1")
          if (head.includes("\r\n\r\n")) {
            resolved = true
            resolve(sock)
          }
        })
        sock.once("error", reject)
      })
      const upgradedClosed = new Promise<void>((resolve) => upgraded.once("close", () => resolve()))

      // 3. Reproduce exact BrowserNetwork release sequence: close mux ("desktop detached"), then close proxy.
      clientMux.close(1000, "desktop detached")
      await proxy.close()
      await upgradedClosed
      await new Promise<void>((resolve) => setTimeout(resolve, 30))

      expect(uncaught).toEqual([])
      expect(serverMux.activeStreams()).toBe(0)
    } finally {
      process.off("uncaughtException", onUncaught)
      clientMux.close()
      serverMux.close()
      upgradedTargetSockets.forEach((socket) => socket.destroy())
      target.closeAllConnections()
      await new Promise<void>((resolve) => target.close(() => resolve()))
    }
  }, 15_000)

  test("abnormal tunnel drop fails active pending HTTP request while keeping idle pooled and upgraded sockets crash-free", async () => {
    const hungStarted = Promise.withResolvers<void>()
    const target = createHttpServer((req, res) => {
      if (req.url === "/stall") {
        hungStarted.resolve()
        return
      }
      res.writeHead(200, { "content-length": "2" })
      res.end("ok")
    })
    const upgradedTargetSockets = new Set<Duplex>()
    target.on("upgrade", (_req, socket) => {
      upgradedTargetSockets.add(socket)
      socket.once("close", () => upgradedTargetSockets.delete(socket))
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n",
      )
      socket.on("error", () => socket.destroy())
    })
    await once(target.listen(0, "127.0.0.1"), "listening")
    const addr = target.address()
    if (!addr || typeof addr === "string") throw new Error("No HTTP address")

    const pair = createSocketPair({ simulateBuffered: true })
    const serverMux = StreamMux.createServerMux(pair.server, {
      policy: EgressPolicy.makePolicy(),
      heartbeatIntervalMs: 0,
    })
    const clientMux = StreamMux.createClientMux(pair.client, { heartbeatIntervalMs: 0 })
    const resetListeners = new Set<() => void>()
    const proxy = await BrowserProxy.make({
      openStream: (destination, signal) => clientMux.openStream(destination, signal),
      onReset(listener) {
        resetListeners.add(listener)
        return () => void resetListeners.delete(listener)
      },
    })
    void clientMux.closed.then(() => resetListeners.forEach((fn) => fn()))
    const auth = `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}`

    const uncaught: Error[] = []
    const onUncaught = (error: Error) => {
      uncaught.push(error)
    }
    process.on("uncaughtException", onUncaught)

    try {
      // 1. Create an idle pooled HTTP socket on origin
      await new Promise<void>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: proxy.host,
            port: proxy.port,
            method: "GET",
            path: `http://127.0.0.1:${addr.port}/warm`,
            headers: { "Proxy-Authorization": auth },
          },
          (res) => {
            res.resume()
            res.once("end", () => resolve())
          },
        )
        req.once("error", reject)
        req.end()
      })

      // 2. Keep an active upgraded WebSocket open
      const upgraded = await new Promise<Socket>((resolve, reject) => {
        const sock = netConnect(proxy.port, proxy.host, () => {
          sock.write(
            `GET http://127.0.0.1:${addr.port}/ws HTTP/1.1\r\n` +
              `Host: 127.0.0.1:${addr.port}\r\n` +
              `Proxy-Authorization: ${auth}\r\n` +
              `Connection: Upgrade\r\n` +
              `Upgrade: websocket\r\n` +
              `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
              `Sec-WebSocket-Version: 13\r\n\r\n`,
          )
        })
        let head = ""
        let resolved = false
        sock.on("data", (chunk: Buffer) => {
          if (resolved) return
          head += chunk.toString("latin1")
          if (head.includes("\r\n\r\n")) {
            resolved = true
            resolve(sock)
          }
        })
        sock.once("error", reject)
      })
      const upgradedClosed = new Promise<void>((resolve) => upgraded.once("close", () => resolve()))

      // 3. Start an active pending HTTP request (in-flight read)
      const pendingStatus = new Promise<number | string>((resolve) => {
        const req = httpRequest(
          {
            hostname: proxy.host,
            port: proxy.port,
            method: "GET",
            path: `http://127.0.0.1:${addr.port}/stall`,
            headers: { "Proxy-Authorization": auth },
          },
          (res) => {
            res.resume()
            resolve(res.statusCode ?? 0)
          },
        )
        req.once("error", (err) => resolve(err.message))
        req.end()
      })
      await hungStarted.promise

      // 4. Abnormally drop the tunnel from the server side while pool + upgraded WS + pending read all exist
      pair.server.terminate()

      const outcome = await pendingStatus
      // Active pending request genuinely failed (502 from proxy or socket error, never silently succeeded)
      expect(outcome === 502 || typeof outcome === "string").toBe(true)
      await upgradedClosed
      await new Promise<void>((resolve) => setTimeout(resolve, 30))
      expect(uncaught).toEqual([])
    } finally {
      process.off("uncaughtException", onUncaught)
      await proxy.close()
      clientMux.close()
      serverMux.close()
      upgradedTargetSockets.forEach((socket) => socket.destroy())
      target.closeAllConnections()
      await new Promise<void>((resolve) => target.close(() => resolve()))
    }
  }, 15_000)
})
