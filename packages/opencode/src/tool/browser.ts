import z from "zod"
import { Tool } from "./tool"
import { Browser } from "../browser/browser"

/**
 * Browser Navigation Tool - Navigate to a URL
 */
export const BrowserNavigateTool = Tool.define("browser_navigate", {
  description: `Navigate the browser to a specified URL. This tool allows you to open a web page in the browser.

Use this tool when you need to:
- Open a specific website or web page
- Navigate to a URL provided by the user
- Start a browser automation session

The browser will load the page and make it available for further interaction.`,
  parameters: z.object({
    url: z.string().url().describe("The URL to navigate to (must start with http:// or https://)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_navigate",
      patterns: [params.url],
      always: ["*"],
      metadata: {
        url: params.url,
      },
    })

    const result = await Browser.navigate(params)

    if (!result.success) {
      throw new Error(result.error ?? "Navigation failed")
    }

    return {
      title: "Navigate to " + params.url,
      metadata: {},
      output: `Successfully navigated to ${params.url}\n\nPage title: ${result.data?.title ?? "Unknown"}`,
    }
  },
})

/**
 * Browser Screenshot Tool - Take a screenshot of the current page
 */
export const BrowserScreenshotTool = Tool.define("browser_screenshot", {
  description: `Take a screenshot of the current browser page.

Use this tool when you need to:
- Capture the visual state of a web page
- Show the user what the current page looks like
- Document the current state of a web application

The screenshot will be returned as base64 encoded image data.`,
  parameters: z.object({
    fullPage: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether to capture the full page (including content below the fold). Defaults to false."),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_screenshot",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        fullPage: params.fullPage,
      },
    })

    const result = await Browser.screenshot(params)

    if (!result.success) {
      throw new Error(result.error ?? "Screenshot failed")
    }

    return {
      title: "Take screenshot",
      metadata: {},
      output: `Screenshot captured successfully (${params.fullPage ? "full page" : "viewport"}).`,
    }
  },
})

/**
 * Browser Click Tool - Click on an element
 */
export const BrowserClickTool = Tool.define("browser_click", {
  description: `Click on an element matching a CSS selector.

Use this tool when you need to:
- Click on buttons, links, or other interactive elements
- Interact with form controls
- Navigate through a web interface

Provide a CSS selector that targets the element you want to click. Common selectors include:
- ID: #submit-button
- Class: .btn-primary
- Attribute: [data-testid="submit"]
- Combination: button[type="submit"].btn-primary`,
  parameters: z.object({
    selector: z.string().describe("CSS selector for the element to click (e.g., '#button-id', '.btn-primary', 'button[type=\"submit\"]')"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_click",
      patterns: [params.selector],
      always: ["*"],
      metadata: {
        selector: params.selector,
      },
    })

    const result = await Browser.click(params)

    if (!result.success) {
      throw new Error(result.error ?? "Click failed")
    }

    return {
      title: "Click element: " + params.selector,
      metadata: {},
      output: `Successfully clicked element: ${params.selector}`,
    }
  },
})

/**
 * Browser Type Tool - Type text into an element
 */
export const BrowserTypeTool = Tool.define("browser_type", {
  description: `Type text into an input field or other editable element.

Use this tool when you need to:
- Enter text into form fields
- Fill out search boxes
- Input data into text areas

The tool will first clear any existing text in the element before typing the new text.`,
  parameters: z.object({
    selector: z.string().describe("CSS selector for the input element (e.g., '#search-input', 'input[name=\"query\"]')"),
    text: z.string().describe("The text to type into the element"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_type",
      patterns: [params.selector],
      always: ["*"],
      metadata: {
        selector: params.selector,
        text: params.text,
      },
    })

    const result = await Browser.type(params)

    if (!result.success) {
      throw new Error(result.error ?? "Type failed")
    }

    return {
      title: "Type into element: " + params.selector,
      metadata: {},
      output: `Successfully typed "${params.text}" into element: ${params.selector}`,
    }
  },
})

/**
 * Browser Scroll Tool - Scroll the page
 */
export const BrowserScrollTool = Tool.define("browser_scroll", {
  description: `Scroll the page in a specified direction.

Use this tool when you need to:
- View content below or above the current viewport
- Navigate through long pages
- Bring elements into view`,
  parameters: z.object({
    direction: z.enum(["up", "down", "left", "right"]).describe("Direction to scroll"),
    amount: z.number().optional().default(500).describe("Amount to scroll in pixels (default: 500)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_scroll",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        direction: params.direction,
        amount: params.amount,
      },
    })

    const result = await Browser.scroll(params)

    if (!result.success) {
      throw new Error(result.error ?? "Scroll failed")
    }

    return {
      title: `Scroll ${params.direction}`,
      metadata: {},
      output: `Successfully scrolled ${params.direction} by ${params.amount}px`,
    }
  },
})

