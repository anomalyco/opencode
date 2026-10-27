import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { currentToolError, currentToolInput, currentToolOutput } from "../message/current-tool-state"

const decodeQuery = Schema.decodeUnknownOption(Schema.Struct({ query: Schema.String }))

const decodeURL = Schema.decodeUnknownOption(Schema.Struct({ url: Schema.String }))

export type SourceResult = {
  url: string
  title?: string
  /** The hostname without `www.`, as shown and as the letter tile's seed. */
  site: string
  /** The full hostname, where its favicon lives. */
  host: string
}

type StepStatus = "running" | "completed" | "error"

export type SourceStep =
  | { type: "search"; id: string; query: string; status: StepStatus; results: SourceResult[]; error?: string }
  | ({ type: "fetch"; id: string; path: string; status: StepStatus; error?: string } & SourceResult)

export type TurnSources = {
  steps: SourceStep[]
  /** Distinct sources in the order the turn met them: search results and opened pages, deduped by URL. */
  sources: SourceResult[]
}

/** The web searches and page fetches of one turn's assistant messages, in the order they ran. */
export function turnSources(messages: readonly SessionMessageAssistant[]): TurnSources {
  const steps = messages.flatMap((message) => message.content.flatMap((content) => step(content)))
  const seen = new Set<string>()

  const sources = steps
    .flatMap((item) => (item.type === "search" ? item.results : item.status === "error" ? [] : [item]))
    .filter((item) => {
      const key = identity(item.url)

      if (seen.has(key)) return false
      seen.add(key)

      return true
    })

  return { steps, sources }
}

/** The assistant messages of the turn a user message opened, grouped as the timeline groups them. */
export function turnMessages(messages: readonly SessionMessageInfo[], from: string) {
  const start = messages.findIndex((message) => message.id === from)

  if (start === -1) return []

  const end = messages.findIndex(
    (message, index) => index > start && (message.type === "user" || message.type === "shell"),
  )

  return messages
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((message): message is SessionMessageAssistant => message.type === "assistant")
}

function step(content: SessionMessageAssistant["content"][number]): SourceStep[] {
  if (content.type !== "tool" || content.state.status === "streaming") return []

  if (content.name === "websearch") return [search(content)]

  if (content.name !== "webfetch") return []

  const page = Option.getOrUndefined(
    decodeURL(currentToolInput(content)).pipe(Option.flatMapNullishOr((input) => source(input.url))),
  )

  if (!page) return []

  return [
    {
      type: "fetch",
      id: content.id,
      ...page,
      path: path(page.url),
      status: content.state.status,
      error: currentToolError(content),
    },
  ]
}

function search(tool: SessionMessageAssistantTool): SourceStep {
  return {
    type: "search",
    id: tool.id,
    query: Option.match(decodeQuery(currentToolInput(tool)), { onNone: () => "", onSome: (input) => input.query }),
    status: tool.state.status === "streaming" ? "running" : tool.state.status,
    results: tool.state.status === "completed" ? results(currentToolOutput(tool) ?? "") : [],
    error: currentToolError(tool),
  }
}

// The websearch tool keeps its structured results out of the message and writes each one as a `## [title](url)`
// heading in its text content (packages/core/src/tool/plugin/websearch.ts); a result without a title repeats its URL.
function results(text: string) {
  return text.split("\n").flatMap((line): SourceResult[] => {
    if (!line.startsWith("## [") || !line.endsWith(")")) return []

    const split = line.lastIndexOf("](")

    if (split < 4) return []

    const result = source(line.slice(split + 2, -1))

    if (!result) return []

    const title = line.slice(4, split).trim()

    return [{ ...result, title: title && title !== result.url ? title : undefined }]
  })
}

function source(url: string): SourceResult | undefined {
  if (!URL.canParse(url)) return undefined

  const parsed = new URL(url)

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined

  return { url, host: parsed.hostname, site: parsed.hostname.replace(/^www\./, "") }
}

// One source per page: the scheme, `www.`, a trailing slash and the fragment don't make another.
function identity(url: string) {
  const parsed = new URL(url)

  return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`
}

function path(url: string) {
  const parsed = new URL(url)

  return `${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`
}
