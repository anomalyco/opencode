import { createHash } from "node:crypto"
import { Cause, Effect, Fiber, Queue, Stream } from "effect"
import { Sandbox } from "@vercel/sandbox"
import { Workspace as WorkspaceErrors } from "../errors"
import type { Workspace } from "../types"
import { openExecChannel } from "./vercel-exec-channel"
import { Log } from "@/util/log"

const log = Log.create({ service: "vercel-backend" })

export namespace VercelBackend {
  export interface Config {
    readonly token: string
    readonly teamId: string
    readonly projectId: string
    /** Tenant key; hashed to derive sandbox name. */
    readonly directory: string
    /** Sandbox image snapshot ID. Undefined → blank AL2023 sandbox. */
    readonly snapshotId?: string
    /** Idle timeout in ms. Default 30 min. */
    readonly timeoutMs?: number
    /** VM-side workspace root. Default "/vercel/sandbox". */
    readonly worktree?: string
    /** Polling interval for `watch`. Default 2000 ms. */
    readonly watchPollMs?: number
  }

  const BACKEND_ID = "vercel"
  const DEFAULT_WORKTREE = "/vercel/sandbox"
  const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
  const DEFAULT_WATCH_POLL_MS = 2000

  /**
   * Deterministic sandbox name from a tenant directory.
   *
   * Hashing `directory` rather than passing it through verbatim:
   *   - keeps the name within Vercel's character constraints (lowercase
   *     alnum + `-`, length cap)
   *   - guarantees uniqueness across tenants without leaking the
   *     gateway's tenant scheme into Vercel's UI
   */
  export const nameFor = (directory: string): string =>
    `oc-${createHash("sha1").update(directory).digest("hex").slice(0, 20)}`

  // ------------- error wrappers -------------

  const toBackendError =
    (method: string, p?: string) =>
    (cause: unknown): WorkspaceErrors.BackendError =>
      new WorkspaceErrors.BackendError({
        backend: BACKEND_ID,
        method,
        path: p,
        cause: cause instanceof Error ? cause : new Error(String(cause)),
      })

  // ------------- shell helpers -------------

  /** Wrap an arbitrary string for safe inclusion inside single quotes. */
  const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

  /**
   * Parse `stat -c "%F|%s|%Y" path` output into a FileInfo.
   *
   * Coreutils `%F` returns one of:
   *   "regular file" | "regular empty file" | "directory" |
   *   "symbolic link" | "character special file" | ...
   */
  const parseStatLine = (line: string): Workspace.FileInfo | null => {
    const parts = line.split("|")
    if (parts.length < 3) return null
    const [kind, sizeStr, mtimeStr] = parts
    let type: Workspace.FileType = "other"
    if (kind.includes("directory")) type = "directory"
    else if (kind.includes("symbolic link")) type = "symlink"
    else if (kind.includes("regular")) type = "file"
    const size = Number(sizeStr)
    const mtimeSec = Number(mtimeStr)
    return {
      type,
      size: Number.isFinite(size) ? size : 0,
      mtime: Number.isFinite(mtimeSec) && mtimeSec > 0 ? new Date(mtimeSec * 1000) : null,
    }
  }

  // ------------- backend factory -------------

