export * as ConfigWebSearch from "./websearch.js"

import { Schema } from "effect"
import { optional } from "../schema.js"
import { WebSearch } from "../websearch.js"

export class Info extends Schema.Class<Info>("ConfigWebSearch.Info")({
  provider: Schema.Union([
    Schema.Literal("random").annotate({
      description:
        "Reuse a randomly selected provider until it is rate limited, then switch to another available provider.",
    }),
    WebSearch.ID,
  ]),
}) {}

export class McpInfo extends Schema.Class<McpInfo>("ConfigWebSearch.McpInfo")({
  mcp: Schema.Struct({
    server: Schema.String.annotate({ description: "Name of a configured MCP server" }),
    tool: Schema.String.annotate({ description: "Name of the MCP tool that performs the search" }),
    argument: Schema.String.pipe(optional).annotate({
      description: "Tool argument that receives the search query. Defaults to `query`.",
    }),
  }).annotate({ description: "Route web search through a tool exposed by one of your MCP servers" }),
}) {}

export const Selection = Schema.Union([Schema.Literal(false), Info, McpInfo])
export type Selection = typeof Selection.Type
