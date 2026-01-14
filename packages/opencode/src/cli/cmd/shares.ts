import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Storage } from "../../storage/storage"
import { Project } from "../../project/project"
import { Session } from "../../session"
import { ShareNext } from "../../share/share-next"
import { UI } from "../ui"
import { Locale } from "../../util/locale"
import { EOL } from "os"
import * as prompts from "@clack/prompts"

interface ShareWithSession {
  sessionID: string
  share: { id: string; secret: string; url: string }
  session: Session.Info | null
  project: Project.Info | null
}

async function listSharesWithSessions(): Promise<ShareWithSession[]> {
  const keys = await Storage.list(["session_share"])
  if (keys.length === 0) return []

  const projects = await Project.list()
  const results: ShareWithSession[] = []

  for (const key of keys) {
    const sessionID = key[1]
    const share = await Storage.read<{ id: string; secret: string; url: string }>(key).catch(() => null)
    if (!share) continue

    let session: Session.Info | null = null
    let project: Project.Info | null = null

    for (const p of projects) {
      const found = await Storage.read<Session.Info>(["session", p.id, sessionID]).catch(() => null)
      if (found) {
        session = found
        project = p
        break
      }
    }

    results.push({ sessionID, share, session, project })
  }

  results.sort((a, b) => {
    if (!a.session && !b.session) return 0
    if (!a.session) return 1
    if (!b.session) return -1
    return b.session.time.updated - a.session.time.updated
  })

  return results
}

function formatSharesTable(shares: ShareWithSession[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(12, ...shares.map((s) => s.sessionID.length))
  const maxTitleWidth = Math.max(20, ...shares.map((s) => (s.session?.title ?? "(orphan)").length))
  const maxUrlWidth = Math.max(20, ...shares.map((s) => s.share.url.length))

  const header = `${"Session ID".padEnd(maxIdWidth)}  ${"Title".padEnd(maxTitleWidth)}  URL`
  lines.push(header)
  lines.push("─".repeat(maxIdWidth + maxTitleWidth + maxUrlWidth + 4))

  for (const item of shares) {
    const title = Locale.truncate(item.session?.title ?? "(orphan)", maxTitleWidth)
    const line = `${item.sessionID.padEnd(maxIdWidth)}  ${title.padEnd(maxTitleWidth)}  ${item.share.url}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSharesJSON(shares: ShareWithSession[]): string {
  const data = shares.map((item) => ({
    sessionID: item.sessionID,
    url: item.share.url,
    title: item.session?.title ?? null,
    directory: item.session?.directory ?? null,
    projectID: item.project?.id ?? null,
    updated: item.session?.time.updated ?? null,
  }))
  return JSON.stringify(data, null, 2)
}

export const SharesCommand = cmd({
  command: "shares",
  describe: "manage shared sessions",
  builder: (yargs: Argv) =>
    yargs.command(SharesListCommand).command(SharesRemoveCommand).command(SharesOpenCommand).demandCommand(),
  async handler() {},
})

export const SharesListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list all shared sessions",
  builder: (yargs: Argv) => {
    return yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    })
  },
  handler: async (args) => {
    const shares = await listSharesWithSessions()

    if (shares.length === 0) {
      if (args.format !== "json") {
        console.log("No shared sessions found")
      } else {
        console.log("[]")
      }
      return
    }

    if (args.format === "json") {
      console.log(formatSharesJSON(shares))
    } else {
      console.log(formatSharesTable(shares))
    }
  },
})

export const SharesRemoveCommand = cmd({
  command: "remove [session-id]",
  aliases: ["rm", "unshare"],
  describe: "remove a share (unshare a session)",
  builder: (yargs: Argv) => {
    return yargs.positional("session-id", {
      describe: "session ID to unshare",
      type: "string",
    })
  },
  handler: async (args) => {
    UI.empty()
    prompts.intro("Remove Share")

    let sessionID = args.sessionId as string | undefined

    if (!sessionID) {
      const shares = await listSharesWithSessions()
      if (shares.length === 0) {
        prompts.log.warn("No shared sessions found")
        prompts.outro("Done")
        return
      }

      const selected = await prompts.select({
        message: "Select session to unshare",
        options: shares.map((s) => ({
          label: s.session?.title ?? s.sessionID,
          value: s.sessionID,
          hint: s.share.url,
        })),
      })
      if (prompts.isCancel(selected)) {
        prompts.cancel("Cancelled")
        return
      }
      sessionID = selected as string
    }

    const spinner = prompts.spinner()
    spinner.start("Removing share...")

    try {
      await ShareNext.remove(sessionID)
      spinner.stop("Share removed")
    } catch (e) {
      spinner.stop("Failed to remove share")
      prompts.log.error(e instanceof Error ? e.message : String(e))
    }

    prompts.outro("Done")
  },
})

export const SharesOpenCommand = cmd({
  command: "open [session-id]",
  describe: "open share URL in browser",
  builder: (yargs: Argv) => {
    return yargs.positional("session-id", {
      describe: "session ID to open",
      type: "string",
    })
  },
  handler: async (args) => {
    let sessionID = args.sessionId as string | undefined

    if (!sessionID) {
      UI.empty()
      prompts.intro("Open Share")

      const shares = await listSharesWithSessions()
      if (shares.length === 0) {
        prompts.log.warn("No shared sessions found")
        prompts.outro("Done")
        return
      }

      const selected = await prompts.select({
        message: "Select session to open",
        options: shares.map((s) => ({
          label: s.session?.title ?? s.sessionID,
          value: s.sessionID,
          hint: s.share.url,
        })),
      })
      if (prompts.isCancel(selected)) {
        prompts.cancel("Cancelled")
        return
      }
      sessionID = selected as string
    }

    const share = await Storage.read<{ id: string; secret: string; url: string }>(["session_share", sessionID]).catch(
      () => null,
    )

    if (!share) {
      console.error(`No share found for session ${sessionID}`)
      process.exitCode = 1
      return
    }

    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"
    const proc = Bun.spawn([cmd, share.url], { stdout: "ignore", stderr: "ignore" })
    await proc.exited

    console.log(`Opened ${share.url}`)
  },
})
