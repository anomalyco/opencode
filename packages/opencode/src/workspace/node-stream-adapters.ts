// Effect ↔ Node stream bridges for LSP transport. `vscode-jsonrpc/node`
// wants Node Readable/Writable; `Workspace.Primitives.execStream` yields
// Effect Stream/Sink. These adapters bridge between the two.
//
// Critical: ONE long-lived `Stream.run(fromQueue, sink)` per writable.
// Re-running the sink per chunk would fire `Sink.ensuring` after every
// write, closing stdin and breaking LSP's bidirectional JSON-RPC.

import { Cause, Effect, Fiber, ManagedRuntime, Queue, Scope, Sink, Stream } from "effect"
import { Readable, Writable } from "stream"

export type LspRuntime = ManagedRuntime.ManagedRuntime<never, never>

const registerInterrupt = (
  runtime: LspRuntime,
  scope: Scope.Closeable,
  fiber: Fiber.Fiber<unknown, unknown>,
) => {
  runtime.runFork(
    Scope.addFinalizer(scope, Fiber.interrupt(fiber)) as Effect.Effect<void>,
  )
}

export const streamToNodeReadable = <E>(
  source: Stream.Stream<Uint8Array, E>,
  runtime: LspRuntime,
  scope: Scope.Closeable,
): Readable => {
  const readable = new Readable({
    read() {
      // Pull model; we push unconditionally.
    },
  })
  let closed = false
  const push = (chunk: Uint8Array | null) => {
    if (closed) return
    if (chunk === null) {
      closed = true
      readable.push(null)
      return
    }
    readable.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
  }

  const drain = Stream.runForEach(source, (chunk) =>
    Effect.sync(() => push(chunk)),
  ).pipe(
    Effect.ensuring(Effect.sync(() => push(null))),
    Effect.catchCause((cause: Cause.Cause<unknown>) =>
      Effect.sync(() => {
        if (closed) return
        closed = true
        readable.destroy(new Error(Cause.pretty(cause)))
      }),
    ),
  )

  const fiber = runtime.runFork(drain as Effect.Effect<void>)
  registerInterrupt(runtime, scope, fiber)

  readable.on("close", () => {
    if (closed) return
    closed = true
    runtime.runFork(Fiber.interrupt(fiber) as Effect.Effect<void>)
  })
  return readable
}

export const sinkToNodeWritable = <E>(
  sink: Sink.Sink<void, Uint8Array, never, E>,
  runtime: LspRuntime,
  scope: Scope.Closeable,
): Writable => {
  const queue = Effect.runSync(Queue.unbounded<Uint8Array, Cause.Done>())

  const run = Stream.fromQueue(queue).pipe(
    Stream.run(sink as Sink.Sink<void, Uint8Array, never, E>),
    Effect.ignore,
  )
  const fiber = runtime.runFork(run as Effect.Effect<void>)
  registerInterrupt(runtime, scope, fiber)

  const writable = new Writable({
    write(
      chunk: Buffer | Uint8Array | string,
      _encoding: BufferEncoding,
      callback: (err?: Error | null) => void,
    ) {
      try {
        const bytes: Uint8Array =
          typeof chunk === "string"
            ? new TextEncoder().encode(chunk)
            : chunk instanceof Uint8Array
              ? chunk
              : new Uint8Array(chunk as any)
        Queue.offerUnsafe(queue, bytes)
        callback()
      } catch (err) {
        callback(err as Error)
      }
    },
    final(callback: (err?: Error | null) => void) {
      try {
        Queue.endUnsafe(queue)
        callback()
      } catch (err) {
        callback(err as Error)
      }
    },
    destroy(err: Error | null, callback: (err?: Error | null) => void) {
      try {
        Queue.endUnsafe(queue)
      } catch {}
      runtime.runFork(Fiber.interrupt(fiber) as Effect.Effect<void>)
      callback(err)
    },
  })
  return writable
}
