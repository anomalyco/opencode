import { Tool, ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { ToolRegistry } from "./registry"
import { EventV2Bridge } from "../event-v2-bridge"
import { TuiEvent } from "../../opencode/src/cli/cmd/tui/event"

export const browserNavigate = Tool.make({
  description: "Navigate the integrated browser to a specific URL.",
  parameters: Schema.Struct({
    url: Schema.String.annotate({ description: "The URL to navigate to" }),
  }),
  success: Schema.Struct({
    status: Schema.String,
  }),
})

export const browserClick = Tool.make({
  description: "Click an element in the integrated browser.",
  parameters: Schema.Struct({
    selector: Schema.String.annotate({ description: "CSS selector of the element to click" }),
  }),
  success: Schema.Struct({
    status: Schema.String,
  }),
})

export const browserType = Tool.make({
  description: "Type text into an input field in the integrated browser.",
  parameters: Schema.Struct({
    selector: Schema.String.annotate({ description: "CSS selector of the input field" }),
    text: Schema.String.annotate({ description: "The text to type" }),
  }),
  success: Schema.Struct({
    status: Schema.String,
  }),
})

export const browserSnapshot = Tool.make({
  description: "Request a snapshot of the current page from the integrated browser. The snapshot will be sent as a message to the session.",
  parameters: Schema.Struct({}),
  success: Schema.Struct({
    status: Schema.String,
  }),
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const events = yield* EventV2Bridge.Service

    const sendBrowserCommand = (command: "navigate" | "click" | "type" | "snapshot", params: any) =>
      Effect.gen(function* () {
        yield* events.publish(TuiEvent.BrowserControl, {
          command,
          params,
        })
        return { status: "Command sent to browser" }
      })

    yield* registry.contribute((editor) => {
      editor.set("browser_navigate", {
        tool: browserNavigate,
        execute: ({ parameters }) => sendBrowserCommand("navigate", parameters),
      })
      editor.set("browser_click", {
        tool: browserClick,
        execute: ({ parameters }) => sendBrowserCommand("click", parameters),
      })
      editor.set("browser_type", {
        tool: browserType,
        execute: ({ parameters }) => sendBrowserCommand("type", parameters),
      })
      editor.set("browser_snapshot", {
        tool: browserSnapshot,
        execute: () => sendBrowserCommand("snapshot", {}),
      })
    })
  }),
)
