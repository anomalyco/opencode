import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd, fail } from "../effect-cmd"
import { Session } from "@/session/session"
import { SessionID } from "../../session/schema"
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
  builder: (yargs: Argv) =>
    yargs.command(SessionListCommand).command(SessionDeleteCommand).command(SessionCleanCommand).demandCommand(),
  async handler() {},
})

export const SessionDeleteCommand = effectCmd({
  command: "delete <sessionIDs>",
  describe: "delete one or more sessions (comma-separated IDs)",
  builder: (yargs) =>
    yargs.positional("sessionIDs", {
      describe: "session ID(s) to delete, comma-separated for multiple",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.session.delete")(function* (args) {
    const svc = yield* Session.Service
    const ids = args.sessionIDs
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)

    if (ids.length === 0) {
      yield* fail("No session IDs provided")
    }

    if (ids.length > 1) {
      const confirmed = yield* Effect.promise(async () => {
        const readline = await import("readline")
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        return new Promise<boolean>((resolve) => {
          rl.question(`Delete ${ids.length} sessions? (y/N) `, (answer) => {
            rl.close()
            resolve(answer.toLowerCase() === "y")
          })
        })
      })

      if (!confirmed) {
        UI.println(UI.Style.TEXT_WARNING + "Cancelled" + UI.Style.TEXT_NORMAL)
        return
      }
    }

    let deleted = 0
    for (const id of ids) {
      const sessionID = SessionID.make(id)
      yield* svc
        .remove(sessionID)
        .pipe(
          Effect.catchIf(NotFoundError.isInstance, () => {
            UI.println(UI.Style.TEXT_WARNING + `Session not found: ${id}` + UI.Style.TEXT_NORMAL)
            return Effect.void
          }),
        )
      deleted++
    }

    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Deleted ${deleted} session(s)` + UI.Style.TEXT_NORMAL)
  }),
})

export const SessionCleanCommand = effectCmd({
  command: "clean",
  describe: "delete all sessions in current project",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.session.clean")(function* () {
    const svc = yield* Session.Service
    const sessions = yield* svc.list({ roots: true })

    if (sessions.length === 0) {
      UI.println("No sessions to delete")
      return
    }

    const confirmed = yield* Effect.promise(async () => {
      const readline = await import("readline")
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      return new Promise<boolean>((resolve) => {
        rl.question(`Delete all ${sessions.length} sessions? (y/N) `, (answer) => {
          rl.close()
          resolve(answer.toLowerCase() === "y")
        })
      })
    })

    if (!confirmed) {
      UI.println(UI.Style.TEXT_WARNING + "Cancelled" + UI.Style.TEXT_NORMAL)
      return
    }

    let deleted = 0
    for (const session of sessions) {
      yield* svc.remove(session.id)
      deleted++
    }

    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Deleted ${deleted} session(s)` + UI.Style.TEXT_NORMAL)
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
