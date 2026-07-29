import { BrowserHost } from "@opencode-ai/core/browser-host"
import { BrowserControlProtocol } from "@opencode-ai/protocol/browser-control"
import { BrowserTunnelProtocol } from "@opencode-ai/protocol/browser-tunnel"
import { Browser } from "@opencode-ai/schema/browser"
import { BrowserTunnel } from "@opencode-ai/schema/browser-tunnel"
import { Session } from "@opencode-ai/schema/session"
import { expect } from "bun:test"
import { Effect, Fiber, Queue } from "effect"
import { Socket } from "effect/unstable/socket"
import { createServer } from "node:net"
import { it } from "../../core/test/lib/effect"
import { BrowserControlConnection } from "../src/browser-control-connection"
import { BrowserTunnelServer } from "../src/browser-tunnel"

const sessionID = Session.ID.make("ses_browser_server")
const leaseID = Browser.LeaseID.make("brl_browserserver")
const state: Browser.State = {
  url: "http://localhost/",
  title: "Local",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  generation: 1,
}
const end = Symbol("end")

it.live("registers and attaches with the real host before dialing remote TCP", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const browser = yield* BrowserHost.make(() => Effect.succeed(true))
      const control = yield* makeSocket
      const controlFiber = yield* BrowserControlConnection.run(control.socket).pipe(
        Effect.provideService(BrowserHost.Service, browser),
        Effect.forkChild,
      )
      yield* Queue.offer(
        control.inbound,
        BrowserControlProtocol.encodeFromClient({ type: "browser.control.register", sessionID }),
      )
      expect(yield* controlMessage(control)).toEqual({ type: "browser.control.registered" })
      yield* Queue.offer(
        control.inbound,
        BrowserControlProtocol.encodeFromClient({ type: "browser.control.attach", leaseID, state }),
      )
      expect(yield* controlMessage(control)).toEqual({ type: "browser.control.attached", leaseID })

      const target = yield* echoServer
      const address = target.address()
      if (!address || typeof address === "string") throw new Error("echo server did not bind")
      const tunnels = yield* BrowserTunnelServer.make().pipe(Effect.provideService(BrowserHost.Service, browser))
      const connection = yield* tunnels.acquire
      const transport = yield* makeSocket
      const running = yield* connection.run(transport.socket).pipe(Effect.forkChild)
      yield* Queue.offer(
        transport.inbound,
        BrowserTunnelProtocol.encodeFromClient({
          type: "browser.tunnel.open",
          sessionID,
          leaseID,
          target: { host: BrowserTunnel.Host.make("127.0.0.1"), port: BrowserTunnel.Port.make(address.port) },
        }),
      )
      const opened = yield* Queue.take(transport.outbound)
      if (typeof opened !== "string") throw new Error("expected text tunnel handshake")
      expect(yield* BrowserTunnelProtocol.decodeFromServer(opened)).toEqual({ type: "browser.tunnel.opened" })

      yield* Queue.offer(transport.inbound, Buffer.from("through server"))
      const echoed = yield* Queue.take(transport.outbound)
      if (!(echoed instanceof Uint8Array)) throw new Error("expected raw tunnel bytes")
      expect(Buffer.from(echoed).toString()).toBe("through server")

      yield* Queue.offer(transport.inbound, end)
      yield* Fiber.join(running)
      yield* Queue.offer(control.inbound, end)
      yield* Fiber.join(controlFiber)
    }),
  ),
)

const makeSocket = Effect.gen(function* () {
  const inbound = yield* Queue.unbounded<string | Uint8Array | typeof end>()
  const outbound = yield* Queue.unbounded<string | Uint8Array | Socket.CloseEvent>()
  return {
    inbound,
    outbound,
    socket: Socket.make({
      runRaw: (handler, options) =>
        Effect.gen(function* () {
          if (options?.onOpen) yield* options.onOpen
          while (true) {
            const message = yield* Queue.take(inbound)
            if (message === end) return
            const handled = handler(message)
            if (Effect.isEffect(handled)) yield* Effect.asVoid(handled)
          }
        }),
      writer: Effect.succeed((message) => Queue.offer(outbound, message).pipe(Effect.asVoid)),
    }),
  }
})

function controlMessage(transport: Effect.Success<typeof makeSocket>) {
  return Queue.take(transport.outbound).pipe(
    Effect.flatMap((message) =>
      typeof message === "string"
        ? BrowserControlProtocol.decodeFromServer(message)
        : Effect.fail(new Error("expected text control message")),
    ),
  )
}

const echoServer = Effect.acquireRelease(
  Effect.callback<ReturnType<typeof createServer>, Error>((resume) => {
    const server = createServer((socket) => socket.pipe(socket))
    server.once("error", (error) => resume(Effect.fail(error)))
    server.listen(0, "127.0.0.1", () => resume(Effect.succeed(server)))
    return Effect.sync(() => server.close())
  }),
  (server) => Effect.sync(() => server.close()),
)
