/**
 * Frontend live-preview launcher (Driver-clicks-button → dev server runs in
 * the workspace).
 *
 * One preview at a time per container.  The first session whose Driver clicks
 * "Launch" wins — concurrent attempts get 409.  The running process is
 * tracked in module-level state because the OS process is itself in-memory;
 * persisting state to SQLite would just create a sync problem.
 *
 * Lifecycle:
 *
 *   launchPreview(...)  →  pnpm install (streaming log)  →  pnpm run start
 *   stopPreview()       →  SIGTERM the child
 *   restartPreview()    →  stop + relaunch with same args
 *
 * Auto-stop triggers:
 *   - 30 min of zero `/preview/<port>/*` traffic  (idle sweep, 60s interval)
 *   - Container shutdown (process dies with us)
 *   - Collab session deleted (caller hooks cleanupSessionWorkspace)
 *   - Git HEAD changes in the workspace (caller hooks the queue executor)
 *
 * URL of the running preview: served by the existing /preview/<port>/* proxy
 * in collab/preview-router.ts.  The proxy already gates on a valid collab
 * cookie (ADR-0001), so participants — and only participants — can reach it.
 * The proxy forwards with Host: local.unleashlive.com:<port> so the dev
 * server sees its expected hostname — the container's /etc/hosts maps
 * local.unleashlive.com to 127.0.0.1 via the task definition's `extraHosts`
 * field (and docker-compose's `extra_hosts:`).
 *
 * Per-repo config: `.opencode-preview.json` in the repo root.  When absent,
 * defaults match the unleashlive/frontend setup (the zero-config case the
 * feature was built for).
 */

import { spawn, type ChildProcess } from "child_process"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { repoWorkspacePath } from "./workspace"
import type { CollabEvent } from "@opencode-ai/collab"

// ── Configuration ──────────────────────────────────────────────────────────

/** Frontend defaults — applied when no `.opencode-preview.json` is present. */
const FRONTEND_DEFAULTS: PreviewConfig = {
  installCommand: "pnpm i --shamefully-hoist=true",
  command: "pnpm run start",
  port: 8080,
  label: "Unleash live frontend",
  readyPattern: undefined,
}

/** Idle window — no traffic for this long → SIGTERM. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000

/** How often the idle sweep runs. */
const SWEEP_INTERVAL_MS = 60 * 1000

/** Cap on retained install / run log lines (so memory is bounded across a
 *  long-running session). */
const LOG_LINES_RETAINED = 200

// ── Types ──────────────────────────────────────────────────────────────────

export interface PreviewConfig {
  /** Shell command for first-launch dep install.  Run via `sh -c`. */
  readonly installCommand?: string
  /** Shell command that starts the dev server bound to a port. */
  readonly command: string
  /** Port the dev server binds to inside the container.  Used by
   *  /preview/<port>/* to find the upstream. */
  readonly port: number
  /** Button + status-banner label in the SPA. */
  readonly label: string
  /** Regex on stdout; first match flips status → "running".  When undefined
   *  we treat the process as "running" 2s after spawn (best-effort). */
  readonly readyPattern?: string
}

export type PreviewStatus = "installing" | "running" | "stopped" | "failed"

export interface PreviewStateSnapshot {
  readonly collabSessionId: string
  readonly repoFullName: string
  readonly port: number
  readonly label: string
  readonly status: PreviewStatus
  readonly startedAt: number
  readonly lastTraffic: number
  /** Last N lines of combined stdout+stderr — for the install/run UI. */
  readonly recentLog: ReadonlyArray<{ stream: "stdout" | "stderr"; line: string; ts: number }>
  readonly errorMessage?: string
}

interface ActiveState extends PreviewStateSnapshot {
  child: ChildProcess
  config: PreviewConfig
  // Mutable accumulators (not snapshot-able directly)
  _log: Array<{ stream: "stdout" | "stderr"; line: string; ts: number }>
  /** True iff stopPreview was called for THIS state (vs the process exiting
   *  on its own).  Lets the exit handler decide between firing
   *  collab:preview_stopped (clean exit we triggered) vs collab:preview_failed
   *  (unexpected death) vs collab:preview_stopped (clean exit we did NOT
   *  trigger — e.g. a dev server with a `--build` flag that finishes
   *  building and exits naturally). */
  _stopRequested: boolean
}

