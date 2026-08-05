import { Effect, Schema } from "effect"
import { Parser } from "htmlparser2"
import * as Tool from "./tool"

export const MODEL_OUTPUT = "Visualization created"
export const MAX_TITLE_LENGTH = 120
export const MAX_HTML_BYTES = 128 * 1024

export const Parameters = Schema.Struct({
  title: Schema.String.annotate({ description: "A concise title for the visualization" }),
  html: Schema.String.annotate({ description: "An HTML fragment containing the visualization" }),
})

type Metadata = {
  version: 1
  title: string
  html: string
  truncated?: boolean
}

const documentRoots = new Set(["html", "head", "body"])

export const VisualizationTool = Tool.define<typeof Parameters, Metadata, never>(
  "visualization_create",
  Effect.succeed({
    description:
      "Render a self-contained interactive HTML visualization inline on a transparent conversation background in the current Desktop conversation. Do not set a background on html, body, or a full-viewport wrapper. Do not use 100vh or negative page margins; put intentional backgrounds only on bounded visual elements such as cards, charts, and clock faces. Use this whenever the user asks to view, preview, explore, simulate, plot, or adjust an interactive visual in the chat. Do not use Shell or create/open an HTML file for those requests unless the user explicitly asks for a file or browser.",
    parameters: Parameters,
    toModelOutput: () => MODEL_OUTPUT,
    execute: (input) =>
      Effect.sync(() => {
        const metadata = validate(input)
        return {
          title: metadata.title,
          output: MODEL_OUTPUT,
          metadata,
        }
      }),
  }),
)

function validate(input: Schema.Schema.Type<typeof Parameters>): Metadata {
  const title = input.title.trim()
  const titleLength = Array.from(title).length
  if (titleLength < 1 || titleLength > MAX_TITLE_LENGTH)
    throw new Error(`Visualization title must contain 1 to ${MAX_TITLE_LENGTH} Unicode characters`)
  if (!input.html.trim()) throw new Error("Visualization HTML must not be empty")
  if (Buffer.byteLength(input.html, "utf-8") > MAX_HTML_BYTES)
    throw new Error(`Visualization HTML must not exceed ${MAX_HTML_BYTES / 1024} KiB in UTF-8`)
  if (!isFragment(input.html)) throw new Error("Visualization HTML must be a fragment")
  return { version: 1, title, html: input.html }
}

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
