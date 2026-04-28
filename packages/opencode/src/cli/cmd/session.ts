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
import { EOL } from "os"
import path from "path"
import { which } from "../../util/which"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { ProjectID } from "@/project/schema"
import { Effect } from "effect"

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
      .command(SessionOrphansCommand)
      .command(SessionMigrateCommand)
      .command(SessionDeleteCommand)
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
      .option("all", {
        describe: "list sessions across all projects",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = args.all
        ? [...Session.listGlobal({ roots: true, limit: args.maxCount })]
        : [...Session.list({ roots: true, limit: args.maxCount })]

      if (sessions.length === 0) {
        return
      }

      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(sessions)
      } else {
        output = formatSessionTable(sessions, args.all)
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

export const SessionOrphansCommand = cmd({
  command: "orphans",
  describe: "list orphaned sessions",
  builder: (yargs: Argv) => {
    return yargs
      .option("max-count", {
        alias: "n",
        describe: "limit to N most recent orphaned sessions",
        type: "number",
      })
      .option("format", {
        describe: "output format",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("archived", {
        describe: "include archived sessions",
        type: "boolean",
        default: false,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = [
        ...Session.listOrphans({
          limit: args.maxCount,
          archived: args.archived,
        }),
      ]

      if (sessions.length === 0) return

      const output = args.format === "json" ? formatSessionJSON(sessions) : formatSessionTable(sessions, true)
      console.log(output)
    })
  },
})

export const SessionMigrateCommand = cmd({
  command: "migrate <sessionID> [directory]",
  aliases: ["rebind"],
  describe: "migrate a session to another project or directory",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionID", {
        describe: "session ID to migrate",
        type: "string",
        demandOption: true,
      })
      .positional("directory", {
        describe: "target directory; defaults to the current working directory",
        type: "string",
      })
      .option("project", {
        describe: "target project ID; defaults to the project discovered from the target directory",
        type: "string",
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
      const sessionID = SessionID.make(args.sessionID)
      const directory = path.resolve(args.directory ?? process.cwd())
      const input = args.project
        ? {
            sessionID,
            projectID: ProjectID.make(args.project),
            directory,
          }
        : await Instance.provide({
            directory,
            fn: async () => ({
              sessionID,
              projectID: Instance.project.id,
              directory,
            }),
          })
      const session = await AppRuntime.runPromise(
        Session.Service.use((svc) => svc.migrate(input)).pipe(Effect.provide(Session.defaultLayer)),
      )

      if (args.format === "json") {
        console.log(formatSessionJSON([session]))
        return
      }

      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `Session ${session.id} migrated to ${session.projectID} (${session.directory})` +
          UI.Style.TEXT_NORMAL,
      )
    })
  },
})

type Row = Session.Info | Session.GlobalInfo

function projectName(session: Row) {
  if (!("project" in session)) return ""
  return session.project?.name ?? session.project?.worktree ?? "global"
}

function formatSessionTable(sessions: Row[], all = false): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))
  const maxProjectWidth = all ? Math.max(10, ...sessions.map((s) => projectName(s).length)) : 0

  const header =
    `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}` +
    (all ? `  Project${" ".repeat(maxProjectWidth - 7)}` : "") +
    "  Updated"
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line =
      `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}` +
      (all ? `  ${Locale.truncate(projectName(session), maxProjectWidth).padEnd(maxProjectWidth)}` : "") +
      `  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Row[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    project: "project" in session ? session.project : undefined,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}
