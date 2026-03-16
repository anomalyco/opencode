import { cmd } from "./cmd"
import { UI } from "@/cli/ui"
import { tui } from "./tui/app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./tui/win32"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import { DaemonService } from "@/daemon/service"
import { existsSync } from "fs"

export const ConnectCommand = cmd({
  command: "connect",
  describe: "connect to the running opencode daemon",
  builder: (yargs) =>
    yargs
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

      const daemonConfig = await DaemonService.loadConfig()
      if (!daemonConfig) {
        UI.error("No daemon configured. Run `opencode daemon install` first.")
        process.exitCode = 1
        return
      }

      const url = `http://${daemonConfig.hostname}:${daemonConfig.port}`

      // Health-check the daemon
      const headers = (() => {
        const password = args.password ?? process.env.OPENCODE_SERVER_PASSWORD
        if (!password) return undefined
        const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
        return { Authorization: auth }
      })()

      try {
        await fetch(url, { headers })
      } catch {
        UI.error(`Cannot reach daemon at ${url}. Is it running?`)
        process.exitCode = 1
        return
      }

      const directory = (() => {
        if (!args.dir) return process.cwd()
        try {
          process.chdir(args.dir)
          return process.cwd()
        } catch {
          return args.dir
        }
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
          daemon: true,
        },
        directory,
        headers,
      })
    } finally {
      unguard?.()
    }
  },
})
