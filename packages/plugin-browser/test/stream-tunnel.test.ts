import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { request as httpRequest } from "node:http"
import { createServer as createNetServer, type Socket } from "node:net"
import { PassThrough } from "node:stream"
import { Schema } from "effect"
import { EgressPolicy } from "../src/egress-policy.js"
import { Browser } from "../src/rpc.js"
import { BrowserProxy } from "../src/proxy.js"
import { StreamMux } from "../src/stream-mux.js"
import { StreamWire } from "../src/stream-wire.js"
import { BrowserTunnelHost } from "../src/tunnel-host.js"

/**
 * In-memory paired BinarySockets with optional deterministic manual flush and backpressure
 * simulation for multiplexer tests without timers or wall-clock races.
 */
function createSocketPair(options: { readonly simulateBuffered?: boolean; readonly gateServerSends?: boolean } = {}) {
  type Listener<T> = (value: T) => void
  type Side = {
    readyState: number
    bufferedAmount: number
    maxBufferedAmount: number
    readonly pendingSends: Array<() => void>
    readonly sentFrames: StreamWire.Frame[]
    readonly messageListeners: Set<Listener<Uint8Array | string>>
    readonly closeListeners: Set<(code: number, reason: string) => void>
    readonly errorListeners: Set<Listener<Error>>
    readonly pongListeners: Set<() => void>
    peer: Side
    deliver(data: Uint8Array | string): void
    finishClose(code: number, reason: string): void
    toSocket(): BrowserTunnelHost.BinarySocket
  }
  const makeSide = (gated: boolean): Side => {
    const messageListeners = new Set<Listener<Uint8Array | string>>()
    const closeListeners = new Set<(code: number, reason: string) => void>()
    const errorListeners = new Set<Listener<Error>>()
    const pongListeners = new Set<() => void>()
    const side: Side = {
      readyState: 1,
      bufferedAmount: 0,
      maxBufferedAmount: 0,
      pendingSends: [],
      sentFrames: [],
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
            if (gated) self.sentFrames.push(StreamWire.decodeFrame(copy))
            if (options.simulateBuffered || gated) {
              self.bufferedAmount += copy.byteLength
              if (self.bufferedAmount > self.maxBufferedAmount) self.maxBufferedAmount = self.bufferedAmount
            }
            const dispatch = () => {
              if (options.simulateBuffered || gated) {
                self.bufferedAmount = Math.max(0, self.bufferedAmount - copy.byteLength)
              }
              onWritten?.()
              if (self.peer.readyState === 1) self.peer.deliver(copy)
            }
            if (gated) {
              self.pendingSends.push(dispatch)
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
  const a = makeSide(false)
  const b = makeSide(options.gateServerSends === true)
  a.peer = b
  b.peer = a
  return {
    clientRaw: a,
    serverRaw: b,
    client: a.toSocket(),
    server: b.toSocket(),
    flushOneServerFrame() {
      const next = b.pendingSends.shift()
      if (!next) return false
      next()
      return true
    },
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
    const withGarbage = new Uint8Array(
      StreamWire.encodeFrame({ type: StreamWire.FrameType.FIN, streamID: 1 }).length + 1,
    )
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

  test("fair bounded writer interleaves small interactive echo ahead of remaining bulk download deterministically", async () => {
    const chunkSize = 16 * 1024
    const bulkChunks = 8
    const bulkSize = chunkSize * bulkChunks
    const maxWsBufferedBytes = 32 * 1024

    // Deterministic in-process target sockets so scheduling order depends solely on StreamMux's
    // bounded writer and credit/priority rules—never wall-clock timers or OS TCP buffers.
    // A plain PassThrough natively echoes written bytes and half-closes on end().
    const bulkTarget = new PassThrough({ highWaterMark: bulkSize })
    const echoTarget = new PassThrough()

    const flushTurns = async () => {
      for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setImmediate(resolve))
    }

    const pair = createSocketPair({ gateServerSends: true })
    const serverMux = StreamMux.createServerMux(pair.server, {
      policy: EgressPolicy.makePolicy(),
      streamWindowBytes: 128 * 1024,
      creditBatchBytes: 32 * 1024,
      frameChunkBytes: chunkSize,
      maxWsBufferedBytes,
      heartbeatIntervalMs: 0,
      connect: async (target) => (target.port === 10001 ? bulkTarget : echoTarget) as unknown as Socket,
    })
    const clientMux = StreamMux.createClientMux(pair.client, {
      streamWindowBytes: 128 * 1024,
      creditBatchBytes: 32 * 1024,
      frameChunkBytes: chunkSize,
      maxWsBufferedBytes,
      heartbeatIntervalMs: 0,
    })

    try {
      // 1. Open bulk stream (stream 1) and deliver its OPENED control frame.
      const bulkOpen = clientMux.openStream({ host: "127.0.0.1", port: 10001 })
      await flushTurns()
      expect(pair.flushOneServerFrame()).toBe(true)
      const bulkStream = await bulkOpen

      let bulkReceived = 0
      let bulkBytesWhenEchoDone = -1
      const bulkDone = Promise.withResolvers<void>()
      bulkStream.on("data", (chunk: Buffer) => {
        bulkReceived += chunk.byteLength
      })
      bulkStream.once("end", () => bulkDone.resolve())

      // 2. Push the entire 128 KiB bulk payload on the server target socket while server sends are gated.
      // FrameWriter must stop at maxWsBufferedBytes (2 × 16 KiB frames) instead of dumping all 128 KiB.
      for (let i = 0; i < bulkChunks; i++) bulkTarget.write(Buffer.alloc(chunkSize, i + 1))
      bulkTarget.end()
      await flushTurns()

      const bulkQueuedBeforeEcho = pair.serverRaw.sentFrames.filter(
        (frame) => frame.type === StreamWire.FrameType.DATA && frame.streamID === 1,
      ).length
      expect(bulkQueuedBeforeEcho).toBe(2)
      expect(pair.serverRaw.bufferedAmount).toBeGreaterThanOrEqual(maxWsBufferedBytes)
      expect(pair.serverRaw.bufferedAmount).toBeLessThan(bulkSize)

      // 3. Open interactive echo stream (stream 2) while bulk is saturated at maxWsBufferedBytes.
      // Priority control (OPENED) still enqueues immediately ahead of the remaining 6 bulk chunks.
      let echoReady = false
      const echoOpen = clientMux.openStream({ host: "127.0.0.1", port: 10002 }).then((stream) => {
        echoReady = true
        return stream
      })
      await flushTurns()
      // Verify OPENED(2) was queued immediately ahead of the remaining bulk DATA frames while bulk was paused.
      const openedEchoIndex = pair.serverRaw.sentFrames.findIndex(
        (frame) => frame.type === StreamWire.FrameType.OPENED && frame.streamID === 2,
      )
      expect(openedEchoIndex).toBe(3) // [OPENED(1), DATA(1), DATA(1), OPENED(2)]
      // Flush only until OPENED(2) is delivered to the client so echoStream opens while bulk still has chunks queued.
      while (!echoReady && pair.flushOneServerFrame()) {
        await flushTurns()
      }
      const echoStream = await echoOpen

      const echoDone = Promise.withResolvers<string>()
      const echoParts: Buffer[] = []
      echoStream.on("data", (chunk: Buffer) => echoParts.push(chunk))
      echoStream.once("end", () => {
        bulkBytesWhenEchoDone = bulkReceived
        echoDone.resolve(Buffer.concat(echoParts).toString())
      })
      echoStream.end("hmr-ping")
      await flushTurns()

      // 4. Deterministically pump one server frame at a time until both echo and bulk complete.
      for (let steps = 0; steps < 200; steps++) {
        const flushed = pair.flushOneServerFrame()
        await flushTurns()
        if (!flushed) {
          if (bulkReceived === bulkSize && bulkBytesWhenEchoDone >= 0) break
          await flushTurns()
          if (!pair.flushOneServerFrame()) break
        }
      }

      expect(await echoDone.promise).toBe("hmr-ping")
      await bulkDone.promise
      expect(bulkReceived).toBe(bulkSize)

      // Verify wire scheduling order and bounded bufferedAmount directly:
      // echo DATA was transmitted ahead of the remaining bulk DATA frames, and ws.bufferedAmount stayed bounded.
      const echoDataIndex = pair.serverRaw.sentFrames.findIndex(
        (frame) => frame.type === StreamWire.FrameType.DATA && frame.streamID === 2,
      )
      const lastBulkDataIndex = pair.serverRaw.sentFrames.findLastIndex(
        (frame) => frame.type === StreamWire.FrameType.DATA && frame.streamID === 1,
      )
      expect(echoDataIndex).toBeGreaterThan(0)
      expect(lastBulkDataIndex).toBeGreaterThan(echoDataIndex)
      expect(bulkBytesWhenEchoDone).toBeGreaterThan(0)
      expect(bulkBytesWhenEchoDone).toBeLessThan(bulkSize)
      expect(pair.serverRaw.maxBufferedAmount).toBeLessThan(bulkSize)
    } finally {
      clientMux.close()
      serverMux.close()
      bulkTarget.destroy()
      echoTarget.destroy()
    }
  })

  test("destroying a client stream mid-transfer sends RESET and destroys the server target socket", async () => {
    const peerClosed = Promise.withResolvers<void>()
    const server = createNetServer((socket) => {
      socket.once("close", () => peerClosed.resolve())
      socket.write(Buffer.alloc(16 * 1024))
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
      await new Promise<void>((resolve) => stream.once("data", () => resolve()))
      // Abort mid-stream (video seek / tab close)
      stream.destroy()
      await peerClosed.promise
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
      const full = Promise.withResolvers<void>()
      let bytes = 0
      const off = pair.client.onMessage((raw) => {
        if (typeof raw === "string") return
        const frame = StreamWire.decodeFrame(raw)
        if (frame.type !== StreamWire.FrameType.DATA) return
        bytes += frame.data.byteLength
        if (bytes >= 32 * 1024) full.resolve()
      })
      const slow = await clientMux.openStream({ host: "127.0.0.1", port: slowAddr.port })
      await full.promise
      off()
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

  test("detach cancels credit-starved write and FIN callbacks; an idle stream closes normally", async () => {
    const pair = createSocketPair()
    const client = StreamMux.createClientMux(pair.client, {
      streamOutboundHighWaterBytes: 4096,
      frameChunkBytes: 4096,
      heartbeatIntervalMs: 0,
    })
    const windowsSpent = Promise.withResolvers<void>()
    let sent = 0
    // The peer admits each stream but never returns credit, so only its initial 4 KiB can leave the client.
    pair.server.onMessage((raw) => {
      if (typeof raw === "string") return
      const frame = StreamWire.decodeFrame(raw)
      if (frame.type === StreamWire.FrameType.OPEN) {
        pair.server.send(
          StreamWire.encodeFrame({ type: StreamWire.FrameType.OPENED, streamID: frame.streamID, initialWindow: 4096 }),
        )
      }
      if (frame.type === StreamWire.FrameType.DATA) {
        sent += frame.data.byteLength
        if (sent >= 8192) windowsSpent.resolve()
      }
    })

    try {
      const target = { host: "localhost", port: 5173 }
      const writing = await client.openStream(target)
      const first = Promise.withResolvers<Error | null | undefined>()
      const queued = Promise.withResolvers<Error | null | undefined>()
      writing.write(Buffer.alloc(16 * 1024), first.resolve)
      writing.write(Buffer.alloc(8 * 1024), queued.resolve)

      const ending = await client.openStream(target)
      const ended = Promise.withResolvers<Error | null | undefined>()
      let finished = false
      ending.once("finish", () => {
        finished = true
      })
      ending.write(Buffer.alloc(6 * 1024))
      ending.end(ended.resolve)

      const idle = await client.openStream(target)
      const idleClosed = once(idle, "close")
      await windowsSpent.promise
      client.close(1000, "desktop detached")
      const errors = await Promise.all([first.promise, queued.promise, ended.promise])
      await idleClosed
      for (const error of errors) expect(error).toBeInstanceOf(Error)
      expect(errors[0]?.message).toContain("desktop detached")
      expect(finished).toBe(false)
      expect(sent).toBe(8192)
    } finally {
      client.close()
    }
  })

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

describe("BrowserProxy attachment lifetime", () => {
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

  test.each(["detach", "disconnect"] as const)("%s closes upgraded and pooled sockets", async (ending) => {
    const stalled = Promise.withResolvers<void>()
    const release = Promise.withResolvers<Response>()
    const target = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req, server) {
        const path = new URL(req.url).pathname
        if (path === "/ws" && server.upgrade(req)) return
        if (path === "/stall") {
          stalled.resolve()
          return release.promise
        }
        return new Response("ok")
      },
      websocket: {
        message(ws, message) {
          ws.send(message)
        },
      },
    })
    const pair = createSocketPair({ simulateBuffered: true })
    const server = StreamMux.createServerMux(pair.server, { policy: EgressPolicy.makePolicy(), heartbeatIntervalMs: 0 })
    const client = StreamMux.createClientMux(pair.client, { heartbeatIntervalMs: 0 })
    let opens = 0
    const listeners = new Set<() => void>()
    const proxy = await BrowserProxy.make({
      openStream(destination, signal) {
        opens++
        return client.openStream(destination, signal)
      },
      onReset(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    void client.closed.then(() => listeners.forEach((reset) => reset()))
    const headers = {
      "proxy-authorization": `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString("base64")}`,
    }
    const options = { hostname: proxy.host, port: proxy.port }
    const get = (path: string, host = "127.0.0.1") =>
      new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest({ ...options, headers, path: `http://${host}:${target.port}${path}` }, (res) => {
          res.resume()
          res.once("end", () => resolve(res.statusCode))
          res.once("error", reject)
        })
        req.once("error", reject).end()
      })

    try {
      expect(await get("/a")).toBe(200)
      expect(await get("/b")).toBe(200)
      expect(opens).toBe(1)

      // Keep the upgraded connection open alongside the idle HTTP pool until the attachment ends.
      const method = ending === "detach" ? "GET" : "CONNECT"
      const upgraded = httpRequest({
        ...options,
        method,
        path: method === "GET" ? new URL("/ws", target.url).href : target.url.host,
        headers:
          method === "CONNECT"
            ? headers
            : {
                ...headers,
                connection: "upgrade",
                upgrade: "websocket",
                "sec-websocket-version": "13",
                "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
              },
      })
      const established = once(upgraded, method === "GET" ? "upgrade" : "connect")
      upgraded.end()
      const [response, socket] = await established
      expect(response.statusCode).toBe(method === "GET" ? 101 : 200)
      const closed = once(socket, "close")

      if (ending === "detach") {
        client.close(1000, "desktop detached")
        await proxy.close()
      } else {
        // Use a second origin so the previously warmed socket is still idle when the tunnel drops.
        const pending = get("/stall", "localhost").catch(() => "closed")
        await stalled.promise
        pair.server.terminate()
        expect([502, "closed"]).toContain((await pending) ?? 0)
      }
      await closed
      await server.closed
      expect(server.activeStreams()).toBe(0)
    } finally {
      release.resolve(new Response(null, { status: 503 }))
      await proxy.close()
      client.close()
      server.close()
      await target.stop(true)
    }
  })
})
