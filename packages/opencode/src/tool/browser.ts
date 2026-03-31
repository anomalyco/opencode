import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./browser.txt"
import { chromium, type Browser, type Page } from "playwright"
import { abortAfterAny } from "../util/abort"

const DEFAULT_TIMEOUT_MS = 30 * 1000
const MAX_TIMEOUT_MS = 120 * 1000

export const BrowserTool = Tool.define("browser", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z
      .enum(["navigate", "execute", "read"])
      .describe(
        "The browser action to perform: navigate (go to URL), execute (run JavaScript), or read (get DOM content)",
      ),
    url: z.string().describe("The URL to navigate to (required for navigate action)").optional(),
    script: z.string().describe("The JavaScript code to execute (required for execute action)").optional(),
    selector: z
      .string()
      .describe("CSS selector to target specific elements (optional for read action, reads full page if omitted)")
      .optional(),
    waitFor: z
      .enum(["load", "domcontentloaded", "networkidle"])
      .default("load")
      .describe("When to consider navigation complete (load, domcontentloaded, networkidle)"),
    timeout: z.number().describe("Optional timeout in seconds (max 120)").optional(),
  }),
  async execute(params, ctx) {
    const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000, MAX_TIMEOUT_MS)

    if (params.action === "navigate" && !params.url) {
      throw new Error("URL is required for navigate action")
    }
    if (params.action === "execute" && !params.script) {
      throw new Error("Script is required for execute action")
    }

    if (params.url && !params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    await ctx.ask({
      permission: "browser",
      patterns: params.url ? [params.url] : ["*"],
      always: ["*"],
      metadata: {
        action: params.action,
        url: params.url,
        hasScript: !!params.script,
        selector: params.selector,
      },
    })

    const { signal, clearTimeout } = abortAfterAny(timeout, ctx.abort)

    let browser: Browser | undefined
    let page: Page | undefined

    try {
      browser = await chromium.launch({ headless: true })
      page = await browser.newPage()
      await page.setViewportSize({ width: 1280, height: 720 })

      let result: { title: string; output: string; metadata: Record<string, any> }

      switch (params.action) {
        case "navigate": {
          const response = await page.goto(params.url!, {
            waitUntil: params.waitFor,
            timeout,
          })

          signal.throwIfAborted()

          const status = response?.status() ?? 0
          const title = await page.title().catch(() => "")
          const url = page.url()

          result = {
            title: `Navigated to ${url}`,
            output: `Successfully navigated to ${url}\nStatus: ${status}\nTitle: ${title}`,
            metadata: { status, url, title },
          }
          break
        }

        case "execute": {
          const execResult = await page.evaluate(params.script!)
          signal.throwIfAborted()

          const output = typeof execResult === "object" ? JSON.stringify(execResult, null, 2) : String(execResult)

          result = {
            title: "JavaScript executed",
            output,
            metadata: { resultType: typeof execResult },
          }
          break
        }

        case "read": {
          let content: string

          if (params.selector) {
            const elements = await page.locator(params.selector).all()
            const texts = await Promise.all(elements.map((el) => el.textContent().catch(() => "")))
            content = texts.join("\n")
          } else {
            content = await page.content()
          }

          signal.throwIfAborted()

          result = {
            title: params.selector ? `Read DOM elements matching "${params.selector}"` : "Read full page DOM",
            output: content,
            metadata: { selector: params.selector, length: content.length },
          }
          break
        }

        default:
          throw new Error(`Unknown action: ${params.action}`)
      }

      clearTimeout()
      return result
    } finally {
      if (page) await page.close().catch(() => {})
      if (browser) await browser.close().catch(() => {})
    }
  },
})
