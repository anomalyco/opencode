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
}

// ── Module state (singleton — "first-launch wins") ─────────────────────────

let active: ActiveState | null = null
let sweepTimer: ReturnType<typeof setInterval> | null = null

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
    return {
      command: raw.command,
      port: raw.port,
      label: typeof raw.label === "string" ? raw.label : FRONTEND_DEFAULTS.label,
      installCommand:
        typeof raw.installCommand === "string" ? raw.installCommand : FRONTEND_DEFAULTS.installCommand,
      readyPattern: typeof raw.readyPattern === "string" ? raw.readyPattern : undefined,
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
    child = spawn("sh", ["-c", shellCmd], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
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
  }
  active = state

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
  if (!active) return
  const { child, collabSessionId } = active
  const sessionId = collabSessionId

  try { child.kill("SIGTERM") } catch {}
  const killTimer = setTimeout(() => {
    try { child.kill("SIGKILL") } catch {}
  }, 5_000)
  child.once("exit", () => clearTimeout(killTimer))

  console.log(`[collab.preview] stopped (${reason}) for session ${sessionId}`)
  active = null
  stopSweepLoop()

  broadcast(sessionId, {
    type: "collab:preview_stopped",
    collabSessionId: sessionId,
  })
}

/**
 * Stop + relaunch with the SAME args.  Used by the SPA's Restart button AND
 * by the branch-checkout hook below.  Returns the same shape as launchPreview.
 */
export function restartPreview(): LaunchResult {
  if (!active) {
    return { ok: false, status: 404, error: "No preview is currently running." }
  }
  const { collabSessionId, repoFullName } = active
  stopPreview("restart")
  // Tiny delay so the port is fully released before the next launch.
  // 50ms is empirically enough for Node http listeners.
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  // We can't make launchPreview async here without changing the route shape;
  // run it after a sync microtask delay instead.
  setTimeout(() => {
    void wait(50).then(() => launchPreview(collabSessionId, repoFullName))
  }, 50)
  // Return an "installing" snapshot synchronously; SSE will update when the
  // actual relaunch finishes.
  return {
    ok: true,
    state: {
      collabSessionId,
      repoFullName,
      port: active?.port ?? 0,
      label: active?.label ?? "preview",
      status: "installing",
      startedAt: Date.now(),
      lastTraffic: Date.now(),
      recentLog: [],
    },
  }
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
    const lines = chunk.toString("utf8").split("\n").filter(Boolean)
    for (const line of lines) {
      state._log.push({ stream, line, ts: Date.now() })
      if (state._log.length > LOG_LINES_RETAINED * 2) {
        state._log.splice(0, state._log.length - LOG_LINES_RETAINED)
      }

      // Status transition: "installing" → "running" on the readyPattern OR
      // on a built-in heuristic (the line mentions "Local:" / "ready" / "listening").
      if (state.status === "installing") {
        const ready =
          (state.config.readyPattern && new RegExp(state.config.readyPattern).test(line)) ||
          /\b(local|ready|listening|started server on)\b/i.test(line)
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
    if (code === 0 || signal === "SIGTERM" || signal === "SIGKILL") {
      // Clean stop or explicit kill — nothing to do; stopPreview already fired the SSE.
      active = null
      stopSweepLoop()
      return
    }
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
