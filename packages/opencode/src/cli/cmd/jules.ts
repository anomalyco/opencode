import type { Argv } from "yargs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { Effect } from "effect"
import { desc, eq } from "drizzle-orm"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable, SessionMessageTable } from "@opencode-ai/core/session/sql"
import { SessionID } from "../../session/schema"
import { JulesDiagnostic } from "@opencode-ai/core/session/jules-diagnostic"

const handleList = Effect.fn("Cli.jules.listHandler")(function* (args: { workspace?: string; remote?: boolean }) {
  if (args.remote) {
    const julesBin = JulesDiagnostic.findJulesBinary()
    if (!julesBin) {
      return yield* fail("Jules CLI binary not found. Install it with: npm install -g @google/jules")
    }
    const listing = JulesDiagnostic.safeExec(julesBin, ["remote", "list", "--session"], process.cwd(), 65536)
    if (!listing) {
      UI.println("No remote Jules sessions found.")
      return
    }
    UI.println(listing)
    return
  }

  const tracked = JulesDiagnostic.listTrackedSessions(args.workspace)
  if (tracked.length === 0) {
    UI.println(
      "No tracked Jules sessions" +
        (args.workspace ? ` for ${args.workspace}` : "") +
        ". Use 'opencode jules add <session-id>' to track one, or 'opencode jules list --remote' to query live sessions.",
    )
    return
  }

  const julesBin = JulesDiagnostic.findJulesBinary()
  const listing = julesBin ? JulesDiagnostic.safeExec(julesBin, ["remote", "list", "--session"], process.cwd(), 65536) : ""

  UI.println(
    `${"SESSION ID".padEnd(22)} ${"STATUS".padEnd(25)} ${"REPOSITORY".padEnd(30)} ${"WORKSPACE"}`
  )
  UI.println("-".repeat(100))

  for (const item of tracked) {
    const parsed = JulesDiagnostic.parseSessionFromListing(listing, item.id)
    const status = JulesDiagnostic.normalizeStatus(parsed.status)
    const repo = parsed.repo || "-"
    UI.println(
      `${item.id.padEnd(22)} ${status.padEnd(25)} ${repo.padEnd(30)} ${item.workspace}`
    )
  }
})

const ListCommand = effectCmd({
  command: "list [workspace]",
  aliases: ["ls", "clients", "sessions"],
  describe: "list tracked Jules diagnostic sessions / clients",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .positional("workspace", {
        type: "string",
        describe: "workspace directory to filter by (default: all workspaces)",
      })
      .option("remote", {
        type: "boolean",
        alias: ["r"],
        describe: "query live remote sessions directly from Jules API/CLI",
        default: false,
      })
  },
  handler: handleList,
})

const ClientsCommand = effectCmd({
  command: "clients [workspace]",
  describe: "list Jules agent sessions / clients (alias for list)",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .positional("workspace", {
        type: "string",
        describe: "workspace directory to filter by",
      })
      .option("remote", {
        type: "boolean",
        alias: ["r"],
        describe: "query live remote sessions directly from Jules API/CLI",
        default: false,
      })
  },
  handler: handleList,
})

const AddCommand = effectCmd({
  command: "add <session-id> [workspace]",
  describe: "start tracking a Jules diagnostic session for monitoring",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .positional("session-id", {
        type: "string",
        demandOption: true,
        describe: "Jules session ID to track",
      })
      .positional("workspace", {
        type: "string",
        describe: "workspace directory (defaults to current working directory)",
      })
  },
  handler: Effect.fn("Cli.jules.add")(function* (args: { "session-id": string; workspace?: string }) {
    const sessionID = args["session-id"]
    const workspace = args.workspace || process.cwd()
    const added = JulesDiagnostic.trackSession(sessionID, workspace)
    if (added) {
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `Tracking Jules session ${sessionID} (${workspace})` +
          UI.Style.TEXT_NORMAL,
      )
      return
    }
    UI.println(`Already tracking Jules session ${sessionID} (${workspace})`)
  }),
})

const RemoveCommand = effectCmd({
  command: "remove <session-id>",
  describe: "stop tracking a Jules diagnostic session",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.positional("session-id", {
      type: "string",
      demandOption: true,
      describe: "Jules session ID to remove",
    })
  },
  handler: Effect.fn("Cli.jules.remove")(function* (args: { "session-id": string }) {
    const sessionID = args["session-id"]
    const removed = JulesDiagnostic.untrackSession(sessionID)
    if (removed) {
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `Stopped tracking Jules session ${sessionID}` +
          UI.Style.TEXT_NORMAL,
      )
      return
    }
    UI.println(`Session ${sessionID} was not in the tracked list.`)
  }),
})

const PollCommand = effectCmd({
  command: "poll",
  describe: "poll tracked Jules sessions and log state transitions",
  instance: false,
  handler: Effect.fn("Cli.jules.poll")(function* () {
    const result = JulesDiagnostic.pollTrackedSessions()
    UI.println(
      `Checked ${result.checked} session(s): ${result.transitions} state transition(s), ${result.stuck} stuck session(s).`,
    )
  }),
})