// ── Module state (singleton — "first-launch wins") ─────────────────────────

let active: ActiveState | null = null
let sweepTimer: ReturnType<typeof setInterval> | null = null
/**
 * Pending restart timer.  restartPreview defers the inner launchPreview by
 * 100 ms so the OS port releases cleanly between stop and re-bind.  If
 * something stops the preview (session delete, container shutdown, another
 * stopPreview) during that 100 ms window, we must cancel this timer or the
 * deferred launch fires against a workspace that may no longer exist —
 * surfacing as a confusing "Preview failed: Workspace for X not cloned yet"
 * for a session the user already deleted.
 */
let pendingRestart: ReturnType<typeof setTimeout> | null = null

/**
 * SSE broadcaster injected from router.ts.  Avoids a circular import; the
 * router calls `setPreviewBroadcaster(broadcastSse)` once at startup.
 */
type Broadcaster = (collabSessionId: string, event: CollabEvent) => void
let broadcast: Broadcaster = () => {}

export function setPreviewBroadcaster(fn: Broadcaster): void {
  broadcast = fn
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Read `.opencode-preview.json` from the repo workspace.  Returns the
 * frontend defaults when the file is absent or invalid.
 */
export function previewConfigForRepo(
  collabSessionId: string,
  repoFullName: string,
): PreviewConfig {
  const path = join(repoWorkspacePath(collabSessionId, repoFullName), ".opencode-preview.json")
  if (!existsSync(path)) return FRONTEND_DEFAULTS
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<PreviewConfig>
    if (typeof raw.command !== "string" || typeof raw.port !== "number") {
      console.warn(`[collab.preview] ${path} missing required command/port — using defaults`)
      return FRONTEND_DEFAULTS
    }
    // Validate port range.  Outside 1024-65535 is either privileged (will
    // fail to bind as uid 10001) or an outright invalid TCP port.  Reject
    // and fall back to defaults so a typo in the config doesn't ship a
    // confusing EACCES / EINVAL error to the SPA.
    if (!Number.isInteger(raw.port) || raw.port < 1024 || raw.port > 65535) {
      console.warn(
        `[collab.preview] ${path} port=${raw.port} outside 1024-65535 — using defaults`,
      )
      return FRONTEND_DEFAULTS
    }
    // Validate readyPattern compiles.  An invalid regex would throw at
    // first stdout line in wireChildStreams; better to surface it now
    // and fall back to the built-in heuristic.
    let readyPattern: string | undefined = undefined
    if (typeof raw.readyPattern === "string") {
      try {
        new RegExp(raw.readyPattern)
        readyPattern = raw.readyPattern
      } catch (e) {
        console.warn(`[collab.preview] ${path} readyPattern is not a valid regex; ignoring:`, e)
      }
    }
    return {
      command: raw.command,
      port: raw.port,
      label: typeof raw.label === "string" ? raw.label : FRONTEND_DEFAULTS.label,
      installCommand:
        typeof raw.installCommand === "string" ? raw.installCommand : FRONTEND_DEFAULTS.installCommand,
      readyPattern,
    }
  } catch (err) {
    console.warn(`[collab.preview] ${path} parse failed; using defaults:`, err)
    return FRONTEND_DEFAULTS
  }
}

/**
 * Decide whether a repo is "preview-capable":
 *   - The repo workspace exists (workspace init completed), AND
 *   - Either an `.opencode-preview.json` is present, OR the repo name is
 *     "frontend" (the zero-config case)
 *
 * Used by GET /collab/session/:id to flag the SPA banner / button.
 */
export function repoHasPreview(collabSessionId: string, repoFullName: string): boolean {
  const dest = repoWorkspacePath(collabSessionId, repoFullName)
  if (!existsSync(dest)) return false
  const name = repoFullName.split("/").pop() ?? repoFullName
  if (name === "frontend") return true
  return existsSync(join(dest, ".opencode-preview.json"))
}

/** Snapshot for SSE / GET state.  Drops the ChildProcess + config refs. */
export function getPreviewState(): PreviewStateSnapshot | null {
  if (!active) return null
  return {
    collabSessionId: active.collabSessionId,
    repoFullName: active.repoFullName,
    port: active.port,
    label: active.label,
    status: active.status,
    startedAt: active.startedAt,
    lastTraffic: active.lastTraffic,
    recentLog: active._log.slice(-LOG_LINES_RETAINED),
    errorMessage: active.errorMessage,
  }
}

