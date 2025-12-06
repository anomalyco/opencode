import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale } from "../../util/locale"
import { EOL } from "os"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../../server/server"
import { tui } from "./tui/app"

export const SessionCommand = cmd({
  command: "session",
  describe: "manage sessions",
  builder: (yargs: Argv) => yargs.command(SessionListCommand).command(SessionForkCommand).demandCommand(),
  async handler() {},
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
      const sessions = []
      for await (const session of Session.list()) {
        if (!session.parentID) {
          sessions.push(session)
        }
      }

      sessions.sort((a, b) => b.time.updated - a.time.updated)

      const limitedSessions = args.maxCount ? sessions.slice(0, args.maxCount) : sessions

      if (limitedSessions.length === 0) {
        return
      }

      let output: string
      if (args.format === "json") {
        output = formatSessionJSON(limitedSessions)
      } else {
        output = formatSessionTable(limitedSessions)
      }

      const shouldPaginate = process.stdout.isTTY && !args.maxCount && args.format === "table"

      if (shouldPaginate) {
        const proc = Bun.spawn({
          cmd: ["less", "-R", "-S"],
          stdin: "pipe",
          stdout: "inherit",
          stderr: "inherit",
        })

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

export const SessionForkCommand = cmd({
  command: "fork",
  describe: "fork a session to explore parallel conversation branches",
  builder: (yargs: Argv) => {
    return yargs
      .option("session", {
        alias: "s",
        describe: "session ID to fork",
        type: "string",
        demandOption: true,
      })
      .option("message", {
        alias: "m",
        describe: "fork up to this message ID",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const server = Server.listen({ port: 0, hostname: "127.0.0.1" })
      const sdk = createOpencodeClient({ baseUrl: `http://${server.hostname}:${server.port}` })

      const result = await sdk.session
        .fork({
          path: { id: args.session },
          body: { messageID: args.message },
        })
        .catch((error) => {
          server.stop()
          const errorMessage = error.message || String(error)
          UI.error(`Failed to fork session: ${errorMessage}`)
          process.exit(1)
        })

      if (!result.data) {
        server.stop()
        UI.error("Failed to fork session")
        process.exit(1)
      }

      const forkedSessionID = result.data.id
      UI.println(UI.Style.TEXT_INFO_BOLD + `Forked session: ${forkedSessionID}`)
      UI.println()

      await tui({
        url: `http://${server.hostname}:${server.port}`,
        args: { sessionID: forkedSessionID },
      })

      server.stop()
    })
  },
})
