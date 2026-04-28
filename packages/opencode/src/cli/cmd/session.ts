import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "@/session/session"
import { SessionID } from "../../session/schema"
import { ProjectID } from "@/project/schema"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale } from "@/util/locale"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { Database } from "@/storage/db"
import { SessionTable } from "@/session/session.sql"
import { eq, and, inArray, like } from "drizzle-orm"
import { Instance } from "@/project/instance"
import * as Log from "@opencode-ai/core/util/log"
import { EOL } from "os"
import path from "path"
import { which } from "../../util/which"
import { AppRuntime } from "@/effect/app-runtime"
import { stat, readFile } from "fs/promises"

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
    yargs
      .command(SessionListCommand)
      .command(SessionDeleteCommand)
      .command(SessionMoveCommand)
      .command(SessionDetachedCommand)
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
      .option("from-project", {
        describe: "move all sessions matching this project ID",
        type: "string",
      })
      .option("to-directory", {
        describe: "new directory for the sessions ('keep' to leave unchanged, default: current project root)",
        type: "string",
      })
      .option("to-project", {
        describe: "new project ID for the sessions ('keep' to leave unchanged, default: current project ID)",
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
      const fromId = args.fromId?.length
        ? inArray(
            SessionTable.id,
            args.fromId.map((id) => SessionID.make(id)),
          )
        : undefined
      const fromDir = args.fromDir
        ? (() => {
            const dir = args.fromDir === "cwd" ? process.cwd() : args.fromDir
            return dir.includes("*") || dir.includes("?")
              ? like(SessionTable.directory, dir.replace(/\*/g, "%").replace(/\?/g, "_"))
              : eq(SessionTable.directory, Filesystem.resolve(dir))
          })()
        : undefined
      const fromProject = args.fromProject ? eq(SessionTable.project_id, ProjectID.make(args.fromProject)) : undefined
      const where = and(fromId, fromDir, fromProject)
      const set: Record<string, string> = {}
      if (args.toDirectory && args.toDirectory !== "keep") set.directory = Filesystem.resolve(args.toDirectory)
      else if (args.toDirectory !== "keep") set.directory = Instance.worktree
      if (args.toProject && args.toProject !== "keep") set.project_id = args.toProject
      else if (args.toProject !== "keep") set.project_id = Instance.project.id
      const before = Database.use((db) => db.select().from(SessionTable).where(where).all()).map(Session.fromRow)
      if (before.length === 0) return
      log.debug("session move parameters", { set })
      if (!args.dryRun) Database.use((db) => db.update(SessionTable).set(set).where(where).run())
      await printSessions(before, args)
    })
  },
})

async function resolveDir(dir: string): Promise<DirResult> {
  let st
  try {
    st = await stat(dir)
  } catch (e) {
    if (e instanceof Error && "code" in e && typeof e.code === "string") {
      if (e.code === "ENOENT") return { reason: "directory does not exist" }
      if (e.code === "EACCES") return { reason: "permission denied" }
      if (e.code === "ENOTDIR") return { reason: "not a directory" }
    }
    return { reason: "cannot access directory" }
  }
  if (!st.isDirectory()) return { reason: "path is not a directory" }
  const gitText = (args: string[]) => Process.text(["git", ...args], { cwd: dir, nothrow: true })
  const commonDirRaw = (await gitText(["rev-parse", "--git-common-dir"])).text.trim()
  const commonDir = path.resolve(dir, commonDirRaw)
  if (commonDirRaw) {
    const cached = path.join(commonDir, "opencode")
    try {
      return { projectID: (await readFile(cached, "utf-8")).trim() }
    } catch {}
  }
  const revList = (await gitText(["rev-list", "--max-parents=0", "HEAD"])).text.trim()
  if (!revList) return { projectID: "global" }
  return {
    projectID:
      revList
        .split("\n")
        .filter(Boolean)
        .map((x) => x.trim())
        .toSorted()[0] ?? "global",
  }
}

type DirResult = { reason: string } | { projectID: string }

export const SessionDetachedCommand = cmd({
  command: "detached",
  describe: "find sessions with missing directories or mismatched project IDs",
  builder: (yargs: Argv) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = Database.use((db) => db.select().from(SessionTable).all()).map(Session.fromRow)
      const cache = new Map<string, Promise<DirResult>>()
      const resolve = (dir: string) => {
        let promise = cache.get(dir)
        if (promise) return promise
        promise = resolveDir(dir)
        cache.set(dir, promise)
        return promise
      }
      const checks = sessions.map(async (s) => {
        const result = await resolve(s.directory)
        if ("reason" in result) return { ...s, detachReason: result.reason }
        if (s.projectID !== result.projectID)
          return { ...s, detachReason: `project_id ${s.projectID} != expected ${result.projectID}` }
        return undefined
      })
      const detached = (await Promise.all(checks)).filter(
        (s): s is Session.Info & { detachReason: string } => s !== undefined,
      )
      if (detached.length === 0) return
      await printSessions(detached, args, [{ header: "Reason", value: (s) => s.detachReason! }])
    })
  },
})

type ExtraColumn = {
  header: string
  value: (s: Session.Info & { detachReason?: string }) => string
}

async function printSessions(
  sessions: (Session.Info & { detachReason?: string })[],
  args: { format?: string; maxCount?: number },
  extras: ExtraColumn[] = [],
) {
  let output: string
  if (args.format === "json") {
    output = formatSessionJSON(sessions, extras)
  } else {
    output = formatSessionTable(sessions, extras)
  }
  await paginate(output, { paginate: process.stdout.isTTY && !args.maxCount && args.format === "table" })
}

async function paginate(output: string, input?: { paginate?: boolean }) {
  const shouldPaginate = input?.paginate ?? (process.stdout.isTTY && false)
  if (!shouldPaginate) {
    console.log(output)
    return
  }
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
}

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

      await printSessions(sessions, args)
    })
  },
})

function formatSessionTable(
  sessions: (Session.Info & { detachReason?: string })[],
  extras: ExtraColumn[] = [],
): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))
  const extraWidths = extras.map((col) => ({
    ...col,
    width: Math.max(col.header.length, ...sessions.map((s) => col.value(s).length)),
  }))

  let header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  for (const col of extraWidths) header += `  ${col.header.padEnd(col.width)}`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    let line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    for (const col of extraWidths) line += `  ${col.value(session).padEnd(col.width)}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: (Session.Info & { detachReason?: string })[], extras: ExtraColumn[] = []): string {
  const jsonData = sessions.map((session) => {
    const base: Record<string, unknown> = {
      id: session.id,
      title: session.title,
      updated: session.time.updated,
      created: session.time.created,
      projectId: session.projectID,
      directory: session.directory,
    }
    for (const col of extras) base[col.header] = col.value(session)
    return base
  })
  return JSON.stringify(jsonData, null, 2)
}