const InstallCommand = effectCmd({
  command: "install [workspace]",
  describe: "install crontab entry for automated 5-minute Jules monitoring",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.positional("workspace", {
      type: "string",
      describe: "workspace directory (defaults to current working directory)",
    })
  },
  handler: Effect.fn("Cli.jules.install")(function* (args: { workspace?: string }) {
    const ws = args.workspace || process.cwd()
    const scriptPath = path.join(os.homedir(), ".config", "opencode", "scripts", "jules_monitor.sh")
    const cronEntry = fs.existsSync(scriptPath)
      ? `*/5 * * * * cd ${ws} && ${scriptPath}`
      : `*/5 * * * * cd ${ws} && opencode jules poll`

    const existingCrontab = spawnSync("crontab", ["-l"], { encoding: "utf8" })
    const currentLines = existingCrontab.status === 0 ? existingCrontab.stdout : ""

    if (currentLines.includes(`cd ${ws} &&`)) {
      UI.println(`Jules monitoring cron already installed for ${ws}`)
      return
    }

    const updated = (currentLines.trim() ? currentLines.trim() + "\n" : "") + cronEntry + "\n"
    const installResult = spawnSync("crontab", ["-"], { input: updated, encoding: "utf8" })
    if (installResult.status !== 0) {
      return yield* fail(`Failed to update crontab: ${installResult.stderr || "unknown error"}`)
    }

    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD +
        `Installed Jules monitoring cron for ${ws}` +
        UI.Style.TEXT_NORMAL,
    )
  }),
})

const DiagnoseCommand = effectCmd({
  command: "diagnose [session-id]",
  describe: "package session diagnostic context and spawn a Jules agent",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs.positional("session-id", {
      type: "string",
      describe: "OpenCode session ID to diagnose (defaults to most recent session)",
    })
  },
  handler: Effect.fn("Cli.jules.diagnose")(function* (args: { "session-id"?: string }) {
    const julesBin = JulesDiagnostic.findJulesBinary()
    if (!julesBin) {
      return yield* fail("Jules CLI binary not found. Install it with: npm install -g @google/jules")
    }

    const { db } = yield* Database.Service
    const session = args["session-id"]
      ? yield* db
          .select()
          .from(SessionTable)
          .where(eq(SessionTable.id, SessionID.make(args["session-id"])))
          .get()
          .pipe(Effect.orDie)
      : yield* db
          .select()
          .from(SessionTable)
          .orderBy(desc(SessionTable.time_created))
          .limit(1)
          .get()
          .pipe(Effect.orDie)

    if (!session) {
      return yield* fail(args["session-id"] ? `Session ${args["session-id"]} not found.` : "No OpenCode sessions found.")
    }

    const workspace = session.directory && fs.existsSync(session.directory) ? session.directory : process.cwd()
    const branch =
      JulesDiagnostic.safeExec("git", ["branch", "--show-current"], workspace) ||
      JulesDiagnostic.safeExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], workspace)
    const targetRepo = JulesDiagnostic.detectTargetRepo(workspace)
    const gitStatus = JulesDiagnostic.safeExec("git", ["status", "--short"], workspace)
    const gitDiff = JulesDiagnostic.safeExec("git", ["diff", "HEAD", "--stat"], workspace)

    const recentRows = yield* db
      .select()
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.session_id, session.id))
      .orderBy(desc(SessionMessageTable.seq))
      .limit(6)
      .all()
      .pipe(Effect.orDie)

    const recentLogLines: string[] = []
    let lastErrorMessage = "Manual diagnostic request"
    for (const row of recentRows.reverse()) {
      if (
        row.type === "assistant" &&
        row.data &&
        typeof row.data === "object" &&
        "content" in row.data &&
        Array.isArray(row.data.content)
      ) {
        for (const part of row.data.content) {
          if (part && typeof part === "object" && part.type === "log" && typeof part.text === "string") {
            recentLogLines.push(`[+log] ${part.text}`)
            if (part.text.toLowerCase().includes("error") || part.text.toLowerCase().includes("fail")) {
              lastErrorMessage = part.text
            }
          }
        }
      } else if (
        row.type === "user" &&
        row.data &&
        typeof row.data === "object" &&
        "text" in row.data &&
        typeof row.data.text === "string"
      ) {
        recentLogLines.push(`[user] ${row.data.text.slice(0, 300)}`)
      }
    }

    const modelName = session.model ? `${session.model.providerID}/${session.model.id}` : "unknown"

    const payload = JulesDiagnostic.buildPayload({
      sessionID: session.id,
      workspace,
      targetRepo,
      branch,
      agent: session.agent ?? "default",
      model: modelName,
      errorMessage: lastErrorMessage,
      recentLogs: recentLogLines.join("\n"),
      gitStatus,
      gitDiff,
    })

    UI.println(`Spawning Jules diagnostic agent for repo: ${targetRepo}...`)
    const julesSessionID = yield* Effect.tryPromise({
      try: () => JulesDiagnostic.spawnJulesSession(julesBin, targetRepo, payload, workspace),
      catch: (err) => err,
    }).pipe(Effect.orElseSucceed(() => undefined))

    if (!julesSessionID) {
      return yield* fail("Failed to obtain session ID from Jules CLI output.")
    }

    JulesDiagnostic.trackSession(julesSessionID, workspace)
    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD +
        `Jules diagnostic session created: ${julesSessionID}` +
        UI.Style.TEXT_NORMAL,
    )
    UI.println(`Tracking session in ${JulesDiagnostic.TRACKED_FILE}`)
  }),
})

export const JulesCommand = effectCmd({
  command: "jules",
  describe: "manage and monitor Jules diagnostic coding agents",
  instance: false,
  builder: (yargs: Argv) => {
    return yargs
      .command(ListCommand)
      .command(ClientsCommand)
      .command(AddCommand)
      .command(RemoveCommand)
      .command(PollCommand)
      .command(InstallCommand)
      .command(DiagnoseCommand)
      .demandCommand()
  },
  handler: Effect.fn("Cli.jules")(function* () {}),
})
