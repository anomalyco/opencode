export * as ConfigWebSearchPlugin from "./websearch.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { ConfigWebSearch } from "@opencode/schema/config/websearch"
import { McpEvent } from "@opencode/schema/mcp-event"
import { Effect, Option, Schema, Scope, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Config } from "../../config.js"
import { Mcp } from "../../mcp/index.js"
import { WebSearch } from "../../websearch.js"
import { ConfigEntryObserver } from "./entry-observer.js"

export const Plugin = define<Config.Service | Mcp.Service | Bus.Service | Scope.Scope>({
  id: "opencode.config.websearch",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const mcp = yield* Mcp.Service
    const bus = yield* Bus.Service
    const discovered = { tools: [] as Mcp.Tool[] }
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.websearch.reload())
    // Offer connected MCP search tools in the provider prompt, refreshed as servers connect or change tools.
    yield* bus.subscribe(McpEvent.ToolsChanged).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach(() =>
        mcp.tools().pipe(
          Effect.tap((tools) => Effect.sync(() => (discovered.tools = tools))),
          Effect.andThen(ctx.websearch.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Read after subscribing so a server connecting in between is not missed.
    discovered.tools = yield* mcp.tools()
    yield* ctx.websearch.transform((websearch) => {
      discovered.tools.flatMap(searchTool).forEach((input) => websearch.add(provider(mcp, input)))
      const selection = Config.latest(loaded.entries, "websearch")
      if (selection === false) websearch.default.set(false)
      if (selection && "mcp" in selection) {
        const configured = provider(mcp, selection.mcp)
        websearch.add(configured)
        websearch.default.set(configured.id)
        return
      }
      if (selection) websearch.default.set(selection.provider)
    })
  }),
})

function provider(mcp: Mcp.Interface, input: ConfigWebSearch.McpInfo["mcp"]): WebSearch.ProviderImplementation {
  return {
    id: WebSearch.mcpID(input.server, input.tool),
    name: `${input.server}/${input.tool}`,
    execute: (query) =>
      mcp.callTool({ server: input.server, name: input.tool, args: { [input.argument ?? "query"]: query.query } }).pipe(
        Effect.flatMap((result) =>
          result.isError
            ? Effect.fail(
                new Mcp.ToolCallError({
                  server: result.server,
                  tool: result.tool,
                  message: textOf(result) || `MCP tool "${result.tool}" returned an error`,
                }),
              )
            : Effect.succeed(toResults(result)),
        ),
      ),
  }
}

const InputSchema = Schema.Struct({
  properties: Schema.Record(Schema.String, Schema.Struct({ type: Schema.Unknown.pipe(Schema.optional) })),
  required: Schema.Array(Schema.String).pipe(Schema.optional),
})
const decodeInputSchema = Schema.decodeUnknownOption(InputSchema)
const queryArguments = ["query", "q", "search", "keywords"]

// MCP has no search capability marker, so treat a tool as a web search candidate when its name says
// "search" and it can be called with nothing but a query string.
export function searchTool(tool: Mcp.Tool): ConfigWebSearch.McpInfo["mcp"][] {
  if (!/search/i.test(tool.name)) return []
  const schema = decodeInputSchema(tool.inputSchema)
  if (Option.isNone(schema)) return []
  const argument = queryArguments.find((key) => schema.value.properties[key]?.type === "string")
  if (!argument) return []
  if (schema.value.required?.some((key) => key !== argument)) return []
  return [{ server: tool.server, tool: tool.name, argument }]
}

const Item = Schema.Struct({
  url: Schema.String,
  title: Schema.String.pipe(Schema.optional),
  content: Schema.String.pipe(Schema.optional),
  snippet: Schema.String.pipe(Schema.optional),
  description: Schema.String.pipe(Schema.optional),
})
const Items = Schema.Union([Schema.Array(Item), Schema.Struct({ results: Schema.Array(Item) })])
const decodeItems = Schema.decodeUnknownOption(Items)
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

// MCP search tools have no shared result shape. Prefer structured `{ url, title, ... }` lists from
// `structuredContent` or JSON text, and otherwise hand the model the raw text as a single result.
export function toResults(result: Mcp.ToolResult): WebSearch.Result[] {
  const text = textOf(result)
  const items = Option.firstSomeOf([decodeItems(result.structured), decodeJson(text).pipe(Option.flatMap(decodeItems))])
  if (Option.isSome(items))
    return ("results" in items.value ? items.value.results : items.value).map((item) => {
      const content = item.content ?? item.snippet ?? item.description
      return {
        url: item.url,
        ...(item.title ? { title: item.title } : {}),
        ...(content ? { content } : {}),
        time: {},
      }
    })
  if (!text) return []
  return [{ url: `mcp://${result.server}/${result.tool}`, title: `${result.server} results`, content: text, time: {} }]
}

function textOf(result: Mcp.ToolResult) {
  return result.content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("\n\n")
    .trim()
}