/**
 * Bump the lastTraffic timestamp.  Hooked from preview-router.ts so the
 * idle-sweep timer knows the preview is in active use.  Cheap — single
 * timestamp write on every request.
 */
export function markPreviewTraffic(): void {
  if (active) (active as { lastTraffic: number }).lastTraffic = Date.now()
}

export type LaunchResult =
  | { ok: true; state: PreviewStateSnapshot }
  | { ok: false; status: 409; error: string; existing: PreviewStateSnapshot }
  | { ok: false; status: 400 | 404 | 500; error: string }

/**
 * Spawn the preview.  First-launch wins; second call while another preview
 * is active returns 409 with the existing state so the caller can render a
 * "already running in session X" message.
 */
export function launchPreview(
  collabSessionId: string,
  repoFullName: string,
): LaunchResult {
  if (active) {
    return {
      ok: false,
      status: 409,
      error: `Preview already running in session ${active.collabSessionId} for ${active.repoFullName}.  Ask that session's Driver to stop it first.`,
      existing: getPreviewState()!,
    }
  }

  const cwd = repoWorkspacePath(collabSessionId, repoFullName)
  if (!existsSync(cwd)) {
    return { ok: false, status: 404, error: `Workspace for ${repoFullName} not cloned yet.` }
  }
  const config = previewConfigForRepo(collabSessionId, repoFullName)

  // Compose the shell pipeline: install (if configured) && start.  Using
  // `sh -c` keeps PIDs single — easier to SIGTERM the whole tree on stop.
  const shellCmd = config.installCommand
    ? `${config.installCommand} && ${config.command}`
    : config.command

  const env = {
    ...process.env,
    OPENCODE_PREVIEW: "1",
    PORT: String(config.port),
    // Cap dev-server heap so a Vite explosion doesn't OOM the whole container.
    NODE_OPTIONS: `${process.env["NODE_OPTIONS"] ?? ""} --max-old-space-size=2048`.trim(),
  }

  let child: ChildProcess
  try {
    // `detached: true` puts the child + all its descendants in a NEW process
    // group whose pgid === child.pid.  Without this, sh→pnpm→node forms a
    // tree where `child.kill("SIGTERM")` only signals `sh`; the dev server
    // (node) keeps running and holds port 8080.  The next launch then 409s
    // on port-in-use until something garbage-collects the orphan.
    //
    // We kill via process.kill(-child.pid, signal) in stopPreview to fan
    // the signal across the entire group.  detached doesn't actually
    // detach from us (we keep stdio, keep the parent watching exit) —
    // it's just the pgid creation we want.
    child = spawn("sh", ["-c", shellCmd], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 500, error: `Failed to spawn dev server: ${msg}` }
  }

  if (!child.pid) {
    return { ok: false, status: 500, error: "Spawned process has no pid (immediate crash?)." }
  }

  const now = Date.now()
  const state: ActiveState = {
    collabSessionId,
    repoFullName,
    port: config.port,
    label: config.label,
    status: "installing",
    startedAt: now,
    lastTraffic: now,
    _log: [],
    recentLog: [],
    errorMessage: undefined,
    child,
    config,
    _stopRequested: false,
  }
  active = state

  // Reset the HEAD tracker for the new preview's workspace.  Without this
  // a relaunch (or a brand-new preview for a different session/repo) would
  // compare against the previous preview's last-seen HEAD, generating a
  // spurious "branch changed" → auto-restart loop on the first LLM turn.
  lastKnownHead = null

  wireChildStreams(state)
  startSweepLoop()

  broadcast(collabSessionId, {
    type: "collab:preview_started",
    state: getPreviewState()!,
  })

  return { ok: true, state: getPreviewState()! }
}

/**
 * Stop the running preview iff it belongs to this collab session.  Used by
 * the DELETE /collab/session/:id handler and any other cleanup path — safe
 * to call unconditionally; no-op when no preview is running OR the running
 * preview is for a different session.
 */
export function stopIfOwnedBySession(collabSessionId: string): void {
  if (active && active.collabSessionId === collabSessionId) {
    stopPreview(`session ${collabSessionId} deleted`)
  }
}

