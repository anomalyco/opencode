export * as McpStdio from "./stdio.js"

import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { Cause, Duration, Effect, Queue, Scope, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import { Environment } from "../environment/index.js"

/** Mirrors StdioClientTransport: wait this long for a graceful exit after stdin closes. */
const CLOSE_GRACE = Duration.seconds(2)

/** Mirrors StdioClientTransport: escalate SIGTERM to SIGKILL after this long. */
const FORCE_KILL_AFTER = Duration.seconds(2)
const OUTGOING_CAPACITY = 64
const MAX_FRAME_BYTES = 16 * 1024 * 1024

export interface Options {
  /** Server name; only used to attribute logs. */
  readonly server: string
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd: string
  /**
   * Environment declared by the server config, and nothing else.
   *
   * The host environment is merged in by the spawner via `extendEnv`, which keeps the merge on the
   * side that actually runs the process: the local driver extends with the host's `process.env`
   * (what the MCP SDK's transport did), while a workspace driver extends with the sandbox's own
   * environment. Host variables therefore never cross the seam into a remote workspace.
   */
  readonly environment: Record<string, string>
}

/**
 * MCP stdio transport that spawns its server through the location's `Environment` instead of the
 * SDK's host-bound `StdioClientTransport`, so a workspace-backed location runs its MCP servers
 * wherever the rest of its execution happens.
 *
 * The process is acquired in the calling scope: closing the scope kills it (the spawner kills the
 * whole process group, so descendants go too) regardless of whether the transport was closed.
 */
export const make = Effect.fnUntraced(function* (options: Options) {
  const environment = yield* Environment.Service
  const scope = yield* Effect.scope
  // Outgoing frames are queued rather than written to `handle.stdin` directly: the sink closes the
  // stream it is run with, and stdin must stay open across the whole session.
  const outgoing = yield* Queue.bounded<string, Cause.Done>(OUTGOING_CAPACITY)
  const buffer = new ReadBuffer()
  const state: { phase: "ready" | "starting" | "open" | "closed"; handle?: ChildProcessHandle } = { phase: "ready" }
  let startup: Promise<void> | undefined
  let closing: Promise<void> | undefined
  let trailingBytes = 0

  const stop = Effect.fnUntraced(function* (handle: ChildProcessHandle) {
    // Exit completion can precede descendant cleanup after the capture deadline.
    yield* Effect.timeoutOption(handle.exitCode, CLOSE_GRACE).pipe(Effect.ignore)
    const terminated = yield* Effect.timeoutOption(handle.kill({ killSignal: "SIGTERM" }), FORCE_KILL_AFTER)
    if (terminated._tag === "None") yield* handle.kill({ killSignal: "SIGKILL" })
  }, Effect.ignore())

  const close = () =>
    (closing ??= Effect.runPromise(
      Effect.gen(function* () {
        state.phase = "closed"
        Queue.endUnsafe(outgoing)
        if (startup) yield* Effect.promise(() => startup!.catch(() => undefined))
        const handle = state.handle
        if (!handle) return
        state.handle = undefined
        yield* stop(handle)
      }).pipe(Effect.ensuring(Queue.shutdown(outgoing)), Effect.ensuring(Effect.sync(() => buffer.clear()))),
    ))

  const transport: Transport = {
    start: () => {
      if (state.phase !== "ready") return Promise.reject(new Error("Stdio transport already started"))
      state.phase = "starting"
      startup = Effect.runPromise(
        Effect.gen(function* () {
          const handle = yield* environment.spawner.spawn(
            ChildProcess.make(options.command, [...options.args], {
              cwd: options.cwd,
              env: options.environment,
              extendEnv: true,
              stdin: { stream: Stream.encodeText(Stream.fromQueue(outgoing)), endOnDone: true },
              stdout: "pipe",
              stderr: "pipe",
              forceKillAfter: FORCE_KILL_AFTER,
            }),
          )
          state.handle = handle
          if (state.phase === "closed") {
            state.handle = undefined
            return yield* stop(handle)
          }
          state.phase = "open"
          yield* startOutput(handle)
        }).pipe(Scope.provide(scope)),
      )
      return startup
    },
    send: (message: JSONRPCMessage) =>
      state.phase !== "open"
        ? Promise.reject(new Error("Not connected"))
        : Effect.runPromise(
            Queue.offer(outgoing, serializeMessage(message)).pipe(
              Effect.flatMap((offered) => (offered ? Effect.void : Effect.fail(new Error("Not connected")))),
            ),
          ),
    close,
  }

  const deliver = (chunk: Uint8Array) =>
    Effect.gen(function* () {
      for (const byte of chunk) {
        trailingBytes = byte === 10 ? 0 : trailingBytes + 1
        if (trailingBytes > MAX_FRAME_BYTES) return yield* Effect.fail(new Error("MCP stdio frame exceeded 16 MiB"))
      }
      buffer.append(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      while (true) {
        // `undefined` means the frame failed to parse: the buffer has already advanced past it, so
        // keep draining. `null` means the buffer holds no complete frame yet.
        const message = yield* Effect.try({
          try: () => buffer.readMessage(),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              transport.onerror?.(error)
              return undefined
            }),
          ),
        )
        if (message === undefined) continue
        if (message === null) return
        transport.onmessage?.(message)
      }
    })

  const startOutput = (handle: ChildProcessHandle) =>
    Effect.gen(function* () {
      yield* Effect.forkScoped(
        Stream.runForEach(handle.stdout, deliver).pipe(
          Effect.tapCause((cause) =>
            Effect.sync(() => {
              const error = Cause.squash(cause)
              transport.onerror?.(error instanceof Error ? error : new Error(String(error)))
            }),
          ),
          Effect.ignore,
          // stdout ending means the server is gone; the SDK transport reports that the same way.
          Effect.ensuring(
            Effect.gen(function* () {
              const unexpected = state.phase !== "closed"
              if (unexpected) yield* Effect.promise(close)
              transport.onclose?.()
            }),
          ),
        ),
      )

      // StdioClientTransport pipes stderr into a stream nobody reads. Drain chunks into the debug
      // log so chatty servers cannot stall and newline-free output is not buffered without bound.
      yield* Effect.forkScoped(
        handle.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((output) =>
            output.trim() === ""
              ? Effect.void
              : Effect.logDebug("mcp server stderr", { server: options.server, output }),
          ),
          Effect.ignore,
        ),
      )
    })

  return transport
})
