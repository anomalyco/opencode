import { cmd } from "../cmd"
import { UI } from "@/cli/ui"
import { tui } from "./app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import { existsSync } from "fs"
import * as prompts from "@clack/prompts"
import { MDNS } from "../../../mdns"

export const AttachCommand = cmd({
  command: "attach [url]",
  describe: "attach to a running opencode server",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: false,
      })
      .option("discover", {
        alias: ["d"],
        type: "boolean",
        default: false,
        describe: "Discover OpenCode servers via mDNS",
      })
      .option("timeout", {
        type: "number",
        describe: "Discovery timeout (ms)",
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
      })
      .check((input) => {
        if (!input.url && !input.discover) {
          throw new Error("Provide a URL or use --discover")
        }
        if (input.timeout !== undefined && !input.discover) {
          throw new Error("--timeout requires --discover")
        }
        return true
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

      let url = args.url

      if (args.discover) {
        prompts.intro("Discovering OpenCode servers")
        const timeout = args.timeout ?? 3000
        let servers
        try {
          servers = await MDNS.find(AbortSignal.timeout(timeout))
        } catch (error) {
          prompts.log.error(`Discovery failed: ${error instanceof Error ? error.message : String(error)}`)
          prompts.outro("Done")
          process.exit(1)
        }

        if (servers.length === 0) {
          prompts.log.warn("No OpenCode servers found on the network")
          prompts.outro("Done")
          return
        }

        if (servers.length === 1) {
          url = servers[0].fullUrl
          prompts.log.info(`Connecting to ${url}`)
        } else {
          const selected = await prompts.select({
            message: "Select a server to attach to",
            options: servers.map((server) => ({
              label: `${server.name} (${server.fullUrl})`,
              value: server.fullUrl,
            })),
          })
          if (prompts.isCancel(selected)) throw new UI.CancelledError()
          url = selected
        }
      }

      if (!url) throw new Error("No URL provided")

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
      const config = await Instance.provide({
        directory: directory && existsSync(directory) ? directory : process.cwd(),
        fn: () => TuiConfig.get(),
      })
      await tui({
        url,
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