/**
 * Stop the running preview.  SIGTERM gives the dev server a chance to
 * shutdown cleanly (release the port, flush HMR sockets); SIGKILL after
 * a 5s grace window.
 */
export function stopPreview(reason: string = "explicit"): void {
  // Always cancel a pending restart, even when no preview is currently
  // active.  A user could click Stop during the 100 ms restart window,
  // or session-delete could fire just before the deferred launch.  The
  // ghost relaunch would otherwise either 404 (workspace gone) or
  // succeed but for a session that no longer exists.
  if (pendingRestart) {
    clearTimeout(pendingRestart)
    pendingRestart = null
  }
  if (!active) return
  // Mark the state so the child's exit handler can distinguish a stop we
  // initiated (silent) from a clean self-exit (broadcasts stopped) from a
  // crash (broadcasts failed).
  active._stopRequested = true
  const { child, collabSessionId } = active
  const sessionId = collabSessionId

  // Signal the whole process group — sh → pnpm → node — not just the
  // top-level shell.  `detached: true` in spawn() guarantees pgid ===
  // child.pid.  Negative pid syntax on process.kill targets the group.
  // Fall back to plain child.kill if pgid signalling fails (e.g. the
  // child already exited).
  const killGroup = (sig: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, sig)
    } catch {
      try { child.kill(sig) } catch {}
    }
  }

  killGroup("SIGTERM")
  const killTimer = setTimeout(() => killGroup("SIGKILL"), 5_000)
  child.once("exit", () => clearTimeout(killTimer))

  console.log(`[collab.preview] stopped (${reason}) for session ${sessionId}`)
  active = null
  lastKnownHead = null
  stopSweepLoop()

  broadcast(sessionId, {
    type: "collab:preview_stopped",
    collabSessionId: sessionId,
  })
}

/**
 * Stop + relaunch with the SAME args.  Used by the SPA's Restart button AND
 * by the branch-checkout hook below.  Returns the same shape as launchPreview.
 *
 * Important: we snapshot port + label BEFORE the stop, because `stopPreview`
 * sets `active = null` synchronously.  Without the pre-stop snapshot the
 * returned `state` would have `port: 0, label: "preview"` (the previous
 * defensive-default fallback was a bug — the SPA showed port 0 in the
 * banner until SSE caught up).
 *
 * The actual relaunch fires 100 ms later via setTimeout so the dev server's
 * old port is fully released before the new one binds.  If the inner launch
 * fails (e.g. the workspace was wiped between stop and relaunch, or
 * something else grabbed the slot first), we broadcast collab:preview_failed
 * so the SPA's banner reflects the truth instead of staying stuck in
 * "installing".
 */
export function restartPreview(): LaunchResult {
  if (!active) {
    return { ok: false, status: 404, error: "No preview is currently running." }
  }
  const { collabSessionId, repoFullName, port, label, config } = active
  const installing: PreviewStateSnapshot = {
    collabSessionId,
    repoFullName,
    port,
    label,
    status: "installing",
    startedAt: Date.now(),
    lastTraffic: Date.now(),
    recentLog: [],
  }

  stopPreview("restart")

  // Relaunch after the port is fully released.  100 ms is generous for
  // Node http listeners; the previous 50 ms was tight on slow runners.
  // Track the timer in module state so stopPreview can cancel it if a
  // later stop / delete arrives before the relaunch fires.
  pendingRestart = setTimeout(() => {
    pendingRestart = null
    const result = launchPreview(collabSessionId, repoFullName)
    if (!result.ok) {
      console.error(`[collab.preview] restart relaunch failed: ${result.error}`)
      // Surface to the SPA so its banner doesn't stay stuck "installing".
      broadcast(collabSessionId, {
        type: "collab:preview_failed",
        collabSessionId,
        error: result.error,
      })
    }
  }, 100)

  // Avoid an "unused" lint by referencing config — also documents that the
  // config carries through to the relaunch via previewConfigForRepo on the
  // workspace, not via the in-memory state.
  void config
  return { ok: true, state: installing }
}

/**
 * If a preview is running AND its workspace's git HEAD has changed since the
 * preview started, restart it.  Caller is the queue executor — it knows when
 * an LLM turn finished (which is when checkout/pull/reset most often
 * happens).  Best-effort: a failure here logs + continues; doesn't surface
 * to the user.
 */
