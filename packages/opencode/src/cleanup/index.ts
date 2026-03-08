import fs from "fs/promises"
import path from "path"
import { Log } from "../util/log"
import { Database, and, lt, isNotNull, isNull, eq, inArray } from "../storage/db"
import { SessionTable, MessageTable } from "../session/session.sql"
import { ProjectTable } from "../project/project.sql"
import { Storage } from "../storage/storage"
import { Global } from "../global"
import type { Config } from "../config/config"

type StorageCategory = "session" | "session_diff" | "message" | "part" | "todo" | "project" | "snapshot"

const ALL_CATEGORIES: StorageCategory[] = [
  "session",
  "session_diff",
  "message",
  "part",
  "todo",
  "project",
  "snapshot",
]

export namespace Cleanup {
  const log = Log.create({ service: "cleanup" })

  /** Yield to the event loop so the TUI can render */
  const yieldTick = () => new Promise<void>((r) => setTimeout(r, 0))

  export function run(config: Config.Info["cleanup"]) {
    if (config?.enabled === false) return
    // Defer cleanup to avoid competing with TUI startup
    setTimeout(() => runDeferred(config), 500)
  }

  async function runDeferred(config: Config.Info["cleanup"]) {
    log.info("cleanup started")
    const sessionsDeleted = await sessionCleanup(config?.session).catch((e) => {
      log.error("session cleanup failed", { error: e })
      return 0
    })
    const categories = new Set(config?.storage ?? ALL_CATEGORIES)
    const orphansSwept = await sweepOrphanedStorage(categories).catch((e) => {
      log.error("orphan sweep failed", { error: e })
      return 0
    })
    await vacuum(config?.vacuum).catch((e) =>
      log.error("vacuum failed", { error: e }),
    )
    log.info("cleanup complete", {
      sessions_deleted: sessionsDeleted,
      orphans_swept: orphansSwept,
    })
  }

  async function sessionCleanup(config: NonNullable<Config.Info["cleanup"]>["session"]): Promise<number> {
    if (!config?.max_age_days) return 0
    const cutoff = Date.now() - config.max_age_days * 86_400_000

    const conditions = [
      isNotNull(SessionTable.time_updated),
      lt(SessionTable.time_updated, cutoff),
      isNull(SessionTable.parent_id), // only root sessions; children cascade
    ]
    if (!config.target || config.target === "archived") {
      conditions.push(isNotNull(SessionTable.time_archived))
    }

    const sessions = Database.use((db) =>
      db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(and(...conditions))
        .all(),
    )

    if (sessions.length === 0) return 0
    const sessionIDs = sessions.map((s) => s.id)

    // DB first — orphaned storage files are harmless; orphaned DB rows could confuse UI
    Database.transaction((db) => {
      db.delete(SessionTable).where(inArray(SessionTable.id, sessionIDs)).run()
    })

    // Storage cleanup is best-effort; orphan sweep catches any misses
    for (const id of sessionIDs) {
      await Storage.remove(["session_diff", id]).catch(() => {})
    }

    log.info("session cleanup", { deleted: sessionIDs.length, target: config.target ?? "archived" })
    return sessionIDs.length
  }

  // -- Orphan sweep helpers --

  /** Get all session IDs that exist in the DB */
  function getSessionIDs(): Set<string> {
    const rows = Database.use((db) =>
      db.select({ id: SessionTable.id }).from(SessionTable).all(),
    )
    return new Set(rows.map((r) => r.id))
  }

  /** Get all message IDs that exist in the DB */
  function getMessageIDs(): Set<string> {
    const rows = Database.use((db) =>
      db.select({ id: MessageTable.id }).from(MessageTable).all(),
    )
    return new Set(rows.map((r) => r.id))
  }

  /** Get all project IDs that exist in the DB */
  function getProjectIDs(): Set<string> {
    const rows = Database.use((db) =>
      db.select({ id: ProjectTable.id }).from(ProjectTable).all(),
    )
    return new Set(rows.map((r) => r.id))
  }

  /**
   * Sweep a storage prefix, removing files whose ID (extracted from the key)
   * is not in the provided valid set.
   */
  async function sweepStoragePrefix(
    prefix: string,
    validIDs: Set<string>,
    idIndex: number,
  ): Promise<number> {
    let count = 0
    const keys = await Storage.list([prefix])
    for (let i = 0; i < keys.length; i++) {
      const id = keys[i][idIndex]
      if (!id) continue
      if (!validIDs.has(id)) {
        await Storage.remove(keys[i]).catch(() => {})
        count++
        // Yield every 100 deletions to avoid blocking the event loop
        if (count % 100 === 0) await yieldTick()
      }
    }
    return count
  }

