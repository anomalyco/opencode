import { cmd } from "../cmd"
import { UI } from "@/cli/ui"
import { tui } from "./app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { errorMessage } from "@/util/error"
import { validateSession } from "./validate-session"

const DEFAULT_ATTACH_HEALTH_TIMEOUT_MS = 3000

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to OPENCODE_SERVER_PASSWORD)",
      }),
  handler: async (args) => {
    const unguard = win32InstallCtrlCGuard()
    try {
      win32DisableProcessedInput()

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      const directory = (() => {
        if (!args.dir) return undefined
        try {
          process.chdir(args.dir)
          return process.cwd()
        } catch {
          // If the directory doesn't exist locally (remote attach), pass it through.
          return args.dir
        }
      })()
      const headers = (() => {
        const password = args.password ?? process.env.OPENCODE_SERVER_PASSWORD
        if (!password) return undefined
        const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
        return { Authorization: auth }
      })()

      const attachHealthTimeoutMs = Math.max(1, Number(process.env.OPENCODE_ATTACH_HEALTH_TIMEOUT_MS) || DEFAULT_ATTACH_HEALTH_TIMEOUT_MS)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), attachHealthTimeoutMs)
      const displayUrl = (() => {
        try {
          const parsed = new URL(args.url)
          parsed.username = ""
          parsed.password = ""
          parsed.search = ""
          return parsed.toString()
        } catch {
          return args.url.replace(/\/\/[^/@]*@/, "//[redacted]@").replace(/\?.*$/, "")
        }
      })()

      try {
        const response = await fetch(new URL("/global/health", args.url), {
          headers,
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
      } catch (error) {
        const message = error instanceof Error && error.name === "AbortError"
          ? `timed out after ${attachHealthTimeoutMs}ms`
          : error instanceof Error ? error.message : String(error)
        UI.error(`Unable to connect to opencode server at ${displayUrl}: ${message}`)
        process.exitCode = 1
        return
      } finally {
        clearTimeout(timer)
      }

      const config = await TuiConfig.get()

      try {
        await validateSession({
          url: args.url,
          sessionID: args.session,
          directory,
          headers,
        })
      } catch (error) {
        UI.error(errorMessage(error))
        process.exitCode = 1
        return
      }

      await tui({
        url: args.url,
        config,
        args: {
          continue: args.continue,
          sessionID: args.session,
          fork: args.fork,
        },
        directory,
        headers,
      })
    } finally {
      unguard?.()
    }
  },
})
