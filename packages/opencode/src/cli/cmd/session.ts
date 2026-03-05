import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { SessionID } from "../../session/schema"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale } from "../../util/locale"
import { Flag } from "../../flag/flag"
import { Filesystem } from "../../util/filesystem"
import { Process } from "../../util/process"
import { EOL } from "os"
import path from "path"
import { which } from "../../util/which"
import { Database, sql, eq, or, lt, isNull, not, and, desc } from "../../storage/db"
import { SessionTable } from "../../session/session.sql"

function pagerCmd(): string[] {
  const lessOptions = ["-R", "-S"]
  if (process.platform !== "win32") {
    return ["less", ...lessOptions]
  }

  // user could have less installed via other options
  const lessOnPath = which("less")
  if (lessOnPath) {
    if (Filesystem.stat(lessOnPath)?.size) return [lessOnPath, ...lessOptions]
  }

  if (Flag.OPENCODE_GIT_BASH_PATH) {
    const less = path.join(Flag.OPENCODE_GIT_BASH_PATH, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  const git = which("git")
  if (git) {
    const less = path.join(git, "..", "..", "usr", "bin", "less.exe")
    if (Filesystem.stat(less)?.size) return [less, ...lessOptions]
  }

  // Fall back to Windows built-in more (via cmd.exe)
  return ["cmd", "/c", "more"]
}

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) =>
    yargs
      .command(SessionListCommand)
      .command(SessionDeleteCommand)
      .command(SessionArchiveCommand)
      .command(SessionUnarchiveCommand)
      .command(SessionStatsCommand)
      .command(SessionPruneCommand)
      .demandCommand(),
  async handler() {},
})

export const SessionDeleteCommand = cmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = SessionID.make(args.sessionID)
      try {
        await Session.get(sessionID)
      } catch {
        UI.error(`Session not found: ${args.sessionID}`)
        process.exit(1)
      }
      await Session.remove(sessionID)
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
    })
  },
})

export const SessionListCommand = cmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs: Argv) => {
    return yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = [...Session.list({ roots: true, limit: args.maxCount })]

      if (sessions.length === 0) {
        return
      }

      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(sessions)
      } else {
        output = formatSessionTable(sessions)
      }

      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        const proc = Process.spawn(pagerCmd(), {
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

        if (!proc.stdin) {
          console.log(output)
          return
        }

        proc.stdin.write(output)
        proc.stdin.end()
        await proc.exited
      } else {
        console.log(output)
      }
    })
  },
})

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}

export const SessionArchiveCommand = cmd({
  command: "archive <sessionID>",
  describe: "archive a session",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session ID to archive",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      try {
        await Session.get(SessionID.make(args.sessionID))
      } catch {
        UI.error(`Session not found: ${args.sessionID}`)
        process.exit(1)
      }
      await Session.setArchived({ sessionID: SessionID.make(args.sessionID), time: Date.now() })
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} archived` + UI.Style.TEXT_NORMAL)
    })
  },
})

export const SessionUnarchiveCommand = cmd({
  command: "unarchive <sessionID>",
  describe: "unarchive a session",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "session ID to unarchive",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      try {
        await Session.get(SessionID.make(args.sessionID))
      } catch {
        UI.error(`Session not found: ${args.sessionID}`)
        process.exit(1)
      }
      await Session.setArchived({ sessionID: SessionID.make(args.sessionID), time: undefined })
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} unarchived` + UI.Style.TEXT_NORMAL)
    })
  },
})

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + " GB"
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + " MB"
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB"
  return bytes + " B"
}

export const SessionStatsCommand = cmd({
  command: "stats",
  describe: "show session storage statistics",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    await bootstrap(process.cwd(), async () => {
      const size = Number(Filesystem.stat(Database.Path)?.size ?? 0)
      const wal = Number(Filesystem.stat(Database.Path + "-wal")?.size ?? 0)

      const counts = Database.use((db) =>
        db
          .get<{
            roots: number
            children: number
            archived: number
            messages: number
            parts: number
          }>(
            sql`SELECT
              (SELECT COUNT(*) FROM session WHERE parent_id IS NULL) as roots,
              (SELECT COUNT(*) FROM session WHERE parent_id IS NOT NULL) as children,
              (SELECT COUNT(*) FROM session WHERE time_archived IS NOT NULL) as archived,
              (SELECT COUNT(*) FROM message) as messages,
              (SELECT COUNT(*) FROM part) as parts`,
          )
      )

      const r = counts?.roots ?? 0
      const c = counts?.children ?? 0

      console.log("Session Storage Statistics")
      console.log("─".repeat(40))
      console.log(`Database size:     ${formatSize(size)}`)
      if (wal > 0) console.log(`WAL file size:     ${formatSize(wal)}`)
      console.log(`Total sessions:    ${r + c} (${r} root, ${c} child)`)
      console.log(`Archived sessions: ${counts?.archived ?? 0}`)
      console.log(`Total messages:    ${(counts?.messages ?? 0).toLocaleString()}`)
      console.log(`Total parts:       ${(counts?.parts ?? 0).toLocaleString()}`)
    })
  },
})

