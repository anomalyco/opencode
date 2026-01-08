import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Initialize the browser and optionally navigate to a URL.

Parameters:
- url (string, optional): URL to navigate to after initialization. If provided, skips about:blank
- headed (boolean, optional): Run browser in visible mode (default: true)
- profile_path (string, optional): Custom path for browser profile for persistent sessions
`

export const BrowserInitTool = Tool.define("browser_init", {
  description: DESCRIPTION,
  parameters: z.object({
    url: z.string().optional().describe("URL to navigate to directly without about:blank intermediate"),
    headed: z.boolean().default(true).describe("Run browser in visible mode"),
    profile_path: z.string().optional().describe("Custom path for browser profile"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["init", params.url ? "navigate" : "init"],
      always: ["*"],
      metadata: { action: "init", headed: params.headed, url: params.url },
    })

    log.info("initializing browser", { headed: params.headed, url: params.url })

    try {
      if (BrowserManager.isReady()) {
        return {
          title: "Browser already initialized",
          metadata: { headed: params.headed, profilePath: params.profile_path, url: params.url },
          output: "Browser is already initialized",
        }
      }

      await BrowserManager.init({
        headed: params.headed,
        profilePath: params.profile_path,
      })

      let pageInfo = null
      if (params.url) {
        // Navigate directly to the provided URL
        pageInfo = await BrowserManager.navigate(params.url)
      } else {
        // Get page info after init
        pageInfo = await BrowserManager.getPageInfo()
      }

      return {
        title: "Browser initialized",
        metadata: {
          headed: params.headed,
          profilePath: params.profile_path,
          url: pageInfo?.url,
        },
        output: params.url
          ? `Browser initialized and navigated to ${params.url}`
          : `Browser initialized successfully${params.headed ? " (headed mode)" : ""}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("init failed", { error: message })
      throw new Error(`Initialization failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserInitTool)
