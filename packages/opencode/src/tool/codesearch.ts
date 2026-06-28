import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import DESCRIPTION from "./codesearch.txt"

const CodeArgs = Schema.Struct({
  query: Schema.String,
  tokensNum: Schema.Number,
})

const CODE_TOOL = "get_code_context_exa"

// `get_code_context_exa` is a deprecated Exa MCP tool: it is no longer enabled
// by default on the hosted endpoint (only web_search_exa / web_fetch_exa are),
// so calling it on the bare URL returns JSON-RPC -32602 "Tool not found". It is
// still available for backwards compatibility when explicitly enabled via the
// `tools` query param, so we request it on a code-specific URL.
function codeContextUrl(): string {
  const params = new URLSearchParams()
  if (process.env.EXA_API_KEY) params.set("exaApiKey", process.env.EXA_API_KEY)
  params.set("tools", CODE_TOOL)
  return `https://mcp.exa.ai/mcp?${params.toString()}`
}

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description:
      "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
  }),
  tokensNum: Schema.optional(Schema.Number).annotate({
    description:
      "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
  }),
})

export const CodeSearchTool = Tool.define(
  "codesearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const tokensNum = params.tokensNum || 5000
          yield* ctx.ask({
            permission: "codesearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              tokensNum,
            },
          })

          const result = yield* McpWebSearch.call(
            http,
            codeContextUrl(),
            CODE_TOOL,
            CodeArgs,
            {
              query: params.query,
              tokensNum,
            },
            "30 seconds",
          )

          return {
            output:
              result ??
              "No code snippets or documentation found. Please try a different query, be more specific about the library or programming concept, or check the spelling of framework names.",
            title: `Code search: ${params.query}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