export const SessionPruneCommand = cmd({
  command: "prune",
  describe: "delete old and archived sessions to reclaim storage",
  builder: (yargs: Argv) =>
    yargs
      .option("older-than", {
        describe: "prune sessions inactive for N days (default: 30)",
        type: "number",
        default: 30,
      })
      .option("children", {
        describe: "also prune child sessions independently",
        type: "boolean",
        default: false,
      })
      .option("vacuum", {
        describe: "run VACUUM after pruning",
        type: "boolean",
        default: false,
      })
      .option("dry-run", {
        describe: "show what would be pruned without deleting",
        type: "boolean",
        default: false,
      }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const cutoff = Date.now() - args.olderThan * 86_400_000
      const BATCH = 100
      const candidates: { id: SessionID; title: string; archived: boolean; parent: boolean }[] = []

      // paginate through all prunable sessions in batches
      let offset = 0
      while (true) {
        const rows = Database.use((db) => {
          const conditions = [
            or(
              not(isNull(SessionTable.time_archived)),
              lt(SessionTable.time_updated, cutoff),
            ),
          ]
          if (!args.children) {
            conditions.push(isNull(SessionTable.parent_id))
          }
          return db
            .select({
              id: SessionTable.id,
              title: SessionTable.title,
              time_archived: SessionTable.time_archived,
              parent_id: SessionTable.parent_id,
            })
            .from(SessionTable)
            .where(and(...conditions))
            .orderBy(desc(SessionTable.time_updated), desc(SessionTable.id))
            .limit(BATCH)
            .offset(offset)
            .all()
        })
        if (rows.length === 0) break
        for (const row of rows) {
          candidates.push({
            id: row.id,
            title: row.title,
            archived: row.time_archived !== null,
            parent: row.parent_id === null,
          })
        }
        if (rows.length < BATCH) break
        offset += BATCH
      }

      if (candidates.length === 0) {
        UI.println("No sessions to prune")
        return
      }

      // sort roots before children to avoid double-delete
      candidates.sort((a, b) => (a.parent === b.parent ? 0 : a.parent ? -1 : 1))

      if (args.dryRun) {
        UI.println(`Would prune ${candidates.length} session(s):`)
        for (const s of candidates) {
          const tag = s.archived ? " [archived]" : ""
          UI.println(`  ${s.id}  ${Locale.truncate(s.title, 40)}${tag}`)
        }
        return
      }

      const before = Number(Filesystem.stat(Database.Path)?.size ?? 0)
      const deleted = new Set<string>()
      for (const s of candidates) {
        if (deleted.has(s.id)) continue
        const descendants = collectDescendants(s.id)
        await Session.remove(s.id)
        deleted.add(s.id)
        for (const d of descendants) deleted.add(d)
      }
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Pruned ${deleted.size} session(s)` + UI.Style.TEXT_NORMAL)

      if (args.vacuum) {
        try {
          Database.vacuum()
          const after = Number(Filesystem.stat(Database.Path)?.size ?? 0)
          const freed = before - after
          if (freed > 0) UI.println(`Reclaimed ${formatSize(freed)}`)
          else UI.println("Database vacuumed")
        } catch {
          UI.error("Database is busy or locked — try again when no sessions are active")
        }
      }
    })
  },
})

function collectDescendants(id: SessionID): SessionID[] {
  const rows = Database.use((db) =>
    db
      .select({ id: SessionTable.id })
      .from(SessionTable)
      .where(eq(SessionTable.parent_id, id))
      .all(),
  )
  const result: SessionID[] = []
  for (const row of rows) {
    result.push(row.id)
    result.push(...collectDescendants(row.id))
  }
  return result
}
