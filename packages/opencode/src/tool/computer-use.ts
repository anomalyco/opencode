import { Effect, Schema } from "effect"
import * as Tool from "./tool"

const DESCRIPTION = `Control the computer by taking screenshots, clicking, typing, and pressing keys.

Use this tool when you need to:
- Take a screenshot to see the current state of the screen
- Click on UI elements at specific coordinates
- Type text into input fields
- Press keyboard keys or shortcuts
- Scroll or drag on the screen

After taking a screenshot, analyze it to determine the coordinates of elements you want to interact with.

NOTE: This tool uses system-level automation and requires appropriate permissions. It will automatically prompt for permission if needed.`

export const Parameters = Schema.Struct({
  action: Schema.Literals([
    "screenshot",
    "click",
    "type",
    "press_key",
    "scroll",
    "drag",
    "get_state",
  ]).annotate({ description: "The computer action to perform" }),
  x: Schema.optional(Schema.Number).annotate({
    description: "X coordinate for click, scroll, or drag start (pixel position on screen)",
  }),
  y: Schema.optional(Schema.Number).annotate({
    description: "Y coordinate for click, scroll, or drag start (pixel position on screen)",
  }),
  text: Schema.optional(Schema.String).annotate({
    description: "Text to type (required for type action)",
  }),
  key: Schema.optional(Schema.String).annotate({
    description: "Key to press like Return, Tab, Escape, or a letter/number (required for press_key action)",
  }),
  modifiers: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Modifier keys for press_key: command, shift, option, control",
  }),
  toX: Schema.optional(Schema.Number).annotate({
    description: "End X coordinate for drag action",
  }),
  toY: Schema.optional(Schema.Number).annotate({
    description: "End Y coordinate for drag action",
  }),
  deltaY: Schema.optional(Schema.Number).annotate({
    description: "Scroll amount in pixels (positive for down, negative for up, default: 300)",
  }),
})

type ComputerUseResponse = {
  success: boolean
  message?: string
  screenshot?: { buffer: string; width: number; height: number }
  error?: string
}

export const ComputerUseTool = Tool.define(
  "computer_use",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "computer_use",
            patterns: ["*"],
            always: ["*"],
            metadata: { action: params.action },
          })

          // Call the desktop computer-use server
          const response = yield* Effect.promise(() =>
            fetch("http://127.0.0.1:17777/computer-use", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(params),
            }),
          )

          if (!response.ok) {
            throw new Error(`Computer use failed: ${response.status} ${response.statusText}`)
          }

          const result = (yield* Effect.promise(() => response.json())) as ComputerUseResponse

          if (!result.success) {
            throw new Error(result.error || "Computer use failed")
          }

          const attachments = result.screenshot
            ? [
                {
                  type: "file" as const,
                  mime: "image/png",
                  url: `data:image/png;base64,${result.screenshot.buffer}`,
                  filename: `screenshot-${Date.now()}.png`,
                },
              ]
            : undefined

          return {
            title: result.message || "Computer Use",
            output: result.message || "Action completed successfully",
            attachments,
            metadata: { action: params.action },
          }
        }),
    }
  }),
)
