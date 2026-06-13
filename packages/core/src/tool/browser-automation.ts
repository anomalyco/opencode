export * as BrowserAutomationTool from "./browser-automation"

import { Tool, ToolFailure, toolText } from "@cedric/llm"
import { Cause, Effect, Layer, Schema } from "effect"
import { ToolRegistry } from "./registry"

export const name = "browser_automation"

export const description = `Control the in-app browser to navigate websites, interact with elements, and extract information.

Use this tool when you need to:
- Visit a specific website to gather information
- Interact with web pages (click, type, scroll)
- Take screenshots of web pages
- Extract content from websites
- Fill out forms

The browser operates in a visible panel so the user can see what's happening. Always take a screenshot after navigation to confirm the page loaded correctly.`

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
  url: Schema.String.pipe(Schema.optional).annotate({
    description: "URL to navigate to (required for navigate action)",
  }),
  x: Schema.Number.pipe(Schema.optional).annotate({
    description: "X coordinate for click or type action",
  }),
  y: Schema.Number.pipe(Schema.optional).annotate({
    description: "Y coordinate for click or type action",
  }),
  text: Schema.String.pipe(Schema.optional).annotate({
    description: "Text to type (required for type action)",
  }),
  clear: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Whether to clear existing text before typing",
  }),
  down: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Direction to scroll (true=down, false=up). Defaults to down.",
  }),
  amount: Schema.Number.pipe(Schema.optional).annotate({
    description: "Amount to scroll (number of screen heights). Defaults to 3.",
  }),
})

export const Success = Schema.Struct({
  success: Schema.Boolean,
  url: Schema.String.pipe(Schema.optional),
  title: Schema.String.pipe(Schema.optional),
  content: Schema.String.pipe(Schema.optional),
  error: Schema.String.pipe(Schema.optional),
})

const definition = Tool.make({
  description,
  parameters: Parameters,
  success: Success,
  toModelOutput: ({ output }) => {
    const lines: string[] = []
    if (output.url) lines.push(`URL: ${output.url}`)
    if (output.title) lines.push(`Title: ${output.title}`)
    if (output.content) lines.push(`Content:\n${output.content}`)
    if (output.error) lines.push(`Error: ${output.error}`)
    return [toolText({ type: "text", text: lines.join("\n") })]
  },
})

const DESKTOP_AUTOMATION_PORT = 17777

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters }) =>
          Effect.gen(function* () {
            // Try to call the desktop automation server
            try {
              const response = yield* Effect.promise(() =>
                fetch(`http://127.0.0.1:${DESKTOP_AUTOMATION_PORT}/browser-automation`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(parameters),
                }),
              )

              if (!response.ok) {
                return {
                  success: false,
                  error: `Desktop automation server returned ${response.status}. Make sure Cedric desktop is running with the browser panel open.`,
                }
              }

              const result = yield* Effect.promise(() => response.json())
              return result as typeof Success.Type
            } catch (error) {
              return {
                success: false,
                error: `Browser automation failed: ${error}. Make sure Cedric desktop is running with the browser panel open.`,
              }
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.fail(new ToolFailure({ message: "Browser automation failed", error: Cause.squash(cause) })),
            ),
          ),
      }),
    )
  }),
)
