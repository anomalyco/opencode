import z from "zod"
import { Tool } from "../tool"
import { BrowserClient } from "../../browser/client"
import { BrowserState } from "../../browser/state"

export const BrowserWaitTool = Tool.define("browser_wait", {
  description: `Wait for a condition to be met in the browser before proceeding. Useful for waiting for page loads, element appearance, or dynamic content.

Use this tool to:
- Wait for a page to fully load after navigation
- Wait for an element to appear (e.g., after a form submission)
- Wait for specific text to appear on the page
- Add a delay between browser actions when needed`,
  parameters: z.object({
    ref: z.string().optional().describe("Element reference to wait for (e.g., '@e5'). Waits until the element is present in the DOM."),
    text: z.string().optional().describe("Text to wait for on the page."),
    url: z.string().optional().describe("URL pattern to wait for (e.g., '/dashboard')."),
    milliseconds: z.number().optional().describe("Simple delay in milliseconds. Use when you need a fixed wait time."),
    load: z.boolean().optional().describe("If true, waits for the page to finish loading."),
  }),
  async execute(params, ctx) {
    ctx.metadata({ title: "Waiting..." })

    let args: string[]

    if (params.ref) {
      args = [params.ref]
    } else if (params.text) {
      args = ["--text", params.text]
    } else if (params.url) {
      args = ["--url", params.url]
    } else if (params.load) {
      args = ["--load"]
    } else if (params.milliseconds) {
      args = [String(params.milliseconds)]
    } else {
      args = ["--load"]
    }

    const result = await BrowserClient.exec(ctx.sessionID, ["wait", ...args], {
      timeout: 60_000,
      abort: ctx.abort,
    })

    if (result.exitCode !== 0) {
      throw new Error(`Wait failed: ${result.error || result.output}`)
    }

    // Get snapshot after waiting
    const snapshot = await BrowserClient.snapshot(ctx.sessionID, {
      interactive: true,
      abort: ctx.abort,
    })

    BrowserState.setSnapshot(ctx.sessionID, snapshot.output)

    const desc = params.ref
      ? `element ${params.ref}`
      : params.text
        ? `text "${params.text}"`
        : params.url
          ? `URL "${params.url}"`
          : params.milliseconds
            ? `${params.milliseconds}ms`
            : "page load"

    return {
      title: `Waited for ${desc}`,
      metadata: {},
      output: `Wait completed (${desc})\n\n--- Page Snapshot ---\n${snapshot.output}`,
    }
  },
})
