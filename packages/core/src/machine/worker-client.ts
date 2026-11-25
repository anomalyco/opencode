export * as WorkerClient from "./worker-client.js"

import { Cause, Deferred, Effect, Queue, Result, Sink, Stream } from "effect"
import type { Environment } from "../environment/index.js"
import { Frames } from "./frames.js"
import { Machine } from "./index.js"
import { Link } from "./link.js"
import type { ToWorker } from "./wire.js"

const HELLO_DEADLINE = "10 seconds"
const HEADER_BYTES = 4

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
    options: {
      path: machine.environment.path,
      shell: machine.environment.shell,
      home: machine.environment.home,
    },
  } satisfies Environment.Driver
})

/**
 * Pull mode: attaches to a listening `opencode-worker serve` (or a relay-bridged worker) over any binary
 * `Link.Carrier`, authenticates via Noise XX against `peerKey`, and returns a scoped `Environment.Driver`.
 */
export const dial = Effect.fn("WorkerClient.dial")(function* (
  id: Environment.ID,
  carrier: Link.Carrier,
  options: { readonly peerKey: Uint8Array; readonly fixed?: Link.Fixed; readonly machine?: Machine.Interface },
) {
  const served = yield* Link.serveDirect(carrier, { machine: id, peerKey: options.peerKey }, options.fixed)
  return yield* fromConnection(id, served.connection, options.machine)
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
  id: Environment.ID,
  io: StdioPipe,
  existing?: Machine.Interface,
) {
  const pull = yield* Stream.toPull(decodeStdioFrames(io.stdout))
  const first = yield* pull.pipe(
    Effect.flatMap((batch) => Effect.map(Link.decodeHello(id, batch[0]), (hello) => ({ hello, rest: batch.slice(1) }))),
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
    id,
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