/**
 * Browser Extract Content Tool - Extract content from the page
 */
export const BrowserExtractContentTool = Tool.define("browser_extract", {
  description: `Extract content from the current page or from specific elements.

Use this tool when you need to:
- Read the text content of a page
- Extract data from specific elements
- Get the HTML structure of a page or element

If no selector is provided, the entire page content will be extracted.`,
  parameters: z.object({
    selector: z.string().optional().describe("CSS selector to extract content from (optional, extracts entire page if not provided)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_extract",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        selector: params.selector,
      },
    })

    const result = await Browser.extractContent(params)

    if (!result.success) {
      throw new Error(result.error ?? "Content extraction failed")
    }

    const output = params.selector
      ? `Content from ${params.selector}:\n\n${result.content ?? "No content found"}`
      : `Page content:\n\n${result.content ?? "No content found"}`

    return {
      title: "Extract page content",
      metadata: {},
      output,
    }
  },
})

/**
 * Browser Execute Script Tool - Execute JavaScript in the browser
 */
export const BrowserExecuteScriptTool = Tool.define("browser_execute", {
  description: `Execute JavaScript code in the browser context.

Use this tool when you need to:
- Perform complex interactions not supported by other tools
- Extract data that requires JavaScript processing
- Interact with pages that use heavy JavaScript

The script will be executed in the browser's JavaScript context and has access to the DOM, window, document, etc.

Return values from the script will be serialized and returned as the tool output.`,
  parameters: z.object({
    script: z.string().describe("JavaScript code to execute (e.g., 'document.title', 'Array.from(document.querySelectorAll(\"a\")).map(a => a.href)')"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_execute",
      patterns: ["*"],
      always: ["*"],
      metadata: {
        script: params.script,
      },
    })

    const result = await Browser.executeScript(params)

    if (!result.success) {
      throw new Error(result.error ?? "Script execution failed")
    }

    const output = typeof result.data === "object"
      ? JSON.stringify(result.data, null, 2)
      : String(result.data ?? "Script executed successfully")

    return {
      title: "Execute JavaScript",
      metadata: {},
      output: `Script executed successfully. Result:\n\n${output}`,
    }
  },
})

/**
 * Browser Query Selector Tool - Query elements using CSS selector
 */
export const BrowserQuerySelectorTool = Tool.define("browser_query", {
  description: `Query elements on the page using a CSS selector.

Use this tool when you need to:
- Find elements on the page
- Check if specific elements exist
- Get information about multiple matching elements

Returns a list of matching elements with their selectors, text content, and positions.`,
  parameters: z.object({
    query: z.string().describe("CSS query selector (e.g., 'a', '.btn-primary', '[data-testid]')"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_query",
      patterns: [params.query],
      always: ["*"],
      metadata: {
        query: params.query,
      },
    })

    const result = await Browser.querySelector(params)

    if (!result.success) {
      throw new Error(result.error ?? "Query failed")
    }

    const elements = result.data ?? []
    const output = elements.length > 0
      ? `Found ${elements.length} element(s):\n\n${JSON.stringify(elements, null, 2)}`
      : `No elements found matching: ${params.query}`

    return {
      title: "Query selector: " + params.query,
      metadata: {},
      output,
    }
  },
})

/**
 * Browser Wait Tool - Wait for an element to appear
 */
export const BrowserWaitTool = Tool.define("browser_wait", {
  description: `Wait for an element matching a CSS selector to appear on the page.

Use this tool when you need to:
- Wait for dynamically loaded content
- Ensure an element is present before interacting with it
- Handle pages with lazy loading or async content

The tool will wait up to the specified timeout for the element to appear.`,
  parameters: z.object({
    selector: z.string().describe("CSS selector to wait for"),
    timeout: z.number().optional().default(5000).describe("Timeout in milliseconds (default: 5000)"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser_wait",
      patterns: [params.selector],
      always: ["*"],
      metadata: {
        selector: params.selector,
        timeout: params.timeout,
      },
    })

    const result = await Browser.waitForSelector({
      selector: params.selector,
      timeout: params.timeout,
    })

    if (!result.success) {
      throw new Error(result.error ?? "Wait failed")
    }

    return {
      title: "Wait for element: " + params.selector,
      metadata: {},
      output: `Element ${params.selector} appeared within ${params.timeout}ms`,
    }
  },
})

// Export all browser tools
export const browserTools = [
  BrowserNavigateTool,
  BrowserScreenshotTool,
  BrowserClickTool,
  BrowserTypeTool,
  BrowserScrollTool,
  BrowserExtractContentTool,
  BrowserExecuteScriptTool,
  BrowserQuerySelectorTool,
  BrowserWaitTool,
]
