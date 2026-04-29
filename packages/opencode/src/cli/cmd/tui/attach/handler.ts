import { UI } from "@/cli/ui"
import { tui } from "../app"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "../win32"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"
import { errorMessage } from "@/util/error"
import { validateSession } from "../validate-session"
import type { AttachArgs } from "./command"

export async function handler(args: AttachArgs) {
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
}