let lastKnownHead: string | null = null

export async function maybeRestartOnBranchChange(): Promise<void> {
  if (!active) return
  // Only auto-restart when the preview is actually running.  Restarting
  // an in-progress install would throw away ~minutes of work for no
  // visible benefit (the install hasn't even bound the port yet, so
  // no user-visible mass-file-change problem exists).  Status flips to
  // "failed" → next launch is the user's call; we shouldn't second-
  // guess that either.
  if (active.status !== "running") return

  const { collabSessionId, repoFullName } = active
  try {
    const { readRepoBranch } = await import("./workspace")
    const head = await readRepoBranch(collabSessionId, repoFullName)
    if (!head) return
    if (lastKnownHead === null) {
      lastKnownHead = head
      return
    }
    if (head !== lastKnownHead) {
      console.log(`[collab.preview] HEAD changed (${lastKnownHead} → ${head}); restarting`)
      lastKnownHead = head
      restartPreview()
    }
  } catch (err) {
    console.warn("[collab.preview] HEAD check failed:", err)
  }
}

// ── Internal wiring ────────────────────────────────────────────────────────

function wireChildStreams(state: ActiveState): void {
  const onLine = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
    // Stop emitting log/state events for a child whose state has been
    // replaced (stopPreview cleared `active`, or a restart spun up a new
    // ActiveState).  The OS may still flush a few hundred bytes of stdout
    // between SIGTERM and process exit; without this guard those bytes
    // surface in the SPA as zombie log lines AFTER the user already saw
    // "Preview stopped".
    if (active !== state) return

    const lines = chunk.toString("utf8").split("\n").filter(Boolean)
    for (const line of lines) {
      state._log.push({ stream, line, ts: Date.now() })
      if (state._log.length > LOG_LINES_RETAINED * 2) {
        state._log.splice(0, state._log.length - LOG_LINES_RETAINED)
      }

      // Status transition: "installing" → "running" on the readyPattern OR
      // on a built-in heuristic (the line mentions "Local:" / "ready" / "listening").
      // RegExp construction is validated at config-load (previewConfigForRepo
      // rejects an invalid pattern with WARN), but a defensive try/catch
      // here keeps stdout processing safe against any pattern-shape we
      // didn't anticipate.
      if (state.status === "installing") {
        let ready = false
        try {
          ready =
            (state.config.readyPattern !== undefined &&
              new RegExp(state.config.readyPattern).test(line)) ||
            /\b(local|ready|listening|started server on)\b/i.test(line)
        } catch (e) {
          console.warn("[collab.preview] readyPattern match threw:", e)
        }
        if (ready) {
          ;(state as { status: PreviewStatus }).status = "running"
          broadcast(state.collabSessionId, {
            type: "collab:preview_started",
            state: getPreviewState()!,
          })
        }
      }

      broadcast(state.collabSessionId, {
        type: "collab:preview_log",
        line: line.slice(0, 2000),
        stream,
      })
    }
  }

  state.child.stdout?.on("data", onLine("stdout"))
  state.child.stderr?.on("data", onLine("stderr"))

  state.child.once("exit", (code, signal) => {
    if (active !== state) return // already replaced
    const wasStopped = state._stopRequested

    if (wasStopped) {
      // stopPreview() drove this exit.  It already broadcast
      // collab:preview_stopped + nulled `active`; nothing further to do.
      return
    }

    if (code === 0 && signal === null) {
      // Clean self-exit that WE didn't initiate.  Happens when the user's
      // start command exits cleanly (e.g. a `--build` flag that finishes
      // building and exits, or `pnpm run` resolved to a script that just
      // prints help).  Broadcast stopped so the SPA flips back to the
      // Launch button instead of staying stuck in installing/running.
      console.log(`[collab.preview] process exited cleanly on its own for session ${state.collabSessionId}`)
      broadcast(state.collabSessionId, {
        type: "collab:preview_stopped",
        collabSessionId: state.collabSessionId,
      })
      active = null
      lastKnownHead = null
      stopSweepLoop()
      return
    }

    // Unexpected death — non-zero code OR signal we didn't send.  Surface
    // as a failure so the user can read the tail of the log and Retry.
    const msg = `Preview process exited with code ${code} ${signal ? `(signal ${signal})` : ""}`
    console.error(`[collab.preview] ${msg}`)
    ;(state as { status: PreviewStatus }).status = "failed"
    ;(state as { errorMessage?: string }).errorMessage = msg
    broadcast(state.collabSessionId, {
      type: "collab:preview_failed",
      collabSessionId: state.collabSessionId,
      error: msg,
    })
    active = null
    lastKnownHead = null
    stopSweepLoop()
  })
}

