import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { Database, sql } from "../storage/db"
import { PartTable, SessionTable } from "../session/session.sql"
import { SessionPrompt } from "../session/prompt"
import { SessionActivity } from "../session/activity"
import { SessionID } from "../session/schema"
import { Config } from "../config/config"

const log = Log.create({ service: "bootstrap" })

const WATCHDOG_INTERVAL = 60_000
const MAX_RUNNING = 45 * 60 * 1_000
const DEFAULT_IDLE = 5 * 60 * 1_000

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  File.init()
  FileWatcher.init()
  Vcs.init()
  Snapshot.init()
  SessionActivity.init()
  cleanupOrphanedParts()
  watchdog()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(Instance.project.id)
    }
  })
}

/**
 * Mark any tool parts left in "running" state from a previous process as errored.
 * When the process exits (crash or clean shutdown), in-flight tool executions
 * are lost but their DB state remains "running" forever. This recovers them.
 */
function cleanupOrphanedParts() {
  const now = Date.now()
  Database.use((db) => {
    const orphaned = db
      .select({ id: PartTable.id })
      .from(PartTable)
      .where(
        sql`json_extract(${PartTable.data}, '$.type') = 'tool'
            AND json_extract(${PartTable.data}, '$.state.status') = 'running'`,
      )
      .all()
    if (orphaned.length === 0) return
    log.info("cleaning up orphaned tool parts", { count: orphaned.length })
    db.update(PartTable)
      .set({
        data: sql`json_set(
          json_set(
            json_set(${PartTable.data}, '$.state.status', 'error'),
            '$.state.error', 'Tool execution orphaned by process restart'
          ),
          '$.state.time.end', ${now}
        )`,
      })
      .where(
        sql`json_extract(${PartTable.data}, '$.type') = 'tool'
            AND json_extract(${PartTable.data}, '$.state.status') = 'running'`,
      )
      .run()
  })
}

/**
 * Single watchdog tick: find tool parts stuck in "running" beyond the cutoff,
 * filter to leaf-level tools, cancel their sessions, and force-error the
 * DB rows as a safety net.
 *
 * Only cancels "leaf" stuck tools — i.e. non-task tools that are the actual
 * root cause.  Task tools that are waiting on a child session with its own
 * stuck tool are left alone so the normal error-propagation path can run:
 * child cancel → task tool resolves → parent LLM processes the error.
 *
 * Exported for testing.
 */
