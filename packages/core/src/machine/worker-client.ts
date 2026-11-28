export * as WorkerClient from "./worker-client.js"

import { Cause, Deferred, Effect, Queue, Result, Sink, Stream } from "effect"
import { Environment } from "../environment/index.js"
import type { Workspace } from "../workspace.js"
import { Frames } from "./frames.js"
import { Machine } from "./index.js"
import { Link } from "./link.js"
import type { ToWorker } from "./wire.js"

const HELLO_DEADLINE = "10 seconds"
const HEADER_BYTES = 4
const MAX_FRAME = 65_535
/** Cap unread inbound WebSocket bytes well below Cloudflare workerd's 128 MB isolate limit. */
const MAX_WEBSOCKET_WAITING = 8 * 1024 * 1024
const NORMAL_CLOSE = 1000
/** Custom WHATWG-valid close code (3000–4999) so standard WebSocket implementations (Node, Bun, workerd) accept it. */
const POLICY_CLOSE = 4008

/** Encodes a single UTF-8 JSON payload with a 4-byte big-endian uint32 length prefix for `opencode-worker stdio`. */
export const encodeStdioFrame = (payload: Uint8Array): Result.Result<Uint8Array, Link.Refused> => {
  if (payload.byteLength === 0 || payload.byteLength > Frames.MAX_MESSAGE) return Result.fail(new Link.Refused())
  const frame = new Uint8Array(HEADER_BYTES + payload.byteLength)
  new DataView(frame.buffer, frame.byteOffset, HEADER_BYTES).setUint32(0, payload.byteLength, false)
  frame.set(payload, HEADER_BYTES)
  return Result.succeed(frame)
}

/**
 * O(N) incremental parser for 4-byte big-endian uint32 length-prefixed `opencode-worker stdio` frames.
 * Reads each 4-byte header into a fixed buffer, allocates each payload once, and slices chunks via `subarray`.
 */
export const createStdioFrameDecoder = () => {
  const header = new Uint8Array(HEADER_BYTES)
  const view = new DataView(header.buffer)
  let payload: Uint8Array | undefined
  let written = 0

  return {
    push: (chunk: Uint8Array): Result.Result<ReadonlyArray<Uint8Array>, Link.Refused> => {
      const frames: Uint8Array[] = []
      let offset = 0
      while (offset < chunk.byteLength) {
        const target = payload ?? header
        const take = Math.min(target.byteLength - written, chunk.byteLength - offset)
        target.set(chunk.subarray(offset, offset + take), written)
        written += take
        offset += take
        if (written < target.byteLength) break
        written = 0
        if (!payload) {
          const length = view.getUint32(0, false)
          if (length === 0 || length > Frames.MAX_MESSAGE) return Result.fail(new Link.Refused())
          payload = new Uint8Array(length)
          continue
        }
        frames.push(payload)
        payload = undefined
      }
      return Result.succeed(frames)
    },
    hasPartial: () => written > 0 || payload !== undefined,
  }
}

const decodeStdioFrames = (stdout: Stream.Stream<Uint8Array, unknown>): Stream.Stream<Uint8Array, Link.Refused> =>
  Stream.suspend(() => {
    const decoder = createStdioFrameDecoder()
    return stdout.pipe(
      Stream.mapError(() => new Link.Refused()),
      Stream.flatMap((chunk) => Stream.fromArrayEffect(Effect.fromResult(decoder.push(chunk)))),
      Stream.concat(Stream.suspend(() => (decoder.hasPartial() ? Stream.fail(new Link.Refused()) : Stream.empty))),
    )
  })

/**
 * Adapts a live `Machine.Connection` into a scoped `Environment.Driver`, reusing the worker wire protocol's
 * 8 symlink-safe file operations and streaming process spawner for any pull-mode or pipe-mode target.
 *
 * Pass an existing `machine` to keep running processes tracked across reconnects (closing the scope ends only
 * this connection); omit it for a single-connection driver whose scope owns and closes the machine.
 */
