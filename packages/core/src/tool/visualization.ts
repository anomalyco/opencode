export * as VisualizationTool from "./visualization"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { Parser } from "htmlparser2"
import { makeLocationNode } from "../effect/app-node"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "visualization_create"
export const MODEL_OUTPUT = "Visualization created"
export const MAX_TITLE_LENGTH = 120
export const MAX_HTML_BYTES = 128 * 1024

export const Input = Schema.Struct({
  title: Schema.String.annotate({ description: "A concise title for the visualization" }),
  html: Schema.String.annotate({ description: "An HTML fragment containing the visualization" }),
})

export const Output = Schema.Struct({
  version: Schema.Literal(1),
  title: Schema.String,
  html: Schema.String,
})
export type Output = typeof Output.Type

const documentRoots = new Set(["html", "head", "body"])

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "Create an interactive visualization from a self-contained HTML fragment hosted on a transparent conversation background. Do not set a background on html, body, or a full-viewport wrapper. Do not use 100vh or negative page margins; put intentional backgrounds only on bounded visual elements such as cards, charts, and clock faces.",
          input: Input,
          output: Output,
          toModelOutput: () => [{ type: "text", text: MODEL_OUTPUT }],
          execute: (input) => {
            const title = input.title.trim()
            const titleLength = Array.from(title).length
            if (titleLength < 1 || titleLength > MAX_TITLE_LENGTH)
              return Effect.fail(
                new ToolFailure({
                  message: `Visualization title must contain 1 to ${MAX_TITLE_LENGTH} Unicode characters`,
                }),
              )
            if (!input.html.trim())
              return Effect.fail(new ToolFailure({ message: "Visualization HTML must not be empty" }))
            if (Buffer.byteLength(input.html, "utf-8") > MAX_HTML_BYTES)
              return Effect.fail(
                new ToolFailure({
                  message: `Visualization HTML must not exceed ${MAX_HTML_BYTES / 1024} KiB in UTF-8`,
                }),
              )
            return Effect.try({
              try: () => {
                if (!isFragment(input.html)) throw new Error("document root")
                return { version: 1 as const, title, html: input.html }
              },
              catch: () => new ToolFailure({ message: "Visualization HTML must be a fragment" }),
            })
          },
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/visualization",
  layer,
  deps: [ToolRegistry.node],
})

function isFragment(html: string) {
  let valid = true
  const parser = new Parser(
    {
      onprocessinginstruction(name) {
        if (name.toLowerCase() === "!doctype") valid = false
      },
      onopentag(name) {
        if (documentRoots.has(name.toLowerCase())) valid = false
      },
    },
    { recognizeSelfClosing: true },
  )
  parser.end(html)
  return valid
}
