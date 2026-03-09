import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./browser.txt"
import { chromium, type Browser, type Page } from "playwright"
import { Log } from "../util/log"

export namespace BrowserTool {
  const log = Log.create({ service: "browser-tool" })
  let browser: Browser | null = null

  async function getPage(): Promise<Page> {
    if (!browser) {
      browser = await chromium.launch({ headless: true })
    }
    const context = await browser.newContext()
    return await context.newPage()
  }

  export const Instance = Tool.define("browser", {
    description: DESCRIPTION,
    parameters: z.object({
      action: z.enum(["navigate", "click", "type", "screenshot", "getContent"]).describe("The action to perform"),
      url: z.string().optional().describe("The URL to navigate to"),
      selector: z.string().optional().describe("The CSS selector for the element"),
      text: z.string().optional().describe("The text to type"),
      wait_for: z.string().optional().describe("Element or timeout to wait for"),
    }),
    async execute(params, ctx) {
      const page = await getPage()
      let output = ""
      let title = "Browser Action"

      try {
        switch (params.action) {
          case "navigate":
            if (!params.url) throw new Error("URL is required for navigate action")
            await page.goto(params.url)
            output = `Navigated to ${params.url}`
            title = `Navigate: ${params.url}`
            break
          case "click":
            if (!params.selector) throw new Error("Selector is required for click action")
            await page.click(params.selector)
            output = `Clicked element ${params.selector}`
            title = `Click: ${params.selector}`
            break
          case "type":
            if (!params.selector || !params.text) throw new Error("Selector and text are required for type action")
            await page.type(params.selector, params.text)
            output = `Typed text into ${params.selector}`
            title = `Type: ${params.selector}`
            break
          case "screenshot":
            const buffer = await page.screenshot()
            output = "Screenshot taken successfully."
            title = "Browser Screenshot"
            return {
              title,
              output,
              metadata: {},
              attachments: [
                {
                  type: "file",
                  mime: "image/png",
                  url: `data:image/png;base64,${buffer.toString("base64")}`,
                },
              ],
            }
          case "getContent":
            output = await page.content()
            title = "Page Content"
            break
        }
      } catch (error) {
        log.error("browser action failed", { error })
        throw error
      }

      return {
        title,
        output,
        metadata: {},
      }
    },
  })
}

export const BrowserToolDefinition = BrowserTool.Instance
