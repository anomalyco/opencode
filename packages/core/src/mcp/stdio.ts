export * as MCPStdio from "./stdio.js"

import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js"
import { Cause, Deferred, Duration, Effect, Exit, Queue, Scope, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import { Environment } from "../environment/index.js"

/** Mirrors StdioClientTransport: wait this long for a graceful exit after stdin closes. */
const CLOSE_GRACE = Duration.seconds(2)

/** Mirrors StdioClientTransport: escalate SIGTERM to SIGKILL after this long. */
const FORCE_KILL_AFTER = Duration.seconds(2)

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
  const context = yield* Effect.context<Scope.Scope>()
  // Outgoing frames are queued rather than written to `handle.stdin` directly: the sink closes the
  // stream it is run with, and stdin must stay open across the whole session.
  const outgoing = yield* Queue.unbounded<Uint8Array, Cause.Done>()
  const encoder = new TextEncoder()
  const buffer = new ReadBuffer()
  const closed = Deferred.makeUnsafe<void>()
  const state: { started: boolean; handle?: ChildProcessHandle } = { started: false }

  const transport: Transport = {
    start: () => {
      if (state.started) return Promise.reject(new Error("Stdio transport already started"))
      state.started = true
      return Effect.runPromiseWith(context)(
        Effect.gen(function* () {
          const handle = yield* environment.spawner.spawn(
            ChildProcess.make(options.command, [...options.args], {
              cwd: options.cwd,
              env: options.environment,
              extendEnv: true,
              stdin: { stream: Stream.fromQueue(outgoing), endOnDone: true },
              stdout: "pipe",
              stderr: "pipe",
              forceKillAfter: FORCE_KILL_AFTER,
            }),
          )
          state.handle = handle
          yield* startOutput(handle)
        }),
      )
    },
    send: (message: JSONRPCMessage) =>
      Queue.offerUnsafe(outgoing, encoder.encode(serializeMessage(message)))
        ? Promise.resolve()
        : Promise.reject(new Error("Not connected")),
    close: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          Queue.endUnsafe(outgoing)
          const handle = state.handle
          if (!handle) return
          // Give the server the same chance to exit on its own that the SDK transport gives it; the
          // handle then signals the process through whichever execution driver spawned it.
          const exit = yield* Effect.timeoutOption(handle.exitCode, CLOSE_GRACE)
          if (exit._tag === "Some") return
          const terminated = yield* Effect.timeoutOption(handle.kill({ killSignal: "SIGTERM" }), FORCE_KILL_AFTER)
          if (terminated._tag === "None") yield* handle.kill({ killSignal: "SIGKILL" })
        }).pipe(Effect.ensuring(Effect.sync(() => buffer.clear())), Effect.ignore),
      ),
  }

  const deliver = (chunk: Uint8Array) =>
    Effect.gen(function* () {
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
            Effect.sync(() => {
              if (Deferred.doneUnsafe(closed, Exit.void)) transport.onclose?.()
            }),
          ),
        ),
      )

      // StdioClientTransport pipes stderr into a stream nobody reads, which both hides server
      // diagnostics and lets a chatty server stall on backpressure. Draining it into the debug log
      // keeps the pipe moving and makes the output reachable.
      yield* Effect.forkScoped(
        handle.stderr.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) =>
            line.trim() === "" ? Effect.void : Effect.logDebug("mcp server stderr", { server: options.server, line }),
          ),
          Effect.ignore,
        ),
      )
    })

  return transport
})
