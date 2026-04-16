// WebSocket transport for VercelBackend.execStream. Each call opens a
// dedicated socket to the in-sandbox gateway daemon (source at
// script/sandbox-image/gateway/gateway.js, baked into the image) and
// translates the Effect Sink/Stream of ExecStreamHandle into
// send/receive frames. Gateway bootstrap is lazy per sandbox and cached.

import { Cause, Deferred, Effect, Queue, Sink, Stream } from "effect"
import { randomBytes } from "node:crypto"
import { AsyncResource } from "node:async_hooks"
import type { Sandbox } from "@vercel/sandbox"
import { Workspace as WorkspaceErrors } from "../errors"
import type { Workspace } from "../types"
// The gateway is a globally-installed npm package inside the sandbox
// image (see `script/sandbox-image/build.ts`). Its `bin` field publishes
// the `opencode-gateway` command onto the sandbox PATH, so the client
// calls it by name — no filesystem paths, no NODE_PATH.
const GATEWAY_BIN = "opencode-gateway"

export interface GatewayState {
  readonly token: string
  readonly healthUrl: string
  readonly execUrl: string
}

// One cache per (sandbox, backend instance). Keyed by the sandbox's
// `sandboxId` string so two VercelBackend.make calls targeting the
// same sandbox share the same gateway without double-bootstrapping.
const gatewayCache = new Map<string, Promise<GatewayState>>()

const wrap =
  (method: string, p?: string) =>
  (cause: unknown): WorkspaceErrors.BackendError =>
    new WorkspaceErrors.BackendError({
      backend: "vercel",
      method,
      path: p,
      cause: cause instanceof Error ? cause : new Error(String(cause)),
    })

// Path inside the sandbox where the gateway's current auth token is
// stored. The token MUST be recoverable across opencode processes that
// share a sandbox, because the gateway's `GATEWAY_TOKEN` env is fixed
// at spawn time and a second process running on the same sandbox sees
// a stale gateway (port 3000 already bound) with a token only the
// first process knew. Persisting the token into the sandbox FS lets
// any subsequent client reuse the running gateway.
const GATEWAY_TOKEN_PATH = "/tmp/opencode-gateway-token"

export const ensureGateway = (sb: Sandbox): Promise<GatewayState> => {
  // Cache key: the sandbox's public `name` getter. One gateway per
  // sandbox; two backends pointing at the same sandbox share it.
  const sbId = sb.name
  const cached = gatewayCache.get(sbId)
  if (cached) return cached

  const bootstrap = (async (): Promise<GatewayState> => {
    const domain = sb.domain(3000)
    const healthUrl = domain + "/health"
    const execUrl = domain.replace(/^http/, "ws") + "/exec"

    // Fast path: a gateway may already be running from a previous
    // opencode process on the same persistent sandbox. If `/health`
    // answers, read the token the running gateway wrote to
    // `GATEWAY_TOKEN_PATH` via a shell command (the sandbox SDK's
    // `writeFiles`/`readFileToBuffer` reject paths outside the
    // worktree with HTTP 400, so all token FS I/O goes through shell).
    const readExistingToken = async (): Promise<string | null> => {
      try {
        const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) })
        if (res.status !== 200) return null
        if ((await res.text()).trim() !== "ok") return null
      } catch {
        return null
      }
      try {
        const finished = await sb.runCommand({ cmd: "cat", args: [GATEWAY_TOKEN_PATH] } as any)
        if ((finished as { exitCode?: number }).exitCode !== 0) return null
        const out = (await (finished as { stdout(): Promise<string> }).stdout()).trim()
        return out.length > 0 ? out : null
      } catch {
        return null
      }
    }

    const existingToken = await readExistingToken()
    if (existingToken !== null) {
      return { token: existingToken, healthUrl, execUrl }
    }
    // Cold bootstrap: no gateway answering /health, or no valid token
    // file. Replace whatever may still be bound to :3000 and launch a
    // fresh gateway with a fresh token (persisted for future reuse).

    // Cold path: launch a fresh gateway. Run three steps atomically
    // inside a single shell invocation so there is no window where
    // port 3000 is half-free and no race between kill / write / spawn:
    //
    //   1. kill any straggler bound to :3000 (by port, not pname — a
    //      shell arg could otherwise match its own grep string)
    //   2. write the token to GATEWAY_TOKEN_PATH atomically
    //   3. `exec` the gateway so the shell PID is replaced by the
    //      gateway PID; `detached: true` keeps it alive after the
    //      runCommand call returns.
    //
    // Tokens are passed via env (the shell script only references
    // `$GATEWAY_TOKEN`), so nothing token-related ends up in `/proc/PID/cmdline`.
    const token = randomBytes(24).toString("hex")
    const launch = [
      `pids=$(ss -lntp 2>/dev/null | awk '/:3000 /{print $NF}' | grep -oE 'pid=[0-9]+' | cut -d= -f2)`,
      `if [ -n "$pids" ]; then kill -9 $pids 2>/dev/null || true; sleep 0.2; fi`,
      `printf '%s' "$GATEWAY_TOKEN" > ${JSON.stringify(GATEWAY_TOKEN_PATH)}`,
      `exec ${GATEWAY_BIN}`,
    ].join("; ")
    await sb.runCommand({
      cmd: "bash",
      args: ["-c", launch],
      env: {
        GATEWAY_TOKEN: token,
      },
      detached: true,
    } as any)

    // Poll /health until 200.
    const deadline = Date.now() + 30_000
    let lastErr: unknown = null
    while (Date.now() < deadline) {
      try {
        const res = await fetch(healthUrl)
        if (res.status === 200 && (await res.text()).trim() === "ok") {
          return { token, healthUrl, execUrl }
        }
      } catch (err) {
        lastErr = err
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error(
      `gateway never became healthy at ${healthUrl}${lastErr ? `: ${String(lastErr)}` : ""}`,
    )
  })()

  // Cache the promise. On failure, evict so the next call can retry.
  bootstrap.catch(() => {
    gatewayCache.delete(sbId)
  })
  gatewayCache.set(sbId, bootstrap)
  return bootstrap
}

