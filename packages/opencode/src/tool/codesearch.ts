import z from "zod"
import { Effect } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpExa from "./mcp-exa"
import DESCRIPTION from "./codesearch.txt"

export const CodeSearchTool = Tool.define(
  "codesearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      description: DESCRIPTION,
      parameters: z.object({
        query: z
          .string()
          .describe(
            "Search query to find relevant context for APIs, Libraries, and SDKs. For example, 'React useState hook examples', 'Python pandas dataframe filtering', 'Express.js middleware', 'Next js partial prerendering configuration'",
          ),
        tokensNum: z
          .number()
          .min(1000)
          .max(50000)
          .default(5000)
          .describe(
            "Number of tokens to return (1000-50000). Default is 5000 tokens. Adjust this value based on how much context you need - use lower values for focused queries and higher values for comprehensive documentation.",
          ),
      }),
      execute: (params: { query: string; tokensNum: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "codesearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              tokensNum: params.tokensNum,
            },
          })

          const result = yield* McpExa.call(
            http,
            "get_code_context_exa",
            McpExa.CodeArgs,
            {
              query: params.query,
              tokensNum: params.tokensNum || 5000,
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
