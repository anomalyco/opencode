import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const MAX_CONTENT_LENGTH = 50_000

const DESCRIPTION = `Get the content of the current browser page.

PREFERRED: Use 'list_buttons', 'list_inputs', 'list_textareas', 'list_links' formats for efficient element context.
These return numbered elements that can be referenced directly, using fewer tokens than text/html.

Parameters:
- format (string): Content format to return:
  - 'text': Plain text content (good for reading)
  - 'html': Raw HTML (avoid - causes context overflow)
  - 'list_buttons': [PREFERRED] Numbered list of all buttons
  - 'list_inputs': [PREFERRED] Numbered list of all input fields
  - 'list_textareas': [PREFERRED] Numbered list of all textareas
  - 'list_links': [PREFERRED] Numbered list of all links
  - 'structured': JSON of all interactive elements
- selector (string, optional): CSS selector to limit extraction
- search (object, optional): Filter elements by text, id, class, innerHTML
`

export const BrowserContentTool = Tool.define("browser_content", {
  description: DESCRIPTION,
  parameters: z.object({
    format: z
      .enum(["text", "html", "list_buttons", "list_inputs", "list_textareas", "list_links", "structured"])
      .default("text")
      .describe("Content format to return"),
    selector: z.string().optional().describe("CSS selector to limit extraction"),
    search: z
      .object({
        text: z.string().optional().describe("Filter by text content"),
        id: z.string().optional().describe("Filter by element ID"),
        className: z.string().optional().describe("Filter by CSS class"),
        innerHTML: z.string().optional().describe("Filter by innerHTML content"),
        placeholder: z.string().optional().describe("Filter by placeholder text"),
      })
      .optional()
      .describe("Filter criteria for elements"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["content"],
      always: ["*"],
      metadata: { action: "content", format: params.format, selector: params.selector },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("getting content", { format: params.format, selector: params.selector })

    try {
      const info = await BrowserManager.getPageInfo()
      const title = info?.title || ""
      const url = info?.url || ""

      let content: string
      let metadata: Record<string, unknown> = {
        url,
        pageTitle: title,
        format: params.format,
        selector: params.selector,
      }

      // Handle list formats for efficient context
      if (params.format === "list_buttons") {
        const result = await BrowserManager.listElements("buttons")
        content = `Buttons on page (${result.elements.length} total):\n${result.summary}`
        metadata.elementCount = result.elements.length
        metadata.elementType = "buttons"
      } else if (params.format === "list_inputs") {
        const result = await BrowserManager.listElements("inputs")
        content = `Input fields on page (${result.elements.length} total):\n${result.summary}`
        metadata.elementCount = result.elements.length
        metadata.elementType = "inputs"
      } else if (params.format === "list_textareas") {
        const result = await BrowserManager.listElements("textareas")
        content = `Textareas on page (${result.elements.length} total):\n${result.summary}`
        metadata.elementCount = result.elements.length
        metadata.elementType = "textareas"
      } else if (params.format === "list_links") {
        const result = await BrowserManager.listElements("links")
        content = `Links on page (${result.elements.length} total):\n${result.summary}`
        metadata.elementCount = result.elements.length
        metadata.elementType = "links"
      } else if (params.format === "structured") {
        // If search filters provided, use searchElements
        if (params.search) {
          const elements = await BrowserManager.searchElements(params.search)
          content = JSON.stringify(elements, null, 2)
          metadata.elementCount = elements.length
          metadata.filtered = true
        } else {
          const elements = await BrowserManager.getInteractiveElements()
          content = JSON.stringify(elements, null, 2)
          metadata.elementCount = elements.length
        }
      } else {
        // Text or HTML format
        const result = await BrowserManager.getContent({
          format: params.format as "text" | "html",
          selector: params.selector,
        })
        content = params.format === "html" ? result.html : result.text
      }

      // Truncate if too long
      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated...]"
        metadata.truncated = true
      }

      metadata.contentLength = content.length

      return {
        title: `Content: ${title}`,
        metadata,
        output: content,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("content retrieval failed", { error: message })
      throw new Error(`Content retrieval failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserContentTool)