// ---------- exec channel ----------

interface SpawnSpec {
  readonly cmd: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly env?: Record<string, string>
}

/**
 * Open an exec channel over the hardened gateway and return a
 * Workspace.ExecStreamHandle. The returned Effect is scoped: closing
 * its scope kills the child process and the socket.
 */
export const openExecChannel = (
  sb: Sandbox,
  spec: SpawnSpec,
): Effect.Effect<Workspace.ExecStreamHandle, WorkspaceErrors.BackendError, import("effect/Scope").Scope> =>
  Effect.gen(function* () {
    const gw = yield* Effect.tryPromise({
      try: () => ensureGateway(sb),
      catch: wrap("execStream.gateway"),
    })

    // One queue per output channel. `all` interleaves both.
    const stdoutQueue = yield* Queue.unbounded<Uint8Array, WorkspaceErrors.BackendError | Cause.Done>()
    const stderrQueue = yield* Queue.unbounded<Uint8Array, WorkspaceErrors.BackendError | Cause.Done>()
    const allQueue = yield* Queue.unbounded<Uint8Array, WorkspaceErrors.BackendError | Cause.Done>()
    const exitDeferred = yield* Deferred.make<number | null, WorkspaceErrors.BackendError>()

    // Shared state for the socket lifecycle.
    type State = "pending" | "authed" | "spawned" | "closed"
    let state: State = "pending"
    let closeReason: WorkspaceErrors.BackendError | null = null
    const endAllQueues = () => {
      Queue.endUnsafe(stdoutQueue)
      Queue.endUnsafe(stderrQueue)
      Queue.endUnsafe(allQueue)
    }

    // VercelBackend mirrors LocalBackend's semantics: `handle.exitCode`
    // MUST only resolve after `handle.all` has been fully drained by
    // its consumer. Otherwise the bash tool's `Effect.raceAll` sees
    // exit while forked stream consumers still have items in-flight,
    // and the scope-close races through, dropping the final bytes.
    //
    // Node's ChildProcess gives us that invariant for free (its
    // "close" event fires after stdio is drained). For WebSocket
    // frames we enforce it at the exitCode seam itself: the "exit"
    // message handler just stores the code, and `handle.exitCode`
    // is a polling Effect that yields the scheduler each tick and
    // returns only when (a) the exit code is known AND (b) every
    // queue has been fully drained by its consumer. No timeouts:
    // cooperative scheduling drains the queues inside a finite
    // number of scheduler ticks.
    let pendingExit: { code: number | null } | null = null

    // Open the WebSocket and wait for readyState = OPEN.
    //
    // WebSocket event listeners (`message`, `close`, `error`) fire from
    // Node's native event loop, outside any AsyncLocalStorage frame. On
    // remote substrates the fiber that called into the backend resumes
    // from those native callbacks via `Deferred.doneUnsafe(...)`, and
    // its continuation runs in an empty ALS context — which breaks
    // opencode business logic that reads `Instance.current` (or any
    // other `LocalContext`) after the await.
    //
    // Capture the CURRENT async resource while we're still inside the
    // Effect fiber (with ALS intact) and restore it around every
    // callback body. This is platform-level, substrate-agnostic, and
    // preserves every active `AsyncLocalStorage` store — not just
    // opencode's `instance` one — so any business-logic `LocalContext`
    // sees the same view as it would on LocalBackend.
    const channelRes = new AsyncResource("vercel-exec-channel")
    const bindCb = <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) =>
        channelRes.runInAsyncScope(fn, undefined, ...args)

    const socket = yield* Effect.tryPromise({
      try: () =>
        new Promise<WebSocket>((resolve, reject) => {
          const ws = new WebSocket(gw.execUrl)
          const t = setTimeout(() => reject(new Error("exec ws open timeout")), 15_000)
          ws.addEventListener(
            "open",
            () => {
              clearTimeout(t)
              resolve(ws)
            },
            { once: true },
          )
          ws.addEventListener(
            "error",
            () => {
              clearTimeout(t)
              reject(new Error("exec ws error on open"))
            },
            { once: true },
          )
        }),
      catch: wrap("execStream.open"),
    })

    const sendJson = (obj: unknown) => {
      try {
        socket.send(JSON.stringify(obj))
      } catch (err) {
        closeReason = wrap("execStream.send")(err)
      }
    }

    // Drive the socket: auth, spawn, then pump bytes.
    const authOkDeferred = yield* Deferred.make<void, WorkspaceErrors.BackendError>()
    const readyDeferred = yield* Deferred.make<void, WorkspaceErrors.BackendError>()

    socket.addEventListener("message", bindCb((evt: MessageEvent) => {
      let msg: any
      try {
        msg = JSON.parse(typeof evt.data === "string" ? evt.data : evt.data.toString())
      } catch {
        return
      }
      if (msg.type === "auth-ok") {
        Deferred.doneUnsafe(authOkDeferred, Effect.void)
        return
      }
      if (msg.type === "ready") {
        Deferred.doneUnsafe(readyDeferred, Effect.void)
        return
      }
      if (msg.type === "stdout" && typeof msg.data === "string") {
        const bytes = new Uint8Array(Buffer.from(msg.data, "base64"))
        Queue.offerUnsafe(stdoutQueue, bytes)
        Queue.offerUnsafe(allQueue, bytes)
        return
      }
      if (msg.type === "stderr" && typeof msg.data === "string") {
        const bytes = new Uint8Array(Buffer.from(msg.data, "base64"))
        Queue.offerUnsafe(stderrQueue, bytes)
        Queue.offerUnsafe(allQueue, bytes)
        return
      }
      if (msg.type === "exit") {
        const code = typeof msg.code === "number" ? msg.code : null
        // Store the exit code and signal that an exit frame has
        // arrived. `handle.exitCode` parks on `exitDeferred` until
        // now, then polls the queue sizes until the forked consumer
        // has drained every pending byte. End the queues so the
        // consumer's `Stream.fromQueue` terminates naturally.
        pendingExit = { code }
        Deferred.doneUnsafe(exitDeferred, Effect.succeed(code))
        endAllQueues()
        state = "closed"
        return
      }
      if (msg.type === "error") {
        const err = wrap("execStream.gateway-error")(new Error(String(msg.message ?? "unknown")))
        closeReason = err
        Deferred.doneUnsafe(authOkDeferred, Effect.fail(err))
        Deferred.doneUnsafe(readyDeferred, Effect.fail(err))
        Deferred.doneUnsafe(exitDeferred, Effect.fail(err))
        Queue.failCauseUnsafe(stdoutQueue, Cause.fail(err))
        Queue.failCauseUnsafe(stderrQueue, Cause.fail(err))
        Queue.failCauseUnsafe(allQueue, Cause.fail(err))
        return
      }
    }))

    socket.addEventListener("close", bindCb(() => {
      // Synthesize a null exit if we didn't get an explicit exit
      // frame before the socket dropped. Unblock `exitDeferred` so
      // the polling loop in `handle.exitCode` can start draining.
      state = "closed"
      if (pendingExit === null) {
        pendingExit = { code: null }
        Deferred.doneUnsafe(exitDeferred, Effect.succeed(null))
      }
      endAllQueues()
    }))

    socket.addEventListener("error", bindCb(() => {
      const err = wrap("execStream.socket-error")(new Error("websocket error"))
      closeReason = err
      Deferred.doneUnsafe(exitDeferred, Effect.fail(err))
      Queue.failCauseUnsafe(stdoutQueue, Cause.fail(err))
      Queue.failCauseUnsafe(stderrQueue, Cause.fail(err))
      Queue.failCauseUnsafe(allQueue, Cause.fail(err))
      endAllQueues()
    }))

    // Authenticate.
    sendJson({ type: "auth", token: gw.token })
    yield* Deferred.await(authOkDeferred).pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.fail(wrap("execStream.auth")(new Error("auth-ok timeout"))),
      }),
    )
    state = "authed"

    // Spawn the child process.
    sendJson({
      type: "spawn",
      cmd: spec.cmd,
      args: spec.args,
      cwd: spec.cwd,
      env: spec.env,
    })
    yield* Deferred.await(readyDeferred).pipe(
      Effect.timeoutOrElse({
        duration: "10 seconds",
        orElse: () => Effect.fail(wrap("execStream.ready")(new Error("ready timeout"))),
      }),
    )
    state = "spawned"

    // Finalizer: close the socket and kill the child on scope close.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        try {
          if (state !== "closed") sendJson({ type: "kill" })
        } catch {}
        try {
          socket.close()
        } catch {}
      }),
    )

    // ---- Build the handle ----

    // Write each chunk as a `stdin` frame; when the upstream Stream
    // finishes (the source is exhausted / its Queue is ended), send
    // `stdin-close` so the child sees EOF and exits cleanly. This
    // matches the natural Sink lifecycle: a single Stream.run(source,
    // sink) is one end-to-end write session.
    //
    // For incremental / bidirectional I/O (LSP), the correct pattern
    // is ONE long-lived Stream.run whose source is a Queue that the
    // caller feeds over the session's lifetime. When the caller wants
    // the child to terminate gracefully, it closes the queue; the
    // Sink's ensuring clause then fires stdin-close, and the handle's
    // exitCode resolves. Callers that need to write AND then keep the
    // child alive without EOF should not end their upstream stream.
    const stdinSink: Sink.Sink<void, Uint8Array, never, WorkspaceErrors.BackendError> = Sink.forEach(
      (chunk: Uint8Array) =>
        Effect.sync(() => {
          sendJson({
            type: "stdin",
            data: Buffer.from(chunk).toString("base64"),
          })
        }),
    ).pipe(
      Sink.ensuring(
        Effect.sync(() => {
          if (state !== "closed") sendJson({ type: "stdin-close" })
        }),
      ),
    )

    // `handle.exitCode` is a single cooperative-polling loop that
    // returns only when (a) the exit code is known (either the
    // gateway sent an `exit` frame or the socket dropped) AND (b)
    // every stream queue has been fully drained by its consumer.
    // Each iteration yields the scheduler so the forked consumer
    // fiber (created by the caller e.g. bash.ts's forkScoped
    // Stream.runForEach) gets ticks to pump through pending items.
    //
    // This matches LocalBackend's native semantics: Node's
    // ChildProcess fires 'close' AFTER stdio is drained, so
    // `handle.exitCode` on local naturally waits for drain. For
    // WebSocket frames we emulate the same guarantee here.
    //
    // See `script/probe-queue-stream.ts` for the minimal
    // reproduction demonstrating why bare `Deferred.await` drops
    // frames under the `Effect.forkScoped + Stream.runForEach +
    // Effect.raceAll` pattern bash.ts uses.
    const exitCodeEffect: Effect.Effect<number | null, WorkspaceErrors.BackendError> = Effect.gen(
      function* () {
        while (true) {
          if (closeReason !== null) return yield* Effect.fail(closeReason)
          if (pendingExit !== null) {
            // Wait only for `allQueue` to drain. `stdoutQueue` and
            // `stderrQueue` are duplicates of the same bytes for
            // callers that prefer per-stream consumption; whether
            // they're drained is the caller's concern. Checking all
            // three would deadlock any caller that only subscribes
            // to one of them (the bash tool reads `handle.all`).
            const allSize = yield* Queue.size(allQueue)
            if (allSize <= 0) {
              return pendingExit.code
            }
          }
          // Yield a macrotask to the Node event loop so WebSocket
          // `message` events can fire and the forked consumer fiber
          // gets a chance to drain. `Effect.yieldNow` (microtask-
          // only) would starve both.
          yield* Effect.sleep("1 millis")
        }
      },
    )

    const handle: Workspace.ExecStreamHandle = {
      stdin: stdinSink,
      stdout: Stream.fromQueue(stdoutQueue),
      stderr: Stream.fromQueue(stderrQueue),
      all: Stream.fromQueue(allQueue),
      exitCode: exitCodeEffect,
      kill: Effect.sync(() => {
        sendJson({ type: "kill" })
      }),
    }
    return handle
  })
