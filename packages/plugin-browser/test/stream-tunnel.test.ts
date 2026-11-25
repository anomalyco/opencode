import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { createServer as createHttpServer, request as httpRequest } from "node:http"
import { createServer as createNetServer, type Socket } from "node:net"
import { connect as netConnect } from "node:net"
import { PassThrough, type Duplex } from "node:stream"
import { Effect, Fiber, Schedule, Schema, Stream } from "effect"
import { Session } from "@opencode/schema/session"
import { BrowserConnection } from "../src/connection.js"
import { EgressPolicy } from "../src/egress-policy.js"
import { Browser } from "../src/rpc.js"
import { BrowserProxy } from "../src/proxy.js"
import { StreamMux } from "../src/stream-mux.js"
import { StreamWire } from "../src/stream-wire.js"
import { BrowserTunnel } from "../src/tunnel.js"
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
    expect(await policy.resolveTarget({ host: "localhost", port: 5173 })).toEqual([{ address: "127.0.0.1", family: 4 }])
    expect(await policy.resolveTarget({ host: "127.0.0.1", port: 5174 })).toEqual([{ address: "127.0.0.1", family: 4 }])
    expect(await policy.resolveTarget({ host: "app.localhost", port: 24678 })).toEqual([{ address: "127.0.0.1", family: 4 }])
    expect(await policy.resolveTarget({ host: "::1", port: 5173 })).toEqual([{ address: "::1", family: 6 }])
    // Public web works
    expect(await policy.resolveTarget({ host: "example.com", port: 443 })).toEqual([{ address: "93.184.216.34", family: 4 }])

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
    expect(await policy.resolveTarget({ host: "intranet.local", port: 5173 })).toEqual([
      { address: "192.168.1.50", family: 4 },
    ])
    expect(await policy.resolveTarget({ host: "intranet.local", port: 24678 })).toEqual([
      { address: "192.168.1.50", family: 4 },
    ])
    // Ungranted port on the same private host stays blocked
    await expect(policy.resolveTarget({ host: "intranet.local", port: 9999 })).rejects.toThrow(
      EgressPolicy.EgressDeniedError,
    )
    // Cannot grant metadata or protected management ports
    expect(() => policy.grant("169.254.169.254", 80)).toThrow(EgressPolicy.EgressDeniedError)
    expect(() => policy.grant("127.0.0.1", 4096)).toThrow(EgressPolicy.EgressDeniedError)
    expect(() => policy.grant("192.168.1.50", 22)).toThrow(EgressPolicy.EgressDeniedError)
  })

  test("BrowserTunnel restores pre-PR legacy connect when policy is omitted and enforces policy when enabled", async () => {
    const echo = createNetServer((socket) => socket.pipe(socket))
    await once(echo.listen(0, "127.0.0.1"), "listening")
    const addr = echo.address()
    if (!addr || typeof addr === "string") throw new Error("No TCP address")

    const openPort = createNetServer((socket) => socket.pipe(socket))
    await once(openPort.listen(0, "127.0.0.1"), "listening")
    const openAddr = openPort.address()
    if (!openAddr || typeof openAddr === "string") throw new Error("No TCP address")

    // Policy reserves echo's loopback port and maps a synthetic sentinel host to openPort's loopback IP.
    let sentinelResolved = 0
    const policy = EgressPolicy.makePolicy({
      reservedLocalPorts: () => new Set([addr.port]),
      resolve: async (host) => {
        if (host === "fixture-sentinel.invalid") {
          sentinelResolved += 1
          return [{ address: "127.0.0.1", family: 4 }]
        }
        return []
      },
    })
    policy.grant("fixture-sentinel.invalid", openAddr.port)

    const legacyOff = BrowserTunnel.make()
    const policyOn = BrowserTunnel.make(policy)
    try {
      // Experiment OFF (no policy): pre-PR legacy net.createConnection dials 127.0.0.1:<addr.port> directly.
      const legacyID = await Effect.runPromise(legacyOff.open({ host: "127.0.0.1", port: addr.port }))
      await Effect.runPromise(legacyOff.write(legacyID, new TextEncoder().encode("hi"), true))
      const echoed = await Effect.runPromise(legacyOff.read(legacyID))
      expect(new TextDecoder().decode(echoed.data)).toBe("hi")
      await Effect.runPromise(legacyOff.close(legacyID))

      // Experiment ON (policy provided): legacy RPC enforces policy (blocks reserved port, uses policy resolver).
      await expect(Effect.runPromise(policyOn.open({ host: "127.0.0.1", port: addr.port }))).rejects.toThrow("blocked")
      const sentinelID = await Effect.runPromise(
        policyOn.open({ host: "fixture-sentinel.invalid", port: openAddr.port }),
      )
      expect(sentinelResolved).toBe(1)
      await Effect.runPromise(policyOn.close(sentinelID))
    } finally {
      legacyOff.dispose()
      policyOn.dispose()
      await Promise.all([
        new Promise<void>((resolve) => echo.close(() => resolve())),
        new Promise<void>((resolve) => openPort.close(() => resolve())),
      ])
    }
  })
})

