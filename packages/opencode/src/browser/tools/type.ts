import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Type text into an editable element.

Parameters:
- element (string): Human-readable element description
- ref (string): Exact target element reference from page snapshot
- text (string): Text to type into the element
- submit (boolean, optional): Whether to press Enter after typing
- slowly (boolean, optional): Type one character at a time (default: false)

The element must be focused/clicked first or provide a valid ref.
`

export const BrowserTypeTool = Tool.define("browser_type", {
  description: DESCRIPTION,
  parameters: z.object({
    element: z.string().describe("Human-readable element description"),
    ref: z.string().describe("Exact target element reference from the page snapshot"),
    text: z.string().describe("Text to type into the element"),
    submit: z.boolean().default(false).describe("Whether to submit (press Enter after)"),
    return_content: z
      .enum(["text", "links", "inputs", "screenshot", "structured"])
      .optional()
      .describe("Return page content in specified format after typing"),
    slowly: z.boolean().default(false).describe("Whether to type one character at a time"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: [params.ref],
      always: ["*"],
      metadata: { action: "type", element: params.element, textLength: params.text.length },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("typing", { element: params.element, textLength: params.text.length })

    try {
      let finalSelector: string | undefined = params.ref && !/^\d+$/.test(params.ref) ? params.ref : undefined

      // If ref is numeric from list_inputs, resolve to selector directly
      if (!finalSelector && params.ref && /^\d+$/.test(params.ref)) {
        const refIndex = Number(params.ref) - 1
        const listResult = await BrowserManager.listElements("inputs")
        const match = listResult.elements[refIndex]
        if (match?.selector) {
          finalSelector = match.selector
          log.info("resolved numeric ref to input selector", { ref: params.ref, selector: finalSelector })
        } else {
          log.warn("numeric ref out of range for inputs", { ref: params.ref, available: listResult.elements.length })
        }
      }

      // If element description provided, use fuzzy search to find it
      if (!finalSelector && params.element) {
        log.info("using fuzzy search to find input element", { element: params.element })
        const searchResults = await BrowserManager.searchElements({ text: params.element })
        if (searchResults.length > 0) {
          finalSelector = searchResults[0].selector
          log.info("found input element via fuzzy search", { selector: finalSelector })
        }
      }

      // If no element description but have non-numeric ref, search for ref as description
      if (!finalSelector && params.ref) {
        log.info("searching for element by ref", { ref: params.ref })
        const searchResults = await BrowserManager.searchElements({ text: params.ref })
        if (searchResults.length > 0) {
          finalSelector = searchResults[0].selector
          log.info("found element by ref", { selector: finalSelector })
        }
      }

      // If still no selector found, throw error
      if (!finalSelector) {
        throw new Error(`Could not find input element: element="${params.element}", ref="${params.ref}"`)
      }

      await BrowserManager.type({
        selector: finalSelector,
        text: params.text,
        clear: false,
        pressEnter: params.submit,
        delay: params.slowly ? 100 : 20,
      })

      let contentOutput = ""
      if (params.return_content) {
        switch (params.return_content) {
          case "text": {
            const result = await BrowserManager.getContent()
            contentOutput = `\n\nPage text:\n${result.text.slice(0, 500)}...`
            break
          }
          case "links": {
            const elements = await BrowserManager.getInteractiveElements({ type: "clickable" })
            const links = elements.filter((e) => e.tagName === "a").slice(0, 5)
            contentOutput = `\n\nFound ${links.length} links:\n${links.map((e) => `- ${e.text}`).join("\n")}`
            break
          }
          case "inputs": {
            const elements = await BrowserManager.getInteractiveElements({ type: "input" })
            contentOutput = `\n\nFound ${elements.length} inputs:\n${elements
              .slice(0, 5)
              .map((e) => `- ${e.type}: ${e.placeholder || e.text}`)
              .join("\n")}`
            break
          }
          case "screenshot": {
            await BrowserManager.screenshot()
            contentOutput = `\n\nScreenshot taken`
            break
          }
          case "structured": {
            const result = await BrowserManager.snapshot()
            const elementCount = Object.keys(result.elementMap).length
            contentOutput = `\n\nPage has ${elementCount} interactive elements`
            break
          }
        }
      }

      return {
        title: `Typed in: ${params.element}`,
        metadata: {
          element: params.element,
          ref: params.ref,
          textLength: params.text.length,
          submitted: params.submit,
        },
        output: `Successfully typed ${params.text.length} characters into "${params.element}"${params.submit ? " and pressed Enter" : ""}${contentOutput}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("type failed", { error: message })
      throw new Error(`Type failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserTypeTool)