  /** Recursively remove empty directories under a path (bottom-up) */
  async function pruneEmptyDirs(dir: string) {
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry)
      try {
        const stat = await fs.stat(full)
        if (!stat.isDirectory()) continue
        await pruneEmptyDirs(full)
        const children = await fs.readdir(full)
        if (children.length === 0) {
          await fs.rmdir(full).catch(() => {})
        }
      } catch {
        // entry disappeared between readdir and stat — fine
      }
    }
  }

  async function sweepOrphanedStorage(categories: Set<StorageCategory>): Promise<number> {
    const storageDir = path.join(Global.Path.data, "storage")
    let totalSwept = 0

    // Lazily load ID sets only when needed
    let sessionIDs: Set<string> | undefined
    let messageIDs: Set<string> | undefined
    let projectIDs: Set<string> | undefined

    const ensureSessionIDs = () => (sessionIDs ??= getSessionIDs())
    const ensureMessageIDs = () => (messageIDs ??= getMessageIDs())
    const ensureProjectIDs = () => (projectIDs ??= getProjectIDs())

    // session_diff: storage/session_diff/<sessionID>.json
    if (categories.has("session_diff")) {
      const swept = await sweepStoragePrefix("session_diff", ensureSessionIDs(), 1)
      if (swept > 0) {
        log.info("swept orphaned session_diff files", { count: swept })
        totalSwept += swept
      }
    }

    // todo: storage/todo/<sessionID>.json
    if (categories.has("todo")) {
      const swept = await sweepStoragePrefix("todo", ensureSessionIDs(), 1)
      if (swept > 0) {
        log.info("swept orphaned todo files", { count: swept })
        totalSwept += swept
      }
    }

    // message: storage/message/<sessionID>/<messageID>.json
    if (categories.has("message")) {
      const swept = await sweepStoragePrefix("message", ensureSessionIDs(), 1)
      if (swept > 0) {
        log.info("swept orphaned message files", { count: swept })
        totalSwept += swept
      }
    }

    // part: storage/part/<messageID>/<partID>.json
    if (categories.has("part")) {
      const swept = await sweepStoragePrefix("part", ensureMessageIDs(), 1)
      if (swept > 0) {
        log.info("swept orphaned part files", { count: swept })
        totalSwept += swept
      }
    }

    // session: storage/session/<projectID>/<sessionID>.json
    if (categories.has("session")) {
      const swept = await sweepStoragePrefix("session", ensureSessionIDs(), 2)
      if (swept > 0) {
        log.info("swept orphaned session files", { count: swept })
        totalSwept += swept
      }
    }

    // project: storage/project/<projectID>.json
    if (categories.has("project")) {
      const swept = await sweepStoragePrefix("project", ensureProjectIDs(), 1)
      if (swept > 0) {
        log.info("swept orphaned project files", { count: swept })
        totalSwept += swept
      }
    }

    // snapshot: ~/.local/share/opencode/snapshot/<projectID>/
    if (categories.has("snapshot")) {
      const snapshotDir = path.join(Global.Path.data, "snapshot")
      let swept = 0
      try {
        const pids = ensureProjectIDs()
        const entries = await fs.readdir(snapshotDir)
        for (const entry of entries) {
          if (pids.has(entry)) continue
          const full = path.join(snapshotDir, entry)
          const stat = await fs.stat(full).catch(() => null)
          if (!stat?.isDirectory()) continue
          await fs.rm(full, { recursive: true, force: true }).catch(() => {})
          swept++
        }
      } catch {
        // snapshot dir may not exist — that's fine
      }
      if (swept > 0) {
        log.info("swept orphaned snapshot dirs", { count: swept })
        totalSwept += swept
      }
    }

    // Prune empty subdirectories across all storage categories
    await pruneEmptyDirs(storageDir)

    if (totalSwept > 0) {
      log.info("orphan sweep complete", { total: totalSwept })
    }
    return totalSwept
  }

  async function vacuum(config: { enabled?: boolean } | undefined) {
    if (config?.enabled === false) return
    const start = Date.now()
    const client = Database.Client().$client
    client.run("PRAGMA wal_checkpoint(TRUNCATE)")
    client.run("VACUUM")
    log.info("vacuum complete", { duration: Date.now() - start })
  }
}
