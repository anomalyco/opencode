import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Global } from "../global"
import { Log } from "../util/log"
import { ProjectTable } from "../project/project.sql"
import { SessionTable, MessageTable, PartTable, TodoTable, PermissionTable } from "../session/session.sql"
import { SessionShareTable } from "../share/share.sql"
import path from "path"
import { existsSync } from "fs"
import { Filesystem } from "../util/filesystem"
import { Glob } from "../util/glob"

export namespace JsonMigration {
  const log = Log.create({ service: "json-migration" })

  export type Progress = {
    current: number
    total: number
    label: string
  }

  type Options = {
    progress?: (event: Progress) => void
  }

  export async function run(sqlite: Database, options?: Options) {
    const storageDir = path.join(Global.Path.data, "storage")

    if (!existsSync(storageDir)) {
      log.info("storage directory does not exist, skipping migration")
      return {
        projects: 0,
        sessions: 0,
        messages: 0,
        parts: 0,
        todos: 0,
        permissions: 0,
        shares: 0,
        errors: [] as string[],
      }
    }

    log.info("starting json to sqlite migration", { storageDir })
    const start = performance.now()

    const db = drizzle({ client: sqlite })

    // Optimize SQLite for bulk inserts
    sqlite.exec("PRAGMA journal_mode = WAL")
    sqlite.exec("PRAGMA synchronous = OFF")
    sqlite.exec("PRAGMA cache_size = 10000")
    sqlite.exec("PRAGMA temp_store = MEMORY")
    const stats = {
      projects: 0,
      sessions: 0,
      messages: 0,
      parts: 0,
      todos: 0,
      permissions: 0,
      shares: 0,
      errors: [] as string[],
    }
    const orphans = {
      sessions: 0,
      todos: 0,
      permissions: 0,
      shares: 0,
    }
    const errs = stats.errors

    const batchSize = 1000
    const now = Date.now()

    async function list(pattern: string) {
      return Glob.scan(pattern, { cwd: storageDir, absolute: true })
    }

    async function read(files: string[], start: number, end: number) {
      const count = end - start
      const tasks = new Array(count)
      for (let i = 0; i < count; i++) {
        tasks[i] = Filesystem.readJson(files[start + i])
      }
      const results = await Promise.allSettled(tasks)
      const items = new Array(count)
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === "fulfilled") {
          items[i] = result.value
          continue
        }
        errs.push(`failed to read ${files[start + i]}: ${result.reason}`)
      }
      return items
    }

    function insert(values: any[], table: any, label: string) {
      if (values.length === 0) return 0
      try {
        db.insert(table).values(values).onConflictDoNothing().run()
        return values.length
      } catch (e) {
        errs.push(`failed to migrate ${label} batch: ${e}`)
        return 0
      }
    }

    // Pre-scan all files upfront to avoid repeated glob operations
    log.info("scanning files...")
    const [projectFiles, sessionFiles, messageFiles, partFiles, todoFiles, permFiles, shareFiles] = await Promise.all([
      list("project/*.json"),
      list("session/*/*.json"),
      list("message/*/*.json"),
      list("part/*/*.json"),
      list("todo/*.json"),
      list("permission/*.json"),
      list("session_share/*.json"),
    ])

    log.info("file scan complete", {
      projects: projectFiles.length,
      sessions: sessionFiles.length,
      messages: messageFiles.length,
      parts: partFiles.length,
      todos: todoFiles.length,
      permissions: permFiles.length,
      shares: shareFiles.length,
    })

    const total = Math.max(
      1,
      projectFiles.length +
        sessionFiles.length +
        messageFiles.length +
        partFiles.length +
        todoFiles.length +
        permFiles.length +
        shareFiles.length,
    )
    const progress = options?.progress
    let current = 0
    const step = (label: string, count: number) => {
      current = Math.min(total, current + count)
      progress?.({ current, total, label })
    }

    progress?.({ current, total, label: "starting" })

    sqlite.exec("BEGIN TRANSACTION")

    // Migrate projects first (no FK deps)
    // Derive all IDs from file paths, not JSON content
    const projectIds = new Set<string>()
    const projectValues = [] as any[]
    for (let i = 0; i < projectFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, projectFiles.length)
      const batch = await read(projectFiles, i, end)
      projectValues.length = 0
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const id = path.basename(projectFiles[i + j], ".json")
        projectIds.add(id)
        projectValues.push({
          id,
          worktree: data.worktree ?? "/",
          vcs: data.vcs,
          name: data.name ?? undefined,
          icon_url: data.icon?.url,
          icon_color: data.icon?.color,
          time_created: data.time?.created ?? now,
          time_updated: data.time?.updated ?? now,
          time_initialized: data.time?.initialized,
          sandboxes: data.sandboxes ?? [],
          commands: data.commands,
        })
      }
      stats.projects += insert(projectValues, ProjectTable, "project")
      step("projects", end - i)
    }
    log.info("migrated projects", { count: stats.projects, duration: Math.round(performance.now() - start) })

    // Migrate sessions (depends on projects)
    // Derive all IDs from directory/file paths, not JSON content, since earlier
    // migrations may have moved sessions to new directories without updating the JSON
    const sessionProjects = sessionFiles.map((file) => path.basename(path.dirname(file)))
    const sessionIds = new Set<string>()
    const sessionValues = [] as any[]
    for (let i = 0; i < sessionFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, sessionFiles.length)
      const batch = await read(sessionFiles, i, end)
      sessionValues.length = 0
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const id = path.basename(sessionFiles[i + j], ".json")
        const projectID = sessionProjects[i + j]
        if (!projectIds.has(projectID)) {
          orphans.sessions++
          continue
        }
        sessionIds.add(id)
        sessionValues.push({
          id,
          project_id: projectID,
          parent_id: data.parentID ?? null,
          slug: data.slug ?? "",
          directory: data.directory ?? "",
          title: data.title ?? "",
          version: data.version ?? "",
          share_url: data.share?.url ?? null,
          summary_additions: data.summary?.additions ?? null,
          summary_deletions: data.summary?.deletions ?? null,
          summary_files: data.summary?.files ?? null,
          summary_diffs: data.summary?.diffs ?? null,
          revert: data.revert ?? null,
          permission: data.permission ?? null,
          time_created: data.time?.created ?? now,
          time_updated: data.time?.updated ?? now,
          time_compacting: data.time?.compacting ?? null,
          time_archived: data.time?.archived ?? null,
        })
      }
      stats.sessions += insert(sessionValues, SessionTable, "session")
      step("sessions", end - i)
    }
    log.info("migrated sessions", { count: stats.sessions })
    if (orphans.sessions > 0) {
      log.warn("skipped orphaned sessions", { count: orphans.sessions })
    }

    // Migrate messages using pre-scanned file map
    const allMessageFiles = [] as string[]
    const allMessageSessions = [] as string[]
    const messageSessions = new Map<string, string>()
    for (const file of messageFiles) {
      const sessionID = path.basename(path.dirname(file))
      if (!sessionIds.has(sessionID)) continue
      allMessageFiles.push(file)
      allMessageSessions.push(sessionID)
    }

    for (let i = 0; i < allMessageFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, allMessageFiles.length)
      const batch = await read(allMessageFiles, i, end)
      const values = new Array(batch.length)
      let count = 0
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const file = allMessageFiles[i + j]
        const id = path.basename(file, ".json")
        const sessionID = allMessageSessions[i + j]
        messageSessions.set(id, sessionID)
        const rest = data
        delete rest.id
        delete rest.sessionID
        values[count++] = {
          id,
          session_id: sessionID,
          time_created: data.time?.created ?? now,
          time_updated: data.time?.updated ?? now,
          data: rest,
        }
      }
      values.length = count
      stats.messages += insert(values, MessageTable, "message")
      step("messages", end - i)
    }
    log.info("migrated messages", { count: stats.messages })

    // Migrate parts using pre-scanned file map
    for (let i = 0; i < partFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, partFiles.length)
      const batch = await read(partFiles, i, end)
      const values = new Array(batch.length)
      let count = 0
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const file = partFiles[i + j]
        const id = path.basename(file, ".json")
        const messageID = path.basename(path.dirname(file))
        const sessionID = messageSessions.get(messageID)
        if (!sessionID) {
          errs.push(`part missing message session: ${file}`)
          continue
        }
        if (!sessionIds.has(sessionID)) continue
        const rest = data
        delete rest.id
        delete rest.messageID
        delete rest.sessionID
        values[count++] = {
          id,
          message_id: messageID,
          session_id: sessionID,
          time_created: data.time?.created ?? now,
          time_updated: data.time?.updated ?? now,
          data: rest,
        }
      }
      values.length = count
      stats.parts += insert(values, PartTable, "part")
      step("parts", end - i)
    }
    log.info("migrated parts", { count: stats.parts })

    // Migrate todos
    const todoSessions = todoFiles.map((file) => path.basename(file, ".json"))
    for (let i = 0; i < todoFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, todoFiles.length)
      const batch = await read(todoFiles, i, end)
      const values = [] as any[]
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const sessionID = todoSessions[i + j]
        if (!sessionIds.has(sessionID)) {
          orphans.todos++
          continue
        }
        if (!Array.isArray(data)) {
          errs.push(`todo not an array: ${todoFiles[i + j]}`)
          continue
        }
        for (let position = 0; position < data.length; position++) {
          const todo = data[position]
          if (!todo?.content || !todo?.status || !todo?.priority) continue
          values.push({
            session_id: sessionID,
            content: todo.content,
            status: todo.status,
            priority: todo.priority,
            position,
            time_created: now,
            time_updated: now,
          })
        }
      }
      stats.todos += insert(values, TodoTable, "todo")
      step("todos", end - i)
    }
    log.info("migrated todos", { count: stats.todos })
    if (orphans.todos > 0) {
      log.warn("skipped orphaned todos", { count: orphans.todos })
    }

    // Migrate permissions
    const permProjects = permFiles.map((file) => path.basename(file, ".json"))
    const permValues = [] as any[]
    for (let i = 0; i < permFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, permFiles.length)
      const batch = await read(permFiles, i, end)
      permValues.length = 0
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const projectID = permProjects[i + j]
        if (!projectIds.has(projectID)) {
          orphans.permissions++
          continue
        }
        permValues.push({ project_id: projectID, data })
      }
      stats.permissions += insert(permValues, PermissionTable, "permission")
      step("permissions", end - i)
    }
    log.info("migrated permissions", { count: stats.permissions })
    if (orphans.permissions > 0) {
      log.warn("skipped orphaned permissions", { count: orphans.permissions })
    }

    // Migrate session shares
    const shareSessions = shareFiles.map((file) => path.basename(file, ".json"))
    const shareValues = [] as any[]
    for (let i = 0; i < shareFiles.length; i += batchSize) {
      const end = Math.min(i + batchSize, shareFiles.length)
      const batch = await read(shareFiles, i, end)
      shareValues.length = 0
      for (let j = 0; j < batch.length; j++) {
        const data = batch[j]
        if (!data) continue
        const sessionID = shareSessions[i + j]
        if (!sessionIds.has(sessionID)) {
          orphans.shares++
          continue
        }
        if (!data?.id || !data?.secret || !data?.url) {
          errs.push(`session_share missing id/secret/url: ${shareFiles[i + j]}`)
          continue
        }
        shareValues.push({ session_id: sessionID, id: data.id, secret: data.secret, url: data.url })
      }
      stats.shares += insert(shareValues, SessionShareTable, "session_share")
      step("shares", end - i)
    }
    log.info("migrated session shares", { count: stats.shares })
    if (orphans.shares > 0) {
      log.warn("skipped orphaned session shares", { count: orphans.shares })
    }

    sqlite.exec("COMMIT")

    log.info("json migration complete", {
      projects: stats.projects,
      sessions: stats.sessions,
      messages: stats.messages,
      parts: stats.parts,
      todos: stats.todos,
      permissions: stats.permissions,
      shares: stats.shares,
      errorCount: stats.errors.length,
      duration: Math.round(performance.now() - start),
    })

    if (stats.errors.length > 0) {
      log.warn("migration errors", { errors: stats.errors.slice(0, 20) })
    }

    progress?.({ current: total, total, label: "complete" })

    return stats
  }
}