export const fromConnection = Effect.fn("WorkerClient.fromConnection")(function* (
  id: Environment.ID,
  connection: Machine.Connection,
  existing?: Machine.Interface,
) {
  const machine = existing ?? Machine.make(id)
  if (!existing) {
    yield* Effect.addFinalizer(() => Effect.sync(() => machine.close(new Machine.NotSent({ machine: id }))))
  }
  yield* Effect.forkScoped(machine.connect(connection), { startImmediately: true })
  return {
    spawner: machine.environment.spawner,
    overrides: machine.environment.files,
    // The machine this connection's hello describes. Home follows the machine's newest connection, failing offline.
    options: { ...Machine.rules(connection.hello), home: machine.environment.home },
  } satisfies Environment.Driver
})

/**
 * Structural subset of standard WebSocket (DOM, Bun, Node, and Cloudflare Workers `workerd`, including
 * already-open `fetch`-upgraded sockets after `accept()`).
 */
export interface WebSocketLike {
  readonly readyState: number
  binaryType?: string
  send(data: Uint8Array<ArrayBuffer>): void
  close(code?: number, reason?: string): void
  addEventListener(type: "open" | "close" | "error", listener: () => void): void
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void
  removeEventListener?(type: "open" | "close" | "error", listener: () => void): void
  removeEventListener?(type: "message", listener: (event: { readonly data: unknown }) => void): void
}

const toBytes = (data: unknown): Uint8Array | undefined => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return undefined
}

/**
 * Adapts a standard or Cloudflare Workers WebSocket into a scoped binary `Link.Carrier` for `WorkerClient.dial`.
 *
 * Accepts sockets that are still `CONNECTING` (waits interruptibly for `open`) or already `OPEN` (such as a
 * Cloudflare `fetch` WebSocket after `accept()` — call `fromWebSocket` immediately after `accept()` with no `await`
 * in between so the worker's first handshake message is not missed). Rejects text or oversized frames and closes the
 * socket when the owning scope exits.
 */
export const fromWebSocket = Effect.fn("WorkerClient.fromWebSocket")(function* (socket: WebSocketLike) {
  if (socket.readyState >= 2) return yield* new Link.Closed()
  const inbound = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const opened = yield* Deferred.make<void, Link.Closed>()
  let queuedBytes = 0

  const onOpen = () => {
    Deferred.doneUnsafe(opened, Effect.void)
  }

  const onMessage = (event: { readonly data: unknown }) => {
    const bytes = toBytes(event.data)
    if (!bytes || bytes.byteLength > MAX_FRAME || queuedBytes + bytes.byteLength > MAX_WEBSOCKET_WAITING) {
      close(POLICY_CLOSE)
      return
    }
    queuedBytes += bytes.byteLength
    Queue.offerUnsafe(inbound, bytes)
  }

  const onClose = () => {
    close()
  }

  const close = (code?: number) => {
    socket.removeEventListener?.("open", onOpen)
    socket.removeEventListener?.("message", onMessage)
    socket.removeEventListener?.("error", onClose)
    socket.removeEventListener?.("close", onClose)
    Queue.endUnsafe(inbound)
    Deferred.doneUnsafe(opened, Effect.fail(new Link.Closed()))
    if (socket.readyState < 2) socket.close(code)
  }

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      if (socket.readyState >= 2) return close()
      if ("binaryType" in socket) socket.binaryType = "arraybuffer"
      socket.addEventListener("message", onMessage)
      socket.addEventListener("error", onClose)
      socket.addEventListener("close", onClose)
      if (socket.readyState === 1) return onOpen()
      socket.addEventListener("open", onOpen)
    }),
    () => Effect.sync(() => close(NORMAL_CLOSE)),
  )

  yield* Deferred.await(opened).pipe(Effect.onError(() => Effect.sync(() => close(NORMAL_CLOSE))))

  return {
    describe: () => ({ kind: "websocket" }),
    send: (message) =>
      Effect.sync(() => {
        if (socket.readyState !== 1) return
        socket.send(new Uint8Array(message))
      }),
    receive: Queue.take(inbound).pipe(
      Effect.map((bytes) => {
        queuedBytes -= bytes.byteLength
        return bytes
      }),
      Effect.mapError(() => new Link.Closed()),
    ),
  } satisfies Link.Carrier
})

