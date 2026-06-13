import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const DESCRIPTION = `Control the in-app browser to navigate websites, interact with elements, and extract information.

Use this tool when you need to:
- Visit a specific website to gather information
- Interact with web pages (click buttons, fill forms, scroll)
- Take screenshots of web pages for visual analysis
- Extract text content from websites
- Search for information on Google or other search engines

The browser operates in a visible panel within the app, so the user can watch the automation in real-time. After navigating to a page, always take a screenshot first to see what's on the page before interacting with elements.

NOTE: The browser tab will be automatically opened if it's not already active. You do not need to ask the user to click it first.`

export const Parameters = Schema.Struct({
  action: Schema.Literals([
    "navigate",
    "click",
    "type",
    "scroll",
    "screenshot",
    "getContent",
    "getUrl",
  ]).annotate({ description: "The browser action to perform" }),
  url: Schema.optional(Schema.String).annotate({
    description: "URL to navigate to (required for navigate action). Must start with http:// or https://",
  }),
  x: Schema.optional(Schema.Number).annotate({
    description: "X coordinate for click or type action (pixel position on screen)",
  }),
  y: Schema.optional(Schema.Number).annotate({
    description: "Y coordinate for click or type action (pixel position on screen)",
  }),
  text: Schema.optional(Schema.String).annotate({
    description: "Text to type into an input field (required for type action)",
  }),
  clear: Schema.optional(Schema.Boolean).annotate({
    description: "Whether to clear existing text before typing (default: true)",
  }),
  down: Schema.optional(Schema.Boolean).annotate({
    description: "Direction to scroll - true for down, false for up (default: true)",
  }),
  amount: Schema.optional(Schema.Number).annotate({
    description: "Amount to scroll in screen heights (default: 3)",
  }),
})

export const WebBrowserTool = Tool.define(
  "browser_automation",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "browser_automation",
            patterns: params.url ? [params.url] : ["*"],
            always: ["*"],
            metadata: { action: params.action, url: params.url },
          })

          // Call the desktop automation server
          const response = yield* Effect.promise(() =>
            fetch("http://127.0.0.1:17777/browser-automation", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(params),
            }),
          )

          if (!response.ok) {
            throw new Error(`Browser automation failed: ${response.status} ${response.statusText}`)
          }

          const result = yield* Effect.promise(() => response.json()) as Effect.Effect<{
            success: boolean
            url?: string
            title?: string
            content?: string
            error?: string
          }>

          if (!result.success) {
            throw new Error(result.error || "Browser automation failed")
          }

          // Format the output
          const lines: string[] = []
          if (result.title) lines.push(`Title: ${result.title}`)
          if (result.url) lines.push(`URL: ${result.url}`)
          if (result.content) lines.push(`Content:\n${result.content}`)

          const output = lines.join("\n") || "Browser action completed successfully"

          return {
            title: result.title || "Browser Automation",
            output,
            metadata: { url: result.url, action: params.action },
          }
        }),
    }
  }),
)
