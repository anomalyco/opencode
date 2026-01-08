import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Initialize the browser with custom options.

Parameters:
- headed (boolean, optional): Run browser in visible mode (default: true)
- profile_path (string, optional): Custom path for browser profile for persistent sessions
`

export const BrowserInitTool = Tool.define("browser_init", {
  description: DESCRIPTION,
  parameters: z.object({
    headed: z.boolean().default(true).describe("Run browser in visible mode"),
    profile_path: z.string().optional().describe("Custom path for browser profile"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["init"],
      always: ["*"],
      metadata: { action: "init", headed: params.headed },
    })

    log.info("initializing browser", { headed: params.headed })

    try {
      if (BrowserManager.isReady()) {
        return {
          title: "Browser already initialized",
          metadata: { headed: params.headed, profilePath: params.profile_path },
          output: "Browser is already initialized",
        }
      }

      await BrowserManager.init({
        headed: params.headed,
        profilePath: params.profile_path,
      })

      return {
        title: "Browser initialized",
        metadata: { headed: params.headed, profilePath: params.profile_path },
        output: `Browser initialized successfully${params.headed ? " (headed mode)" : ""}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("init failed", { error: message })
      throw new Error(`Initialization failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserInitTool)
