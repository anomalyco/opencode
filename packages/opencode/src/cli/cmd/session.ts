import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "@/session/session"
import { SessionID } from "../../session/schema"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale } from "@/util/locale"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { eq, and, inArray, type SQL } from "drizzle-orm"
import { Instance } from "@/project/instance"
import * as Log from "@opencode-ai/core/util/log"
import { EOL } from "os"
import path from "path"
import { which } from "../../util/which"
import { AppRuntime } from "@/effect/app-runtime"

const log = Log.create({ service: "command-session" })

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
    yargs.command(SessionListCommand).command(SessionDeleteCommand).command(SessionMoveCommand).demandCommand(),
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
        await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
      } catch {
        UI.error(`Session not found: ${args.sessionID}`)
        process.exit(1)
      }
      await AppRuntime.runPromise(Session.Service.use((svc) => svc.remove(sessionID)))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
    })
  },
})

export const SessionMoveCommand = cmd({
  command: "move",
  describe: "move sessions to a different project/directory",
  builder: (yargs: Argv) =>
    yargs
      .option("from-id", {
        describe: "session ID to move (can be specified multiple times)",
        type: "string",
        array: true,
      })
      .option("from-dir", {
        describe: "move all sessions matching this directory ('cwd' for current working directory)",
        type: "string",
      })
      .option("to-directory", {
        describe: "new directory for the sessions (default: current project root)",
        type: "string",
      })
      .option("to-project", {
        describe: "new project ID for the sessions (default: current project ID)",
        type: "string",
      })
      .option("dry-run", {
        describe: "print what would be done without making changes",
        type: "boolean",
        default: false,
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      }),
  handler: async (args) => {
    if (!args.fromId?.length && !args.fromDir) {
      UI.error("At least one of --from-id or --from-dir is required")
      process.exit(1)
    }
    await bootstrap(process.cwd(), async () => {
      const conditions: SQL[] = []
      if (args.fromId?.length) conditions.push(inArray(SessionTable.id, args.fromId.map((id) => SessionID.make(id))))
      if (args.fromDir)
        conditions.push(eq(SessionTable.directory, args.fromDir === "cwd" ? process.cwd() : Filesystem.resolve(args.fromDir)))
      const where = conditions.length === 1 ? conditions[0] : and(...conditions)
      const set: Record<string, string> = {
        directory: args.toDirectory ? Filesystem.resolve(args.toDirectory) : Instance.worktree,
        project_id: args.toProject ?? Instance.project.id,
      }
      const before = Database.use((db) => db.select().from(SessionTable).where(where).all()).map(Session.fromRow)
      if (before.length === 0) return
      log.debug("session move parameters", { set })
      if (!args.dryRun) Database.use((db) => db.update(SessionTable).set(set).where(where).run())
      console.log(args.format === "json" ? formatSessionJSON(before) : formatSessionTable(before))
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
