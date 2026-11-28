export * as Iroh from "./iroh.js"

import type { BiStream, Endpoint, Incoming } from "@number0/iroh"
import { Context, Effect, Option, Semaphore } from "effect"
import { Identity } from "./identity.js"
import loadBinding from "./iroh-binding.js"
import { Link } from "./link.js"
import { Machines } from "./machines.js"

// The link over Iroh: the same handshake and frames as over the WebSocket route, on one bidirectional QUIC stream to the
// home's endpoint, whose key is the home key, so its endpoint id is the `home` of every join string. Each message the
// WebSocket route carries as one binary message is a 2-byte big-endian length and the message here. Iroh's own
// keep-alive (every 5 s) and idle timeout (30 s) take the place of the route's ping: a dead peer is noticed within
// 30 s, where the route takes 30 to 60.

const ALPN = Array.from(new TextEncoder().encode("opencode-link/1"))
/** How much one read asks the binding for: it copies every byte through a JavaScript array, so reads stay this size. */
const CHUNK = 64 * 1024
/** As on the WebSocket route: handshakes in progress at once, and how long a stranger may take to open its stream. */
const MAX_HANDSHAKES = 32
const DEADLINE = "10 seconds"
/** As on the WebSocket route: how long a send waits on a peer that reads nothing before the connection is dropped. */
const STALL = "60 seconds"
/** The WebSocket route's close: policy violation, no reason, for every connection the home ends. */
const CLOSE = 1008n

/**
 * Only for tests, as `Link.Fixed` is: `offline` binds on loopback with no relays and no address lookup, `load` stands
 * in for the binding's import, and `watch` sees the endpoint once it is bound. Production never sets it.
 */
export const Testing = Context.Reference<{
  readonly offline: boolean
  readonly load: typeof loadBinding
  readonly watch: (endpoint: Endpoint) => void
}>("@opencode/MachineIroh/Testing", { defaultValue: () => ({ offline: false, load: loadBinding, watch: () => {} }) })

/**
 * Binds the home's endpoint with the home key and serves every link that arrives on it, each as the WebSocket route
 * serves one, until the scope closes. `admit` is asked before each connection, as the route reads its flag on each
 * upgrade. Fails when the binding is missing or cannot bind; links then keep coming over WebSockets only.
 */
export const listen = Effect.fn("Iroh.listen")(function* (admit: Effect.Effect<boolean>) {
  const testing = yield* Testing
  const identity = yield* Identity.Service
  const services = yield* Effect.context<Machines.Service | Identity.Service>()
  const binding = yield* Effect.tryPromise(() => testing.load())
  if (!binding) return yield* Effect.fail(new Error("no Iroh build for this platform"))
  const builder = binding.Endpoint.builder()
  // The development default: n0's public relays and address lookup.
  if (testing.offline) {
    builder.applyMinimal()
    builder.bindAddr("127.0.0.1:0")
  } else builder.applyN0()
  builder.secretKey(Array.from(yield* identity.seed()))
  builder.alpns([ALPN])
  const endpoint = yield* Effect.acquireRelease(
    Effect.tryPromise(() => builder.bind()),
    (endpoint) => Effect.promise(() => endpoint.close()),
  )
  testing.watch(endpoint)
  const handshakes = Semaphore.makeUnsafe(MAX_HANDSHAKES)
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        const incoming = yield* Effect.tryPromise(() => endpoint.acceptNext())
        if (!incoming) return
        yield* Effect.forkScoped(serve(incoming, handshakes, admit).pipe(Effect.provide(services)))
      }
    }).pipe(Effect.ignore),
  )
  return endpoint
})

/** One connection, from its QUIC handshake to the end of its link, as the WebSocket route serves an upgrade. */
const serve = (incoming: Incoming, handshakes: Semaphore.Semaphore, admit: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    const on = yield* admit
    if (!on) return yield* Effect.promise(() => incoming.refuse())
    const admitted = yield* handshakes.withPermitsIfAvailable(1)(
      Effect.gen(function* () {
        const connection = yield* Effect.acquireRelease(
          Effect.tryPromise(async (signal) => {
            const connection = await (await incoming.accept()).connect()
            // The native handshake keeps running after Effect abandons it.
            if (signal.aborted) connection.close(CLOSE, [])
            return connection
          }).pipe(Effect.timeout(DEADLINE)),
          (connection) => Effect.sync(() => connection.close(CLOSE, [])),
        )
        const stream = yield* Effect.tryPromise(() => connection.acceptBi()).pipe(Effect.timeout(DEADLINE))
        return yield* Link.serve({
          ...carrier(stream, () => connection.close(CLOSE, [])),
          describe: () => {
            // Iroh selects one path per remote key, not per connection: when a worker dials again while its old
            // connection is still open (a restart, or a redial before the idle timeout), the old connection's path
            // stays selected and the home never selects one on the new connection. Fall back to direct before relayed,
            // then the lowest round trip.
            const paths = connection.paths()
            const path =
              paths.find((path) => path.isSelected) ??
              paths.toSorted((a, b) => Number(a.isRelay) - Number(b.isRelay) || a.rttMs - b.rttMs)[0]
            return {
              kind: "iroh",
              ...(path ? { path: path.isRelay ? "relayed" : "direct", rtt: path.rttMs } : {}),
            }
          },
        })
      }),
    )
    if (Option.isNone(admitted)) return yield* Effect.promise(() => incoming.refuse())
    const machines = yield* Machines.Service
    yield* machines.connect(admitted.value.machine, admitted.value.connection)
  }).pipe(Effect.scoped, Effect.ignore)

/**
 * One bidirectional stream as the link's carrier, either side of it: each message is its 2-byte big-endian length and
 * its bytes. What is held unread is at most one read past the message being read. `drop` ends the connection, which the
 * reader then sees as the carrier closing.
 */
export const carrier = (stream: BiStream, drop: () => void): Link.Carrier => {
  let held = new Uint8Array(0)
  let offset = 0
  let end = 0
  const fill = (length: number) =>
    Effect.gen(function* () {
      while (end - offset < length) {
        const read = new Uint8Array(yield* Effect.tryPromise(() => stream.recv.read(CHUNK)))
        if (read.length === 0) return yield* new Link.Closed()
        if (held.length - end < read.length) {
          const next = new Uint8Array(Math.max(length, end - offset + read.length))
          next.set(held.subarray(offset, end))
          held = next
          end -= offset
          offset = 0
        }
        held.set(read, end)
        end += read.length
      }
    })
  return {
    send: (message) => {
      const framed = new Uint8Array(2 + message.length)
      new DataView(framed.buffer).setUint16(0, message.length)
      framed.set(message, 2)
      return Effect.tryPromise(() => {
        // Avoid the iterator: an indexed copy is ~22x faster than Array.from for 64 KiB in Bun.
        const bytes = new Array<number>(framed.length)
        for (let i = 0; i < framed.length; i++) bytes[i] = framed[i]
        return stream.send.writeAll(bytes)
      }).pipe(
        Effect.timeout(STALL),
        Effect.catchCause(() => Effect.sync(drop)),
      )
    },
    receive: Effect.gen(function* () {
      yield* fill(2)
      const length = (held[offset] << 8) | held[offset + 1]
      yield* fill(2 + length)
      const message = held.slice(offset + 2, offset + 2 + length)
      offset += 2 + length
      return message
    }).pipe(Effect.mapError(() => new Link.Closed())),
  }
}
