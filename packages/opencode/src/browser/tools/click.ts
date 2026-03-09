import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Click on an element in the browser page.

Parameters:
- element (string, optional): Human-readable element description
- ref (string, optional): Exact target element reference from page snapshot
- selector (string, optional): CSS selector of element to click
- x (number, optional): X coordinate for click
- y (number, optional): Y coordinate for click
- button (string, optional): 'left', 'right', or 'middle' (default: 'left')
- doubleClick (boolean, optional): Whether to double-click (default: false)
- modifiers (array, optional): Modifier keys like ['Shift', 'Control']

Either selector, ref, or both x/y coordinates must be provided.
`

export const BrowserClickTool = Tool.define("browser_click", {
  description: DESCRIPTION,
  parameters: z.object({
    element: z.string().optional().describe("Human-readable element description"),
    ref: z.string().optional().describe("Exact target element reference from page snapshot"),
    selector: z.string().optional().describe("CSS selector of element to click"),
    x: z.number().optional().describe("X coordinate for click"),
    y: z.number().optional().describe("Y coordinate for click"),
    button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button to use"),
    doubleClick: z.boolean().default(false).describe("Whether to perform a double click"),
    return_content: z
      .enum(["text", "links", "inputs", "screenshot", "structured"])
      .optional()
      .describe("Return page content in specified format after click"),
    modifiers: z.array(z.string()).optional().describe("Modifier keys to press"),
  }),
  async execute(params, ctx) {
    const target = params.selector || params.ref || `coordinates(${params.x},${params.y})`

    if (!params.selector && !params.ref && (params.x === undefined || params.y === undefined)) {
      throw new Error("Either selector, ref, or both x and y coordinates must be provided")
    }

    await ctx.ask({
      permission: "browser",
      patterns: [target],
      always: ["*"],
      metadata: { action: "click", element: params.element, selector: params.selector, x: params.x, y: params.y },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("clicking", { selector: params.selector || params.ref, x: params.x, y: params.y })

    try {
      let finalSelector = params.selector || params.ref

      // If element description provided, use fuzzy search to find it
      if (params.element) {
        log.info("using fuzzy search to find element", { element: params.element })
        const searchResults = await BrowserManager.searchElements({ text: params.element })
        if (searchResults.length > 0) {
          finalSelector = searchResults[0].selector
          log.info("found element via fuzzy search", { selector: finalSelector })
        }
      }

      // If ref is numeric (from list_* outputs), map it back to a selector from listed elements
      if (!finalSelector && params.ref && /^\d+$/.test(params.ref)) {
        const refIndex = Number(params.ref) - 1

        // Heuristic: try to guess element category from description
        const refType: "inputs" | "buttons" | "links" | "all" =
          params.element?.toLowerCase().includes("input") || params.element?.toLowerCase().includes("search")
            ? "inputs"
            : params.element?.toLowerCase().includes("button")
              ? "buttons"
              : params.element?.toLowerCase().includes("link")
                ? "links"
                : "all"

        const listResult = await BrowserManager.listElements(refType)
        const match = listResult.elements[refIndex]
        if (match?.selector) {
          finalSelector = match.selector
          log.info("resolved numeric ref to selector", { ref: params.ref, selector: finalSelector, refType })
        } else {
          log.warn("numeric ref out of range", { ref: params.ref, refType, available: listResult.elements.length })
        }
      }

      // If no element description provided but we have ref (non-numeric), use fuzzy search with ref context
      if (!finalSelector && !params.element && params.ref) {
        log.info("searching for element referenced by ref", { ref: params.ref })
        // Try to find best matching element (ref might be a description)
        const searchResults = await BrowserManager.searchElements({ text: params.ref })
        if (searchResults.length > 0) {
          finalSelector = searchResults[0].selector
          log.info("found element by ref", { selector: finalSelector })
        }
      }

      // As last resort, if still no finalSelector but we have element description, search again
      if (!finalSelector && params.element) {
        const searchResults = await BrowserManager.searchElements({ text: params.element })
        if (searchResults.length > 0) {
          finalSelector = searchResults[0].selector
          log.info("found element by description", { selector: finalSelector })
        }
      }

      // If still no selector found, throw error
      if (!finalSelector && !params.x) {
        throw new Error(
          `Could not find element: element="${params.element}", ref="${params.ref}", selector="${params.selector}"`,
        )
      }

      // Auto-scroll to element before clicking if using selector
      if (finalSelector) {
        log.info("scrolling to element", { selector: finalSelector })
        try {
          await BrowserManager.scroll({ selector: finalSelector })
        } catch (scrollErr) {
          log.warn("scroll failed, continuing with click", { error: String(scrollErr) })
        }
      }

      // Animate cursor before clicking
      if (params.x !== undefined && params.y !== undefined) {
        await BrowserManager.animateCursorTo(params.x, params.y)
      }

      await BrowserManager.click({
        selector: finalSelector,
        coordinates: params.x !== undefined && params.y !== undefined ? { x: params.x, y: params.y } : undefined,
        button: params.button,
        clickCount: params.doubleClick ? 2 : 1,
      })

      const desc = params.element || params.selector || params.ref || `(${params.x}, ${params.y})`

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
        title: `Clicked: ${desc}`,
        metadata: {
          element: params.element,
          selector: params.selector || params.ref,
          x: params.x,
          y: params.y,
          button: params.button,
          doubleClick: params.doubleClick,
        },
        output: `Successfully clicked on ${desc}${contentOutput}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("click failed", { error: message })
      throw new Error(`Click failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserClickTool)