describe("BrowserConnection experiment attachment-boundary selection", () => {
  type Control = { type: string; connectionID: string; version?: number; capabilities?: readonly string[] }

  function makeConnectionFixture(host?: BrowserTunnelHost.Interface) {
    const sessionID = Session.ID.make("ses_00000000000000000000000001")
    const sessionRow = { id: sessionID, agent: "build", permissions: [] as unknown[], location: { directory: "/work" } }
    const controls: Control[] = []
    let handlers: Record<string, (input: object, call: object) => Effect.Effect<unknown, unknown>> = {}
    const call = { error: (code: string, message: string) => new Error(`${code}: ${message}`) }

    const ctx = {
      agent: { transform: () => Effect.void },
      permission: { hook: () => Effect.void, assert: () => Effect.void },
      session: {
        get: () => Effect.succeed(sessionRow),
        update: (req: { permissions?: unknown[] }) =>
          Effect.sync(() => {
            sessionRow.permissions = req.permissions ?? []
          }),
        hook: () => Effect.void,
      },
      storage: {
        scan: () => Effect.succeed({ entries: [] }),
        set: () => Effect.void,
        remove: () => Effect.void,
      },
      location: { directory: "/work" },
      rpc: {
        register: (_def: unknown, registered: typeof handlers) =>
          Effect.sync(() => {
            handlers = registered
            return {
              events: {
                emit: (_name: string, control: Control) =>
                  Effect.sync(() => {
                    controls.push(control)
                  }),
              },
            }
          }),
      },
      event: { subscribe: () => Stream.empty },
    }

    const start = () =>
      BrowserConnection.make(ctx as unknown as Parameters<typeof BrowserConnection.make>[0]).pipe(
        host ? Effect.provideService(BrowserTunnelHost.Reference, host) : (effect) => effect,
      )

    const attach = (connectionID: string) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(handlers.attach({ sessionID, connectionID, version: 4 }, call), {
          startImmediately: true,
        })
        yield* Effect.suspend(() =>
          controls.some((c) => c.type === "attached" && c.connectionID === connectionID)
            ? Effect.void
            : Effect.fail("waiting"),
        ).pipe(Effect.retry(Schedule.spaced("5 millis")), Effect.timeout("5 seconds"))
        const attachedEvent = controls.find((c) => c.type === "attached" && c.connectionID === connectionID)!
        return { fiber, attachedEvent }
      })

    return { sessionID, controls, getHandlers: () => handlers, call, start, attach }
  }

  test("disabled flag or absent host preserves legacy tunnel connect and refuses tickets/grants without minting", async () => {
    const reservedEcho = createNetServer((socket) => socket.pipe(socket))
    await once(reservedEcho.listen(0, "127.0.0.1"), "listening")
    const reservedAddr = reservedEcho.address()
    if (!reservedAddr || typeof reservedAddr === "string") throw new Error("No TCP address")

    let ticketsIssued = 0
    const disabledHost: BrowserTunnelHost.Interface = {
      enabled: Effect.succeed(false),
      reservedLocalPorts: () => new Set([reservedAddr.port]),
      issueTicket: () =>
        Effect.sync(() => {
          ticketsIssued += 1
          return { ticket: "tkt_should_not_mint", expiresIn: 30, protocol: 1, path: BrowserTunnelHost.BROWSER_TUNNEL_PATH }
        }),
      revokeAttachment: () => Effect.void,
    }

    try {
      for (const host of [undefined, disabledHost] as const) {
        const fx = makeConnectionFixture(host)
        await Effect.runPromise(
          Effect.gen(function* () {
            yield* fx.start()
            const { fiber, attachedEvent } = yield* fx.attach("conn_off")
            expect(attachedEvent.capabilities).toBeUndefined()

            const ticketExit = yield* fx
              .getHandlers()
              ["tunnel.ticket"]({ sessionID: fx.sessionID, connectionID: "conn_off", protocol: 1 }, fx.call)
              .pipe(Effect.exit)
            expect(ticketExit._tag).toBe("Failure")
            expect(ticketsIssued).toBe(0)

            const grantExit = yield* fx
              .getHandlers()
              ["tunnel.grant"](
                { sessionID: fx.sessionID, connectionID: "conn_off", target: { host: "127.0.0.1", port: 5173 } },
                fx.call,
              )
              .pipe(Effect.exit)
            expect(grantExit._tag).toBe("Failure")

            // Pre-PR legacy tunnel.open still connects to ordinary loopback even if port is in disabledHost.reservedLocalPorts
            const id = (yield* fx
              .getHandlers()
              ["tunnel.open"](
                { sessionID: fx.sessionID, connectionID: "conn_off", target: { host: "127.0.0.1", port: reservedAddr.port } },
                fx.call,
              )) as string
            yield* fx.getHandlers()["tunnel.close"]({ sessionID: fx.sessionID, connectionID: "conn_off", tunnelID: id }, fx.call)
            yield* Fiber.interrupt(fiber)
          }).pipe(Effect.scoped),
        )
      }
    } finally {
      await new Promise<void>((resolve) => reservedEcho.close(() => resolve()))
    }
  }, 15_000)

  test("enabled attachment enforces policy on legacy RPC, supports ticket/grant, and keeps boundary coherent across flag toggle", async () => {
    const reservedEcho = createNetServer((socket) => socket.pipe(socket))
    const allowedEcho = createNetServer((socket) => socket.pipe(socket))
    await Promise.all([
      once(reservedEcho.listen(0, "127.0.0.1"), "listening"),
      once(allowedEcho.listen(0, "127.0.0.1"), "listening"),
    ])
    const reservedAddr = reservedEcho.address()
    const allowedAddr = allowedEcho.address()
    if (!reservedAddr || typeof reservedAddr === "string" || !allowedAddr || typeof allowedAddr === "string") {
      throw new Error("No TCP address")
    }

    let flagEnabled = true
    let ticketsIssued = 0
    const host: BrowserTunnelHost.Interface = {
      enabled: Effect.sync(() => flagEnabled),
      reservedLocalPorts: () => new Set([reservedAddr.port]),
      issueTicket: () =>
        Effect.sync(() => {
          ticketsIssued += 1
          return {
            ticket: `tkt_${ticketsIssued}`,
            expiresIn: 30,
            protocol: 1,
            path: BrowserTunnelHost.BROWSER_TUNNEL_PATH,
          }
        }),
      revokeAttachment: () => Effect.void,
    }

    try {
      const fx = makeConnectionFixture(host)
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* fx.start()

          // 1. Attachment A starts while experiment is ON
          const attA = yield* fx.attach("conn_on")
          expect(attA.attachedEvent.capabilities).toEqual([BrowserTunnelHost.STREAM_CAPABILITY])

          // Ticket & grant succeed on enabled attachment
          const ticketA = yield* fx
            .getHandlers()
            ["tunnel.ticket"]({ sessionID: fx.sessionID, connectionID: "conn_on", protocol: 1 }, fx.call)
          expect(ticketA).toMatchObject({ ticket: "tkt_1", protocol: 1, path: BrowserTunnelHost.BROWSER_TUNNEL_PATH })

          yield* fx
            .getHandlers()
            ["tunnel.grant"](
              { sessionID: fx.sessionID, connectionID: "conn_on", target: { host: "127.0.0.1", port: allowedAddr.port } },
              fx.call,
            )

          // Policy is enforced even on legacy tunnel.open for an enabled attachment (no downgrade!)
          const blockedLegacy = yield* fx
            .getHandlers()
            ["tunnel.open"](
              { sessionID: fx.sessionID, connectionID: "conn_on", target: { host: "127.0.0.1", port: reservedAddr.port } },
              fx.call,
            )
            .pipe(Effect.exit)
          expect(blockedLegacy._tag).toBe("Failure")

          const okLegacy = (yield* fx
            .getHandlers()
            ["tunnel.open"](
              { sessionID: fx.sessionID, connectionID: "conn_on", target: { host: "127.0.0.1", port: allowedAddr.port } },
              fx.call,
            )) as string
          yield* fx.getHandlers()["tunnel.close"]({ sessionID: fx.sessionID, connectionID: "conn_on", tunnelID: okLegacy }, fx.call)

          // 2. Toggle flag OFF: already-active attachment A stays coherent until detach, while new attachment B uses legacy off mode
          flagEnabled = false
          const stillBlockedOnA = yield* fx
            .getHandlers()
            ["tunnel.open"](
              { sessionID: fx.sessionID, connectionID: "conn_on", target: { host: "127.0.0.1", port: reservedAddr.port } },
              fx.call,
            )
            .pipe(Effect.exit)
          expect(stillBlockedOnA._tag).toBe("Failure")

          // New attachment B replaces A under the disabled flag
          const attB = yield* fx.attach("conn_after_toggle")
          expect(yield* Fiber.join(attA.fiber)).toBe("replaced")
          expect(attB.attachedEvent.capabilities).toBeUndefined()

          const issuedBeforeB = ticketsIssued
          const ticketB = yield* fx
            .getHandlers()
            ["tunnel.ticket"]({ sessionID: fx.sessionID, connectionID: "conn_after_toggle", protocol: 1 }, fx.call)
            .pipe(Effect.exit)
          expect(ticketB._tag).toBe("Failure")
          expect(ticketsIssued).toBe(issuedBeforeB)

          const grantB = yield* fx
            .getHandlers()
            ["tunnel.grant"](
              {
                sessionID: fx.sessionID,
                connectionID: "conn_after_toggle",
                target: { host: "127.0.0.1", port: allowedAddr.port },
              },
              fx.call,
            )
            .pipe(Effect.exit)
          expect(grantB._tag).toBe("Failure")

          // Newly attached B restores legacy pre-PR connect (reaches reservedAddr.port with no EgressPolicy)
          const reopened = (yield* fx
            .getHandlers()
            ["tunnel.open"](
              {
                sessionID: fx.sessionID,
                connectionID: "conn_after_toggle",
                target: { host: "127.0.0.1", port: reservedAddr.port },
              },
              fx.call,
            )) as string
          yield* fx
            .getHandlers()
            ["tunnel.close"]({ sessionID: fx.sessionID, connectionID: "conn_after_toggle", tunnelID: reopened }, fx.call)
          yield* Fiber.interrupt(attB.fiber)
        }).pipe(Effect.scoped),
      )
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => reservedEcho.close(() => resolve())),
        new Promise<void>((resolve) => allowedEcho.close(() => resolve())),
      ])
    }
  }, 15_000)
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

  test("normal detach cancels pending credit-starved writes and FIN without reporting success or uncaught errors", async () => {
    const serverReceived: Buffer[] = []
    const peerSockets: Socket[] = []
    const target = createNetServer((socket) => {
      peerSockets.push(socket)
      // Pause the server target socket so server recvWindow stays exhausted (credit-starved client stream)
      socket.pause()
      socket.on("data", (chunk: Buffer) => serverReceived.push(chunk))
    })
    await once(target.listen(0, "127.0.0.1"), "listening")
    const addr = target.address()
    if (!addr || typeof addr === "string") throw new Error("No TCP address")

    const pair = createSocketPair({ simulateBuffered: true })
    // Withhold server WINDOW_UPDATE credits so the client's 4 KiB send window stays deterministically exhausted.
    const creditStarvedServer: BrowserTunnelHost.BinarySocket = {
      ...pair.server,
      get readyState() {
        return pair.server.readyState
      },
      get bufferedAmount() {
        return pair.server.bufferedAmount
      },
      send(data, onWritten) {
        if (data.byteLength >= 10 && data[1] === StreamWire.FrameType.WINDOW_UPDATE) {
          onWritten?.()
          return
        }
        pair.server.send(data, onWritten)
      },
    }
    const serverMux = StreamMux.createServerMux(creditStarvedServer, {
      policy: EgressPolicy.makePolicy(),
      streamWindowBytes: 4096,
      creditBatchBytes: 4096,
      heartbeatIntervalMs: 0,
    })
    const clientMux = StreamMux.createClientMux(pair.client, {
      streamWindowBytes: 4096,
      creditBatchBytes: 4096,
      frameChunkBytes: 4096,
      streamOutboundHighWaterBytes: 4096,
      heartbeatIntervalMs: 0,
    })

    const uncaught: Error[] = []
    const onUncaught = (error: Error) => {
      uncaught.push(error)
    }
    process.on("uncaughtException", onUncaught)

    try {
      // Stream 1: credit-starved pending write + queued second write (NO error listener attached)
      const writeStream = await clientMux.openStream({ host: "127.0.0.1", port: addr.port })
      let cb1Settled = false
      let cb2Settled = false
      const cb1 = Promise.withResolvers<Error | null | undefined>()
      const cb2 = Promise.withResolvers<Error | null | undefined>()
      // 16 KiB exceeds the 4 KiB initial sendWindow + 4 KiB high-water mark so writeResume stays held
      writeStream.write(Buffer.alloc(16 * 1024, 0xaa), (err) => {
        cb1Settled = true
        cb1.resolve(err)
      })
      writeStream.write(Buffer.alloc(8 * 1024, 0xbb), (err) => {
        cb2Settled = true
        cb2.resolve(err)
      })

      // Stream 2: credit-starved pending FIN via end(cb) (NO error listener attached)
      const finStream = await clientMux.openStream({ host: "127.0.0.1", port: addr.port })
      let finFinished = false
      let endSettled = false
      finStream.on("finish", () => {
        finFinished = true
      })
      const endCb = Promise.withResolvers<Error | null | undefined>()
      // First exhaust the 4 KiB window, leave 4 KiB queued (below high-water mark so _write returns and _final runs),
      // then call end() so finalCallback is held waiting for credit to send FIN.
      finStream.write(Buffer.alloc(6 * 1024, 0xcc))
      finStream.end((err?: Error | null) => {
        endSettled = true
        endCb.resolve(err)
      })

      // Stream 3: clean idle stream with no pending write/FIN
      const idleStream = await clientMux.openStream({ host: "127.0.0.1", port: addr.port })
      const idleClosed = Promise.withResolvers<void>()
      let idleErrored = false
      idleStream.on("error", () => {
        idleErrored = true
      })
      idleStream.once("close", () => idleClosed.resolve())

      // Let initial 4 KiB window fill so remaining outgoing bytes/FIN are strictly credit-starved
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
      expect(cb1Settled).toBe(false)
      expect(cb2Settled).toBe(false)
      expect(endSettled).toBe(false)
      const bytesBeforeDetach = serverReceived.reduce((sum, b) => sum + b.byteLength, 0)

      // Trigger normal detach while streams 1 & 2 have discarded buffered writes/FIN
      clientMux.close(1000, "desktop detached")

      const [err1, err2, errEnd] = await Promise.all([cb1.promise, cb2.promise, endCb.promise])
      await idleClosed.promise
      await new Promise<void>((resolve) => setTimeout(resolve, 25))

      // Discarded pending writes and FIN MUST settle with cancellation errors, never null/success
      expect(err1).toBeInstanceOf(Error)
      expect(err1?.message).toContain("desktop detached")
      expect(err2).toBeInstanceOf(Error)
      expect(errEnd).toBeInstanceOf(Error)
      expect(finFinished).toBe(false)
      // Clean idle socket closes normally with no error event
      expect(idleErrored).toBe(false)
      // No discarded bytes flushed/retried after detach, and zero uncaught 'error' events
      expect(serverReceived.reduce((sum, b) => sum + b.byteLength, 0)).toBe(bytesBeforeDetach)
      expect(uncaught).toEqual([])
    } finally {
      process.off("uncaughtException", onUncaught)
      clientMux.close()
      serverMux.close()
      peerSockets.forEach((s) => s.destroy())
      await new Promise<void>((resolve) => target.close(() => resolve()))
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
