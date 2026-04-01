import { cmd } from "../cmd"
import { UI } from "@/cli/ui"
import { tui } from "./app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/config/tui"
import { Instance } from "@/project/instance"
import { existsSync } from "fs"
import { preflightRemote, resolveRemoteTarget } from "../remote"
import { createInterface } from "readline/promises"

async function pick(items: { id: string; title?: string }[]) {
  if (items.length < 2) return items[0]?.id
  UI.println(UI.Style.TEXT_INFO_BOLD + "Select remote session" + UI.Style.TEXT_NORMAL)
  items.forEach((item, i) => {
    UI.println(`  ${i + 1}. ${item.title ?? item.id} ${UI.Style.TEXT_DIM}(${item.id})${UI.Style.TEXT_NORMAL}`)
  })
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    while (true) {
      const txt = (await rl.question("Enter session number: ")).trim()
      const n = Number(txt)
      if (Number.isInteger(n) && n >= 1 && n <= items.length) return items[n - 1]?.id
      UI.error(`Choose a number between 1 and ${items.length}`)
    }
  } finally {
    rl.close()
  }
}

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
      const sdk = await preflightRemote({
        url: args.url,
        directory,
        headers,
      }).catch((error) => {
        UI.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      })
      const target = await resolveRemoteTarget({
        sdk,
        directory,
        continue: args.continue,
        sessionID: args.session,
        fork: args.fork,
        pick: args.continue && !args.session ? pick : undefined,
      }).catch((error) => {
        UI.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
      })
      if (args.continue && target.baseID) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "Continuing remote session" + UI.Style.TEXT_NORMAL,
          target.title ?? target.baseID,
          UI.Style.TEXT_DIM + `(${target.baseID})` + UI.Style.TEXT_NORMAL,
        )
      }
      const config = await Instance.provide({
        directory: directory && existsSync(directory) ? directory : process.cwd(),
        fn: () => TuiConfig.get(),
      })
      await tui({
        url: args.url,
        config,
        args: {
          continue: target.picked ? false : args.continue,
          sessionID: target.picked ? target.baseID : args.session,
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
