export * as McpStdio from "./stdio.js"

import {
  deserializeMessage,
  ProtocolErrorCode,
  serializeMessage,
  type JSONRPCMessage,
  type Transport,
} from "@modelcontextprotocol/client"
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
// An oversized line is answered with an error only when it is a response, read from its first and
// last bytes: SDKs write the id either before the result or as the last key. Ids with escapes are
// not recognised, which only means the connection closes instead.
const RESPONSE_HEAD =
  /^\s*\{\s*(?:"jsonrpc"\s*:\s*"2\.0"\s*,\s*)?(?:"id"\s*:\s*(-?\d+|"[^"\\\u0000-\u001f]*")\s*,\s*)?"(?:result|error)"/
const TRAILING_ID = /,\s*"id"\s*:\s*(-?\d+|"[^"\\\u0000-\u001f]*")\s*\}\s*$/
const EDGE_BYTES = 256
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
  // Set once a line passed MAX_FRAME_BYTES: its remaining bytes are dropped up to the next newline.
  // A response whose id comes last keeps its final bytes in `tail` until then.
  let discarding: "line" | "response" | undefined
  let tail: Uint8Array = new Uint8Array()
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
        Queue.endUnsafe(outgoing)
        if (startup) yield* Effect.promise(() => startup!.catch(() => undefined))
        const handle = state.handle
        if (!handle) return
        state.handle = undefined
        yield* stop(handle)
      }).pipe(
        Effect.ensuring(Queue.shutdown(outgoing)),
        Effect.ensuring(
          Effect.sync(() => {
            pending = []
            pendingBytes = 0
            discarding = undefined
            tail = new Uint8Array()
          }),
        ),
      ),
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
      if (discarding === undefined && size > MAX_FRAME_BYTES) oversized(line)
      if (discarding === undefined) receive(pending.length === 0 ? line : Buffer.concat([...pending, line], size))
      if (discarding === "response") respond(TRAILING_ID.exec(decoder.decode(keepTail(line)))?.[1])
      discarding = undefined
      pending = []
      pendingBytes = 0
      start = newline + 1
      newline = chunk.indexOf(10, start)
    }
    if (start === chunk.length || state.phase === "closed") return
    const rest = chunk.subarray(start)
    if (discarding === undefined && pendingBytes + rest.length > MAX_FRAME_BYTES) oversized(rest)
    if (discarding === "response") keepTail(rest)
    if (discarding) return
    // A view is enough: the runtime hands out a fresh buffer for every pipe read.
    pending.push(rest)
    pendingBytes += rest.length
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

  const tooLarge = `MCP server ${options.server} sent a stdio message over 16 MiB`

  // Drops the line `segment` belongs to. A response fails only its own request; anything else could
  // leave a request unanswered, so the connection closes as it did before.
  const oversized = (segment: Uint8Array) => {
    transport.onerror?.(new Error(tooLarge))
    const head = RESPONSE_HEAD.exec(decoder.decode(Buffer.concat([...pending, segment], EDGE_BYTES)))
    tail = Buffer.concat(pending.slice(-EDGE_BYTES).map((part) => part.subarray(-EDGE_BYTES))).subarray(-EDGE_BYTES)
    pending = []
    pendingBytes = 0
    discarding = head && head[1] === undefined ? "response" : "line"
    if (!head) return void close()
    if (head[1] !== undefined) respond(head[1])
  }

  const keepTail = (segment: Uint8Array) =>
    (tail = Buffer.concat([tail, segment.subarray(-EDGE_BYTES)]).subarray(-EDGE_BYTES))

  const respond = (id: string | undefined) => {
    if (id === undefined) return void close()
    transport.onmessage?.({
      jsonrpc: "2.0",
      id: JSON.parse(id),
      error: { code: ProtocolErrorCode.InternalError, message: tooLarge },
    })
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
