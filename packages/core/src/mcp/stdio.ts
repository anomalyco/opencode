export * as McpStdio from "./stdio.js"

import { deserializeMessage, serializeMessage, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/client"
import { Cause, Duration, Effect, Queue, Scope, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import { Environment } from "../environment/index.js"

/** Mirrors StdioClientTransport: wait this long for a graceful exit after stdin closes. */
const CLOSE_GRACE = Duration.seconds(2)

/** Mirrors StdioClientTransport: escalate SIGTERM to SIGKILL after this long. */
const FORCE_KILL_AFTER = Duration.seconds(2)
const OUTGOING_CAPACITY = 64
/** Largest incoming JSON-RPC frame this transport buffers. A larger frame fails its call, not the connection. */
const MAX_FRAME_BYTES = 16 * 1024 * 1024
/** Enough of an oversized frame's head to recover the JSON-RPC id that should receive the failure. */
const FRAME_HEAD_BYTES = 4096
/** JSON-RPC server-error range; matches the code clients already surface for a broken transport. */
const FRAME_LIMIT_ERROR_CODE = -32000

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
  /** Chunks of the frame being read; `discarding` drops the remainder of an oversized one until its newline. */
  let pending: Buffer[] = []
  let pendingBytes = 0
  let discarding = false

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
      }).pipe(Effect.ensuring(Queue.shutdown(outgoing)), Effect.ensuring(Effect.sync(() => {
        pending = []
        pendingBytes = 0
      }))),
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

  // A frame over the limit must fail only its own call: recover the id from the frame head and
  // answer it with a JSON-RPC error, then keep reading so the connection and other tools survive.
  const frameId = (frame: Buffer) => {
    const match = /"id"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+)/.exec(
      frame.subarray(0, FRAME_HEAD_BYTES).toString("utf8"),
    )
    if (match === null) return undefined
    try {
      return JSON.parse(match[1]) as string | number
    } catch {
      return undefined
    }
  }

  const failOversizedFrame = (frame: Buffer, size: number) => {
    const message = `MCP stdio message of ${size} bytes exceeded the ${MAX_FRAME_BYTES} byte limit and was discarded`
    const id = frameId(frame)
    if (id === undefined) {
      transport.onerror?.(new Error(message))
      return
    }
    transport.onmessage?.({ jsonrpc: "2.0", id, error: { code: FRAME_LIMIT_ERROR_CODE, message } })
  }

  const handleFrame = (line: string) => {
    try {
      transport.onmessage?.(deserializeMessage(line))
    } catch (error) {
      // A malformed line is skipped, matching the SDK's stdio buffer; anything else is a transport error.
      if (error instanceof SyntaxError) return
      transport.onerror?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  const deliver = (chunk: Uint8Array) =>
    Effect.sync(() => {
      const bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      let start = 0
      while (start < bytes.length) {
        const newline = bytes.indexOf(10, start)
        const segment = bytes.subarray(start, newline === -1 ? bytes.length : newline)
        if (!discarding && segment.byteLength > 0) {
          // Copy so a retained partial frame never aliases a chunk the process stream may reuse.
          pending.push(Buffer.from(segment))
          pendingBytes += segment.byteLength
          if (pendingBytes > MAX_FRAME_BYTES) {
            failOversizedFrame(Buffer.concat(pending), pendingBytes)
            pending = []
            pendingBytes = 0
            discarding = true
          }
        }
        if (newline === -1) return
        if (!discarding) {
          const frame = pending.length === 1 ? pending[0] : Buffer.concat(pending)
          pending = []
          pendingBytes = 0
          handleFrame(frame.toString("utf8").replace(/\r$/, ""))
        }
        discarding = false
        start = newline + 1
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
          // stdout ending means the server is gone.
          Effect.ensuring(
            Effect.gen(function* () {
              const unexpected = state.phase !== "closed"
              if (unexpected) yield* Effect.promise(close)
              transport.onclose?.()
            }),
          ),
        ),
      )

      // Drain stderr into the debug log so chatty servers cannot stall on a full pipe.
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