/**
 * Pull mode: attaches to a listening `opencode-worker serve` (or a relay-bridged worker) over any binary
 * `Link.Carrier`, authenticates via Noise XX against `peerKey`, and returns a scoped `Environment.Driver`.
 */
export const dial = Effect.fn("WorkerClient.dial")(function* (
  id: Environment.ID | Workspace.ID,
  carrier: Link.Carrier,
  options: { readonly peerKey: Uint8Array; readonly fixed?: Link.Fixed; readonly machine?: Machine.Interface },
) {
  const environmentID = Environment.ID.make(id)
  const served = yield* Link.serveDirect(carrier, { machine: environmentID, peerKey: options.peerKey }, options.fixed)
  return yield* fromConnection(environmentID, served.connection, options.machine)
})

export interface StdioPipe {
  readonly stdin: Sink.Sink<void, Uint8Array, unknown, unknown>
  readonly stdout: Stream.Stream<Uint8Array, unknown>
}

/**
 * Pipe mode: speaks 4-byte big-endian length-prefixed `wire.ts` JSON frames over an already-authenticated
 * duplex byte stream (such as `ssh host opencode-worker stdio` or container `exec`) and returns a scoped `Environment.Driver`.
 */
export const stdio = Effect.fn("WorkerClient.stdio")(function* (
  id: Environment.ID | Workspace.ID,
  io: StdioPipe,
  existing?: Machine.Interface,
) {
  const environmentID = Environment.ID.make(id)
  const pull = yield* Stream.toPull(decodeStdioFrames(io.stdout))
  const first = yield* pull.pipe(
    Effect.flatMap((batch) =>
      Effect.map(Link.decodeHello(environmentID, batch[0]), (hello) => ({ hello, rest: batch.slice(1) })),
    ),
    Effect.timeout(HELLO_DEADLINE),
    Effect.catchCause(() => Effect.fail(new Link.Refused())),
  )

  const outbox = yield* Queue.unbounded<ToWorker, Cause.Done>()
  const ended = yield* Deferred.make<void>()
  const end = Effect.andThen(Deferred.succeed(ended, undefined), Queue.end(outbox))
  yield* Effect.addFinalizer(() => end)

  const outbound = Stream.fromQueue(outbox).pipe(
    Stream.mapEffect((message) =>
      Effect.flatMap(Link.workerCodec.encode(message), (bytes) => Effect.fromResult(encodeStdioFrame(bytes))),
    ),
  )
  yield* Effect.forkScoped(Stream.run(outbound, io.stdin).pipe(Effect.ignore, Effect.ensuring(end)), {
    startImmediately: true,
  })

  const messages = Stream.suspend(() =>
    Deferred.isDoneUnsafe(ended)
      ? Stream.empty
      : Stream.fromPull(Effect.succeed(pull)).pipe(
          Stream.prepend(first.rest),
          Stream.mapEffect((bytes) =>
            Deferred.isDoneUnsafe(ended) ? Effect.fail(new Link.Refused()) : Link.workerCodec.decode(bytes),
          ),
          Stream.interruptWhen(Deferred.await(ended)),
          Stream.ignore,
          Stream.ensuring(end),
        ),
  )

  return yield* fromConnection(
    environmentID,
    {
      hello: first.hello,
      send: (message) => {
        Queue.offerUnsafe(outbox, message)
      },
      messages,
    },
    existing,
  )
})