export function watchdogTick(cutoff: number, idle?: number, taskCutoff?: number) {
  Database.use((db) => {
    const stuck = db
      .select({
        id: PartTable.id,
        session_id: PartTable.session_id,
        tool: sql<string>`json_extract(${PartTable.data}, '$.tool')`,
        child: sql<string | null>`json_extract(${PartTable.data}, '$.state.metadata.sessionId')`,
        start: sql<number>`json_extract(${PartTable.data}, '$.state.time.start')`,
      })
      .from(PartTable)
      .where(
        sql`json_extract(${PartTable.data}, '$.type') = 'tool'
            AND json_extract(${PartTable.data}, '$.state.status') = 'running'
            AND json_extract(${PartTable.data}, '$.state.time.start') < ${Math.max(cutoff, taskCutoff ?? cutoff)}`,
      )
      .all()
      // Apply per-tool-type cutoff: task tools use taskCutoff, others use cutoff
      .filter((r) => r.start < (r.tool === "task" ? (taskCutoff ?? cutoff) : cutoff))

    const cancelled = new Set<SessionID>()

    if (stuck.length > 0) {
      // Sessions that contain at least one stuck tool
      const stuckSessions = new Set(stuck.map((r) => SessionID.make(r.session_id)))

      // A task tool whose child session also has stuck tools is just
      // waiting — it will resolve once the child is cancelled.
      // Everything else (non-task tools, or task tools whose child has
      // no stuck tools) is a leaf that we must force-error.
      const leaf = stuck.filter((r) => {
        if (r.tool !== "task") return true
        if (!r.child) return true
        return !stuckSessions.has(SessionID.make(r.child))
      })

      log.warn("watchdog: found stuck tool parts", {
        total: stuck.length,
        leaf: leaf.length,
        ids: stuck.map((r) => r.id),
      })

      if (leaf.length > 0) {
        // For task-tool leaves, cancel the *child* session so the task tool's
        // normal error-propagation path runs: child cancel → SessionPrompt.prompt()
        // resolves → task tool returns structured TIMEOUT to the parent LLM.
        // For non-task leaves, cancel the owning session directly.
        for (const r of leaf) {
          if (r.tool === "task" && r.child) {
            const sid = SessionID.make(r.child)
            if (cancelled.has(sid)) continue
            cancelled.add(sid)
            log.warn("watchdog: cancelling stuck child session", { child: r.child, parent: r.session_id })
            SessionPrompt.cancel(sid).catch(() => {})
          } else {
            const sid = SessionID.make(r.session_id)
            if (cancelled.has(sid)) continue
            cancelled.add(sid)
            log.warn("watchdog: cancelling stuck session", { sessionID: r.session_id })
            SessionPrompt.cancel(sid).catch(() => {})
          }
        }

        // DB update as redundant safety net — only for leaf tools
        const now = Date.now()
        for (const r of leaf) {
          db.update(PartTable)
            .set({
              data: sql`json_set(
                json_set(
                  json_set(${PartTable.data}, '$.state.status', 'error'),
                  '$.state.error', 'Tool execution exceeded maximum allowed duration (watchdog)'
                ),
                '$.state.time.end', ${now}
              )`,
            })
            .where(
              sql`${PartTable.id} = ${r.id}
                  AND json_extract(${PartTable.data}, '$.state.status') = 'running'`,
            )
            .run()
        }
      }
    }

    // --- Independent idle detection sweep ---
    // Runs on every tick when idle param is provided, regardless of
    // whether any stuck tool parts were found above.
    // Only targets child (subagent) sessions — root sessions are never
    // idle-cancelled since the user controls their lifecycle.
    if (idle) {
      const stale = Object.entries(SessionActivity.list())
        .filter(([id]) => {
          if (cancelled.has(SessionID.make(id))) return false
          return SessionActivity.stale(id, idle)
        })
        .map(([id]) => id)
      if (stale.length > 0) {
        // Batch-check which stale sessions are children (have parent_id)
        const children = new Set(
          db
            .select({ id: SessionTable.id })
            .from(SessionTable)
            .where(
              sql`${SessionTable.id} IN (${sql.join(
                stale.map((id) => sql`${id}`),
                sql`, `,
              )})
                  AND ${SessionTable.parent_id} IS NOT NULL`,
            )
            .all()
            .map((r) => r.id),
        )
        for (const id of stale) {
          const sid = SessionID.make(id)
          if (!children.has(sid)) continue
          const ts = SessionActivity.last(id)
          log.warn("watchdog: idle session detected", {
            sessionID: id,
            last: ts,
            threshold: idle,
          })
          cancelled.add(sid)
          SessionPrompt.cancel(sid).catch(() => {})
        }
      }
    }
  })
}

/**
 * Periodic scan for tool parts stuck in "running" beyond the configured timeout.
 * Safety net for cases where the bash hard-stop or abort signal also fails.
 * Respects both tool_timeout and task_timeout config to avoid killing
 * long-running but healthy Task tool executions.
 */
function watchdog() {
  const timer = setInterval(async () => {
    try {
      const cfg = await Config.get()
      const tool = cfg.experimental?.tool_timeout ?? MAX_RUNNING
      const task = cfg.experimental?.task_timeout ?? 1_800_000
      const idle = cfg.experimental?.idle_timeout ?? DEFAULT_IDLE
      const now = Date.now()
      watchdogTick(now - tool, idle, now - (task + 60_000))
    } catch {
      watchdogTick(Date.now() - MAX_RUNNING)
    }
  }, WATCHDOG_INTERVAL)
  timer.unref()
}
