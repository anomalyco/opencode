import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { AmbiguousIDError, Session } from "@/session/session"
import { UI } from "../ui"
import { Locale } from "@/util/locale"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { NotFoundError } from "@/storage/storage"
import { EOL } from "os"
import path from "path"
import { which } from "@opencode-ai/core/util/which"

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
  builder: (yargs: Argv) => yargs.command(SessionListCommand).command(SessionDeleteCommand).demandCommand(),
  async handler() {},
})

export const SessionDeleteCommand = effectCmd({
  command: "delete <sessionID>",
  describe: "delete a session",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session ID to delete",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.session.delete")(function* (args) {
    const svc = yield* Session.Service
    const notFound = () => fail(`Session not found: ${args.sessionID}`)
    const sessionID = yield* svc.resolve(args.sessionID).pipe(
      Effect.catchIf(AmbiguousIDError.isInstance, (error) =>
        fail(
          `Multiple sessions match "${error.input}". Use a longer prefix:\n${error.matches
            .map((match) => `  ${match}`)
            .join("\n")}`,
        ),
      ),
      Effect.catchIf(NotFoundError.isInstance, notFound),
    )
    yield* svc.remove(sessionID).pipe(Effect.catchIf(NotFoundError.isInstance, notFound))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${sessionID} deleted` + UI.Style.TEXT_NORMAL)
  }),
})

export const SessionListCommand = effectCmd({
  command: "list",
  describe: "list sessions",
  builder: (yargs) =>
    yargs
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
      }),
  handler: Effect.fn("Cli.session.list")(function* (args) {
    const sessions = yield* Session.Service.use((svc) => svc.list({ roots: true, limit: args.maxCount }))

    if (sessions.length === 0) return

    const output = args.format === "json" ? formatSessionJSON(sessions) : formatSessionTable(sessions)

    const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

    if (shouldPaginate) {
      yield* Effect.promise(async () => {
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
      })
    } else {
      console.log(output)
    }
  }),
})

function shortID(id: string): string {
  return id.slice(0, 12)
}

type SessionTableColumn = {
  header: string
  minWidth: number
  value: (session: Session.Info) => string
  truncate: (value: string, width: number) => string
}

const sessionTableColumns: SessionTableColumn[] = [
  {
    header: "Session ID",
    minWidth: 12,
    value: (session) => shortID(session.id),
    truncate: (value) => value,
  },
  {
    header: "Title",
    minWidth: 25,
    value: (session) => session.title,
    truncate: Locale.truncate,
  },
  {
    header: "WorkDir",
    minWidth: 30,
    value: (session) => session.directory,
    truncate: Locale.truncateMiddle,
  },
  {
    header: "Updated",
    minWidth: 0,
    value: (session) => Locale.todayTimeOrDateTime(session.time.updated),
    truncate: (value) => value,
  },
]

export function formatSessionTable(sessions: Session.Info[]): string {
  const widths = sessionTableColumns.map((column) => {
    const contentWidth = Math.max(...sessions.map((session) => column.value(session).length))
    return Math.max(column.minWidth, column.header.length, contentWidth)
  })

  const formatRow = (cells: string[]) => cells.map((cell, index) => cell.padEnd(widths[index])).join("  ")

  const header = formatRow(sessionTableColumns.map((column) => column.header))
  const rows = sessions.map((session) =>
    formatRow(sessionTableColumns.map((column, index) => column.truncate(column.value(session), widths[index]))),
  )

  return [header, "─".repeat(header.length), ...rows].join(EOL)
}

export function formatSessionJSON(sessions: Session.Info[]): string {
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