function startSweepLoop(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    if (!active) return
    if (Date.now() - active.lastTraffic > IDLE_TIMEOUT_MS) {
      stopPreview(`idle ${Math.round(IDLE_TIMEOUT_MS / 60_000)}m`)
    }
  }, SWEEP_INTERVAL_MS)
  // Don't let the timer keep the event loop alive forever on shutdown.
  if (typeof sweepTimer.unref === "function") sweepTimer.unref()
}

function stopSweepLoop(): void {
  if (!sweepTimer) return
  clearInterval(sweepTimer)
  sweepTimer = null
}

/**
 * Re-spawn the previously-running preview on container boot.
 *
 * Reads `collab_session.preview_intent` (set by POST /preview/launch, cleared
 * by POST /preview/stop and by Session.deleteCollabSession's soft-delete)
 * and picks the row with the most-recent `preview_intent_at` — the
 * "first-launch-wins" contract from `launchPreview` means at most ONE
 * preview can be active per container, so we never need to spawn multiple.
 *
 * Called fire-and-forget from `serve.ts` right after `runCollabMigrations()`.
 * Failures here log but do NOT block boot — a stuck preview must not gate
 * the rest of the collab API coming online.
 *
 * Note: this runs on EVERY container start, including the FIRST start of a
 * fresh deploy where no `.opencode-preview.json` or workspace exists yet.
 * The `launchPreview` call's `existsSync(cwd)` guard returns 404 in that
 * case — we log and move on.  We deliberately do NOT clear the intent on
 * such a failure: the workspace clone may still be in flight (e.g.
 * `initSessionWorkspace` hasn't finished yet on a session created
 * milliseconds before shutdown), and a Driver pressing Launch again will
 * succeed once the clone lands.
 */
export async function resumePreviewsOnBoot(): Promise<void> {
  let session: typeof import("./session")
  try {
    session = await import("./session")
  } catch (err) {
    console.warn("[collab.preview] resumePreviewsOnBoot: session module import failed; skipping:", err)
    return
  }

  let intents: Array<{ collabSessionId: string; repoFullName: string; at: number }>
  try {
    intents = session.listPreviewIntents()
  } catch (err) {
    console.warn("[collab.preview] resumePreviewsOnBoot: listPreviewIntents threw; skipping:", err)
    return
  }
  if (intents.length === 0) return

  // First-launch-wins constraint (one preview per container) means we pick
  // the most-recently active intent and ignore the rest.  If multiple
  // intents survived to disk, the rest will sit clear in the DB until a
  // Driver explicitly Launches one — we never auto-stomp a more-recent
  // wish in favour of a stale one.
  const pick = intents[0]
  console.log(
    `[collab.preview] resumePreviewsOnBoot: ${intents.length} intent(s) on disk; picking session=${pick.collabSessionId} repo=${pick.repoFullName} (most-recent)`,
  )

  let result: LaunchResult
  try {
    result = launchPreview(pick.collabSessionId, pick.repoFullName)
  } catch (err) {
    console.error(
      `[collab.preview] resumePreviewsOnBoot: launchPreview threw for session=${pick.collabSessionId}:`,
      err,
    )
    return
  }

  if (!result.ok) {
    // 404 (workspace not cloned yet) is the common, expected case for sessions
    // mid-init at shutdown — keep the intent so the next boot tries again.
    // Other errors (500 spawn-failed, 409 race with a manual launch) we just
    // log: the Driver can press Launch manually to retry, and we don't want
    // a buggy preview to block boot recovery for other sessions on the box.
    console.warn(
      `[collab.preview] resumePreviewsOnBoot: launchPreview returned status=${result.status} error="${result.error}" for session=${pick.collabSessionId}; leaving intent in place`,
    )
    return
  }

  console.log(
    `[collab.preview] resumePreviewsOnBoot: successfully re-spawned preview for session=${pick.collabSessionId} on port ${result.state.port}`,
  )
}
