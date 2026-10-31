export * as McpStdio from "./stdio.js"

import { deserializeMessage, serializeMessage, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/client"
import { Cause, Duration, Effect, Fiber, Option, Queue, Result, Scope, Stream } from "effect"
import { ChildProcess } from "effect/process"
import type { ChildProcessHandle } from "effect/process/ChildProcessSpawner"
import { Environment } from "../environment/index.js"

/** Mirrors StdioClientTransport: wait this long for a graceful exit after stdin closes. */
const CLOSE_GRACE = Duration.seconds(2)

/** Mirrors StdioClientTransport: escalate SIGTERM to SIGKILL after this long. */
const FORCE_KILL_AFTER = Duration.seconds(2)
const OUTGOING_CAPACITY = 64
const MAX_FRAME_BYTES = 16 * 1024 * 1024
// An unexpected exit is reported with its exit code and the end of stderr, which usually names the cause.
const EXIT_WAIT = Duration.seconds(1)
const STDERR_TAIL = 1_000

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
  const state: { phase: "ready" | "starting" | "open" | "closed"; handle?: ChildProcessHandle } = { phase: "ready" }
  let startup: Promise<void> | undefined
  let closing: Promise<void> | undefined
  // Bytes of the unterminated line, kept as chunk views and joined once its newline arrives.
  let pending: Array<Uint8Array> = []
  let pendingBytes = 0
  const decoder = new TextDecoder()
  let stderr = ""

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
        pending = []
        pendingBytes = 0
        Queue.endUnsafe(outgoing)
        if (startup) yield* Effect.promise(() => startup!.catch(() => undefined))
        const handle = state.handle
        if (!handle) return
        state.handle = undefined
        yield* stop(handle)
      }).pipe(Effect.ensuring(Queue.shutdown(outgoing))),
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

  const deliver = (chunk: Uint8Array) => {
    let start = 0
    let newline = chunk.indexOf(10)
    while (newline !== -1 && state.phase !== "closed") {
      const line = chunk.subarray(start, newline)
      const size = pendingBytes + line.length
      if (size > MAX_FRAME_BYTES) return oversized()
      receive(pending.length === 0 ? line : Buffer.concat([...pending, line], size))
      pending = []
      pendingBytes = 0
      start = newline + 1
      newline = chunk.indexOf(10, start)
    }
    if (start === chunk.length || state.phase === "closed") return
    pendingBytes += chunk.length - start
    if (pendingBytes > MAX_FRAME_BYTES) return oversized()
    // A view is enough: the runtime hands out a fresh buffer for every pipe read.
    pending.push(start === 0 ? chunk : chunk.subarray(start))
  }

  const receive = (line: Uint8Array) => {
    const text = decoder.decode(line.at(-1) === 13 ? line.subarray(0, -1) : line)
    if (text.trim() === "") return
    const message = Result.try({
      try: () => deserializeMessage(text),
      catch: (cause) => new Error(`Invalid MCP stdio message from ${options.server}: ${cause}`, { cause }),
    })
    if (Result.isFailure(message)) return transport.onerror?.(message.failure)
    transport.onmessage?.(message.success)
  }

  // Closing fails every pending request at once rather than leaving the one this line answered waiting.
  const oversized = () => {
    transport.onerror?.(
      new Error(`MCP server ${options.server} wrote more than 16 MiB to stdout without a message boundary`),
    )
    void close()
  }

  const startOutput = (handle: ChildProcessHandle) =>
    Effect.gen(function* () {
      // Drain stderr into the debug log so chatty servers cannot stall on a full pipe.
      const drain = yield* Effect.forkScoped(
        handle.stderr.pipe(
          Stream.decodeText(),
          Stream.tap((output) => Effect.sync(() => (stderr = (stderr + output).slice(-STDERR_TAIL)))),
          Stream.runForEach((output) =>
            output.trim() === ""
              ? Effect.void
              : Effect.logDebug("mcp server stderr", { server: options.server, output }),
          ),
          Effect.ignore,
        ),
      )

      yield* Effect.forkScoped(
        Stream.runForEach(handle.stdout, (chunk) => Effect.sync(() => deliver(chunk))).pipe(
          Effect.tapCause((cause) =>
            Effect.sync(() => {
              const error = Cause.squash(cause)
              transport.onerror?.(error instanceof Error ? error : new Error(String(error)))
            }),
          ),
          Effect.ignore,
          // stdout ending means the server is gone.
          Effect.ensuring(
            Effect.gen(function* () {
              const unexpected = state.phase !== "closed"
              if (unexpected) {
                // stdout can end before the final stderr output has been read.
                const code = yield* Fiber.await(drain).pipe(
                  Effect.andThen(handle.exitCode),
                  Effect.timeoutOption(EXIT_WAIT),
                  Effect.orElseSucceed(() => Option.none()),
                )
                const exited = Option.match(code, {
                  onNone: () => "MCP server process exited",
                  onSome: (code) => `MCP server process exited with code ${code}`,
                })
                const output = stderr.trim()
                transport.onerror?.(new Error(output ? `${exited}: ${output}` : exited))
                yield* Effect.promise(close)
              }
              transport.onclose?.()
            }),
          ),
        ),
      )
    })

  return transport
})