  export const make = (config: Config): Effect.Effect<Workspace.Backend> =>
    Effect.sync(() => {
      const rootPath = config.worktree ?? DEFAULT_WORKTREE
      const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const watchPollMs = config.watchPollMs ?? DEFAULT_WATCH_POLL_MS
      const sandboxName = nameFor(config.directory)

      const credentials = {
        token: config.token,
        teamId: config.teamId,
        projectId: config.projectId,
      }

      // ---- lazy sandbox resolution ----

      let sandboxPromise: Promise<Sandbox> | null = null

      const getSandbox = (): Promise<Sandbox> => {
        if (sandboxPromise) return sandboxPromise
        sandboxPromise = (async () => {
          try {
            return await Sandbox.get({ name: sandboxName, ...credentials })
          } catch (err: any) {
            // The SDK throws ApiError-shaped objects with a `status` /
            // `code`. 404 means "no such sandbox" — create one.
            const status = err?.status ?? err?.statusCode ?? err?.response?.status
            const code = err?.code ?? err?.error?.code
            const isNotFound =
              status === 404 ||
              code === "not_found" ||
              code === "sandbox_not_found" ||
              /not.?found/i.test(String(err?.message ?? ""))
            if (!isNotFound) {
              sandboxPromise = null
              throw err
            }
            const createParams: Parameters<typeof Sandbox.create>[0] = {
              name: sandboxName,
              persistent: true,
              timeout: timeoutMs,
              // :3000 hosts the exec gateway. Ports are fixed at
              // sandbox-create time, so declare up-front even when the
              // current session doesn't need execStream.
              ports: [3000],
              ...credentials,
            } as Parameters<typeof Sandbox.create>[0]
            if (config.snapshotId) {
              ;(createParams as any).source = { type: "snapshot", snapshotId: config.snapshotId }
            }
            return await Sandbox.create(createParams)
          }
        })()
        // Reset on hard failure so a future call may retry; resolved
        // value is cached forever.
        sandboxPromise.catch(() => {
          sandboxPromise = null
        })
        return sandboxPromise
      }

      // ---- keepalive throttle ----

      let lastExtend = 0
      const KEEPALIVE_INTERVAL = Math.max(30_000, Math.floor(timeoutMs / 4))
      const maybeExtend = async (sb: Sandbox): Promise<void> => {
        const now = Date.now()
        if (now - lastExtend < KEEPALIVE_INTERVAL) return
        lastExtend = now
        try {
          await sb.extendTimeout(timeoutMs)
        } catch (err) {
          log.error("extendTimeout failed", {
            sandbox: sandboxName,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      const withSandbox = <A>(
        method: string,
        p: string | undefined,
        fn: (sb: Sandbox) => Promise<A>,
      ): Effect.Effect<A, WorkspaceErrors.BackendError> =>
        Effect.tryPromise({
          try: async () => {
            const sb = await getSandbox()
            // Fire-and-forget keepalive so primitives stay fast.
            maybeExtend(sb).catch(() => {})
            return await fn(sb)
          },
          catch: toBackendError(method, p),
        })

      // ---- host→sandbox path aliasing ----
      //
      // opencode business logic treats `Instance.directory` (a host-
      // side canonical path, e.g. `/private/var/folders/.../oc-proof-…`)
      // as the absolute root of the agent's workspace. On LocalBackend
      // that path IS the workspace. On VercelBackend the real workspace
      // lives at `rootPath` (e.g. `/vercel/sandbox`) inside the sandbox
      // filesystem, so any inbound path rooted under the host
      // Instance.directory is an alias for the same location under
      // rootPath.
      //
      // The backend is the only layer allowed to know both identifiers,
      // so the translation lives here. Every primitive that takes a
      // path forwards it through `mapPath` before touching the sandbox
      // SDK. Paths not rooted under the alias pass through unchanged
      // (absolute sandbox-local paths are legal too).
      const hostDir = config.directory.replace(/\/+$/, "")
      const mapPath = (p: string | undefined): string | undefined => {
        if (p === undefined) return undefined
        if (p === hostDir) return rootPath
        if (p.startsWith(hostDir + "/")) return rootPath + p.slice(hostDir.length)
        return p
      }

      // ---- raw shell helper used by stat/readDir/exists/remove/rename/mkDir ----

      const runShell = async (
        sb: Sandbox,
        script: string,
      ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        const finished = await sb.runCommand({ cmd: "bash", args: ["-lc", script] })
        const [stdout, stderr] = await Promise.all([finished.stdout(), finished.stderr()])
        return { exitCode: finished.exitCode, stdout, stderr }
      }

      // ---- fs primitives ----

      const stat: Workspace.Backend["stat"] = (p) =>
        withSandbox("stat", p, async (sb) => {
          const sp = mapPath(p)!
          const res = await runShell(sb, `stat -c '%F|%s|%Y' ${shq(sp)}`)
          if (res.exitCode !== 0) {
            throw new Error(`stat failed (${res.exitCode}): ${res.stderr.trim()}`)
          }
          const info = parseStatLine(res.stdout.trim())
          if (!info) throw new Error(`stat: unparsable output: ${res.stdout}`)
          return info
        })

      const exists: Workspace.Backend["exists"] = (p) =>
        withSandbox("exists", p, async (sb) => {
          const sp = mapPath(p)!
          const res = await runShell(sb, `test -e ${shq(sp)}`)
          return res.exitCode === 0
        })

      // `sb.readFileToBuffer` and `sb.writeFiles` only accept paths
      // inside the sandbox's worktree (the server rejects anything
      // else with HTTP 400). opencode business logic freely writes
      // outside the worktree — /tmp/, /var/, absolute paths the agent
      // chooses, etc. — and on LocalBackend that works because the
      // whole filesystem IS the host. To match that semantics we
      // detect the worktree boundary and fall back to shell I/O for
      // paths outside it.
      const inWorktree = (sp: string) => sp === rootPath || sp.startsWith(rootPath + "/")

      const readFile: Workspace.Backend["readFile"] = (p) =>
        withSandbox("readFile", p, async (sb) => {
          const sp = mapPath(p)!
          if (inWorktree(sp)) {
            const buf = await sb.readFileToBuffer({ path: sp })
            if (buf === null) throw new Error(`ENOENT: ${sp}`)
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
          }
          // Out-of-worktree fallback: `cat` + base64 to survive binary.
          const res = await runShell(sb, `base64 -w0 ${shq(sp)} 2>/dev/null || base64 ${shq(sp)}`)
          if (res.exitCode !== 0) {
            throw new Error(`readFile failed (${res.exitCode}): ${res.stderr.trim() || `ENOENT: ${sp}`}`)
          }
          // BSD `base64` wraps at 76 cols; strip whitespace before decoding.
          const b64 = res.stdout.replace(/\s+/g, "")
          return new Uint8Array(Buffer.from(b64, "base64"))
        })

      // Raw write — Backend contract is "no auto-mkdir". Consumers
      // (Workspace.Service) are responsible for creating parent
      // directories before calling this. Enforce with `test -d` first.
      const writeFile: Workspace.Backend["writeFile"] = (p, data) =>
        withSandbox("writeFile", p, async (sb) => {
          const sp = mapPath(p)!
          const slash = sp.lastIndexOf("/")
          if (slash > 0) {
            const parent = sp.slice(0, slash)
            const check = await runShell(sb, `test -d ${shq(parent)}`)
            if (check.exitCode !== 0) {
              throw new Error(`ENOENT: parent directory does not exist: ${parent}`)
            }
          }
          if (inWorktree(sp)) {
            await sb.writeFiles([{ path: sp, content: data }])
            return
          }
          // Out-of-worktree fallback. sb.writeFiles rejects paths
          // outside the worktree with HTTP 400, so stream bytes through
          // a single shell command that base64-decodes into the target.
          const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data
          const b64 = Buffer.from(bytes).toString("base64")
          const res = await runShell(
            sb,
            `printf '%s' ${shq(b64)} | base64 -d > ${shq(sp)}`,
          )
          if (res.exitCode !== 0) {
            throw new Error(`writeFile failed (${res.exitCode}): ${res.stderr.trim()}`)
          }
        })

      const mkDir: Workspace.Backend["mkDir"] = (p, opts) =>
        withSandbox("mkDir", p, async (sb) => {
          const sp = mapPath(p)!
          if (opts.recursive) {
            const res = await runShell(sb, `mkdir -p ${shq(sp)}`)
            if (res.exitCode !== 0) throw new Error(`mkdir -p failed: ${res.stderr.trim()}`)
            return
          }
          // Non-recursive: prefer the SDK helper if available.
          if (typeof (sb as { mkDir?: unknown }).mkDir === "function") {
            await (sb as { mkDir: (path: string) => Promise<void> }).mkDir(sp)
            return
          }
          const res = await runShell(sb, `mkdir ${shq(sp)}`)
          if (res.exitCode !== 0) throw new Error(`mkdir failed: ${res.stderr.trim()}`)
        })

      const readDir: Workspace.Backend["readDir"] = (p) =>
        withSandbox("readDir", p, async (sb) => {
          const sp = mapPath(p)!
          // GNU find with NUL-delimited records, format `name\ttype`
          // where `type` is one of f/d/l/etc.
          const script = `find ${shq(sp)} -mindepth 1 -maxdepth 1 -printf '%f\t%y\\0'`
          const res = await runShell(sb, script)
          if (res.exitCode !== 0) {
            throw new Error(`readDir failed (${res.exitCode}): ${res.stderr.trim()}`)
          }
          const records = res.stdout.split("\0").filter((r) => r.length > 0)
          const entries: Workspace.DirEntry[] = []
          for (const rec of records) {
            const tab = rec.lastIndexOf("\t")
            if (tab < 0) continue
            const name = rec.slice(0, tab)
            const t = rec.slice(tab + 1)
            let type: Workspace.FileType = "other"
            if (t === "f") type = "file"
            else if (t === "d") type = "directory"
            else if (t === "l") type = "symlink"
            entries.push({ name, type })
          }
          return entries
        })

      const remove: Workspace.Backend["remove"] = (p, opts) =>
        withSandbox("remove", p, async (sb) => {
          const sp = mapPath(p)!
          const flags = opts.recursive ? "-r" : ""
          const res = await runShell(sb, `rm ${flags} ${shq(sp)}`)
          if (res.exitCode !== 0) throw new Error(`rm failed: ${res.stderr.trim()}`)
        })

      const rename: Workspace.Backend["rename"] = (from, to) =>
        withSandbox("rename", from, async (sb) => {
          const sFrom = mapPath(from)!
          const sTo = mapPath(to)!
          const res = await runShell(sb, `mv ${shq(sFrom)} ${shq(sTo)}`)
          if (res.exitCode !== 0) throw new Error(`mv failed: ${res.stderr.trim()}`)
        })

      // ---- exec (one-shot, via sb.runCommand directly) ----
      //
      // L4 services (Format, Snapshot, File, FileTime, stat/readDir/
      // exists/remove/rename helpers) do dozens of one-shot exec calls
      // per operation. Routing these through the WebSocket gateway would
      // force a ~500ms handshake + auth + spawn frame per call. The
      // gateway path is reserved for `execStream` only (LSP + anything
      // needing true bidirectional I/O).
      const exec: Workspace.Backend["exec"] = (cmd, args, opts) =>
        withSandbox("exec", undefined, async (sb) => {
          const cwd = mapPath(opts?.cwd) ?? rootPath
          // `sb.runCommand` merges env with the container's default when
          // `env` is omitted; we pass it only if the caller provided one.
          const params: Parameters<typeof sb.runCommand>[0] = opts?.env
            ? ({
                cmd,
                args,
                cwd,
                env: opts.env,
              } as Parameters<typeof sb.runCommand>[0])
            : ({
                cmd,
                args,
                cwd,
              } as Parameters<typeof sb.runCommand>[0])
          const finished = await sb.runCommand(params as any)
          const [stdout, stderr] = await Promise.all([finished.stdout(), finished.stderr()])
          const result: Workspace.ExecResult = {
            exitCode: finished.exitCode ?? -1,
            stdout,
            stderr,
          }
          return result
        })

      // ---- execStream (bidirectional, via in-sandbox WebSocket gateway) ----
      //
      // True live stdio: each call opens a fresh WebSocket to the
      // in-sandbox gateway daemon, which spawns the child process and
      // pipes its real stdin/stdout/stderr over the socket. Writes to
      // the returned `stdin` Sink land in a still-alive process — LSP
      // JSON-RPC round trips work correctly.
      //
      // ExecOpts.signal and ExecOpts.timeoutMs are honoured via
      // post-composition: if a timeout is set, we race the returned
      // `exitCode` effect against a timeout; if a signal is supplied,
      // we fork a listener that triggers `handle.kill` on abort.
      const execStream: Workspace.Backend["execStream"] = (cmd, args, opts) =>
        Effect.gen(function* () {
          const sb = yield* Effect.tryPromise({
            try: () => getSandbox(),
            catch: toBackendError("execStream.getSandbox"),
          })
          maybeExtend(sb).catch(() => {})

          const baseHandle = yield* openExecChannel(sb, {
            cmd,
            args: args ?? [],
            cwd: mapPath(opts?.cwd) ?? rootPath,
            env: opts?.env,
          })

          // Feed eager opts.stdin into the Sink up-front. Callers that
          // want fully interactive I/O drive `baseHandle.stdin`
          // directly from their own Stream.
          if (opts?.stdin !== undefined) {
            const bytes =
              typeof opts.stdin === "string" ? new TextEncoder().encode(opts.stdin) : opts.stdin
            yield* Stream.fromIterable([bytes]).pipe(Stream.run(baseHandle.stdin), Effect.ignore)
          }

          // Honour ExecOpts.signal: abort → kill.
          if (opts?.signal) {
            const ext = opts.signal
            const onAbort = () => Effect.runFork(baseHandle.kill)
            if (ext.aborted) onAbort()
            else ext.addEventListener("abort", onAbort, { once: true })
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => ext.removeEventListener("abort", onAbort)),
            )
          }

          // Optional timeout: if exitCode doesn't arrive in time, kill
          // the child and surface a BackendError.
          const exitCode: Effect.Effect<number | null, WorkspaceErrors.BackendError> = opts?.timeoutMs
            ? Effect.timeoutOrElse(baseHandle.exitCode, {
                duration: `${opts.timeoutMs} millis`,
                orElse: () =>
                  Effect.gen(function* () {
                    yield* baseHandle.kill.pipe(Effect.ignore)
                    return yield* Effect.fail(
                      toBackendError("execStream.timeout")(
                        new Error(`exec timed out after ${opts.timeoutMs}ms`),
                      ),
                    )
                  }),
              })
            : baseHandle.exitCode

          const result: Workspace.ExecStreamHandle = {
            stdin: baseHandle.stdin,
            stdout: baseHandle.stdout,
            stderr: baseHandle.stderr,
            all: baseHandle.all,
            exitCode,
            kill: baseHandle.kill,
          }
          return result
        })

      // ---- watch (polling) ----

      /**
       * Polling watcher with `watchPollMs` latency (default 2000ms).
       *
       * On each tick we list the directory + stat each entry and diff
       * against the previous snapshot:
       *   - new name           → "add"
       *   - mtime/size changed → "change"
       *   - vanished name      → "unlink"
       *
       */
      const watch: Workspace.Backend["watch"] = (p, opts) =>
        Stream.callback<Workspace.FsEvent, WorkspaceErrors.BackendError>((q) =>
          Effect.gen(function* () {
            const sp = mapPath(p)!
            interface Snapshot {
              readonly mtime: number
              readonly size: number
            }
            let previous = new Map<string, Snapshot>()
            let stopped = false

            yield* Effect.addFinalizer(() => Effect.sync(() => (stopped = true)))

            // find(1) -not -path filters: one per ignore pattern. Match the
            // pattern as a substring under the watch root. Keeps the event
            // surface comparable to parcel's `ignore` list.
            const ignoreClauses = (opts?.ignore ?? [])
              .map((ig) => ` -not -path ${shq(`*/${ig}*`)} -not -path ${shq(`*/${ig}`)}`)
              .join("")

            const snapshot = async (): Promise<Map<string, Snapshot>> => {
              const sb = await getSandbox()
              const script =
                `find ${shq(sp)} -mindepth 1 -maxdepth 1 -type f${ignoreClauses} ` +
                `-printf '%f\t%s\t%T@\\0'`
              const res = await runShell(sb, script)
              const next = new Map<string, Snapshot>()
              if (res.exitCode !== 0) return next
              for (const rec of res.stdout.split("\0")) {
                if (!rec) continue
                const parts = rec.split("\t")
                if (parts.length < 3) continue
                const [name, sizeStr, mtimeStr] = parts
                next.set(name, {
                  size: Number(sizeStr) || 0,
                  mtime: Number(mtimeStr) || 0,
                })
              }
              return next
            }

            const tick = async (): Promise<void> => {
              try {
                const next = await snapshot()
                for (const [name, info] of next) {
                  const prev = previous.get(name)
                  const fullPath = `${p}/${name}`
                  if (!prev) {
                    Queue.offerUnsafe(q, { type: "add", path: fullPath })
                  } else if (prev.mtime !== info.mtime || prev.size !== info.size) {
                    Queue.offerUnsafe(q, { type: "change", path: fullPath })
                  }
                }
                for (const name of previous.keys()) {
                  if (!next.has(name)) {
                    Queue.offerUnsafe(q, { type: "unlink", path: `${p}/${name}` })
                  }
                }
                previous = next
              } catch (err) {
                Queue.failCauseUnsafe(q, Cause.fail(toBackendError("watch", p)(err)))
                stopped = true
              }
            }

            // Prime the baseline snapshot WITHOUT emitting events.
            // Any pre-existing file should not surface as an "add" on
            // the first real tick.
            previous = yield* Effect.promise(() => snapshot())

            // Spawn a polling loop on a forked fiber so the Stream
            // finalization can interrupt it cleanly.
            yield* Effect.forkScoped(
              Effect.gen(function* () {
                while (!stopped) {
                  yield* Effect.sleep(`${watchPollMs} millis`)
                  if (stopped) break
                  yield* Effect.promise(() => tick())
                }
              }),
            )
          }),
        )

      // ---- close ----

      // We deliberately do NOT stop the sandbox on `close`. The whole
      // point of `persistent: true` is that the filesystem outlives a
      // single opencode session — stopping here would defeat that. The
      // conformance runner stops sandboxes explicitly in its cleanup
      // hook so this stays a no-op.
      const close: Effect.Effect<void> = Effect.void

      const id = `${BACKEND_ID}:${sandboxName}`

      const backend: Workspace.Backend = {
        id,
        rootPath,
        // The sandbox image is Amazon Linux 2023 — zsh isn't installed
        // and only bash/sh are available. Hardcoding /bin/bash keeps
        // cross-substrate flows (macOS host driving a Linux sandbox)
        // from asking the sandbox to spawn a shell it doesn't have.
        shell: "/bin/bash",
        stat,
        exists,
        readFile,
        writeFile,
        mkDir,
        readDir,
        remove,
        rename,
        exec,
        execStream: execStream as Workspace.Backend["execStream"],
        watch,
        close,
      }
      return backend
    })
}
