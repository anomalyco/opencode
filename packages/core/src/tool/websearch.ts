export * as WebSearchTool from "./websearch"

import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { ToolFailure } from "@opencode-ai/llm"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { makeLocationNode } from "../effect/app-node"
import { truthy } from "../flag/flag"
import { InstallationVersion } from "../installation/version"
import { PositiveInt } from "../schema"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { collectBoundedResponseBody } from "./http-body"
import { checksum } from "../util/encode"

export const name = "websearch"
export const NO_RESULTS = "No search results found. Please try a different query."
export const EXA_URL = "https://mcp.exa.ai/mcp"
export const PARALLEL_URL = "https://search.parallel.ai/mcp"
export const MAX_NUM_RESULTS = 20
export const MAX_CONTEXT_CHARACTERS = 50_000
export const MAX_RESPONSE_BYTES = 256 * 1024

/**
 * Provider-independent local web search retained in V2 core for launch parity.
 * This invokes the legacy Exa/Parallel product backends itself. It is distinct
 * from provider-hosted web search tools, which remain route-owned and execute
 * at the model provider. Ownership of this compromise can be revisited later.
 */
export const description = `Search the web using the session's local web search provider. Use this for current information beyond knowledge cutoff.

This is a provider-independent local tool backed by Exa or Parallel. Provider-hosted web search tools are separate and execute at the model provider.

Optional controls support result count, live crawling ('fallback' or 'preferred'), search type ('auto', 'fast', or 'deep'), and maximum context characters.

The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.`

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_NUM_RESULTS))).annotate({
    description: `Number of search results to return (default: 8, maximum: ${MAX_NUM_RESULTS})`,
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_CONTEXT_CHARACTERS))).annotate(
    {
      description: `Maximum characters for context string optimized for models (default: 10000, maximum: ${MAX_CONTEXT_CHARACTERS})`,
    },
  ),
})

export const Provider = Schema.Literals(["exa", "parallel"])
export type Provider = typeof Provider.Type

export interface Config {
  readonly provider?: Provider
  readonly enableExa: boolean
  readonly enableParallel: boolean
  readonly exaApiKey?: string
  readonly parallelApiKey?: string
}

export class ConfigService extends Context.Service<ConfigService, Config>()("@opencode/v2/WebSearchConfig") {}

/** Isolates the retained product environment contract from the generic tool implementation. */
export const defaultConfigLayer = Layer.sync(ConfigService, () =>
  ConfigService.of({
    provider:
      process.env.OPENCODE_WEBSEARCH_PROVIDER === "exa" || process.env.OPENCODE_WEBSEARCH_PROVIDER === "parallel"
        ? process.env.OPENCODE_WEBSEARCH_PROVIDER
        : undefined,
    enableExa: truthy("OPENCODE_EXPERIMENTAL") || truthy("OPENCODE_ENABLE_EXA") || truthy("OPENCODE_EXPERIMENTAL_EXA"),
    enableParallel: truthy("OPENCODE_ENABLE_PARALLEL") || truthy("OPENCODE_EXPERIMENTAL_PARALLEL"),
    exaApiKey: process.env.EXA_API_KEY,
    parallelApiKey: process.env.PARALLEL_API_KEY,
  }),
)

export const configNode = makeLocationNode({ service: ConfigService, layer: defaultConfigLayer, deps: [] })

export function selectProvider(
  sessionID: string,
  flags: Pick<Config, "enableExa" | "enableParallel"> = { enableExa: false, enableParallel: false },
  override?: Provider,
): Provider {
  if (override) return override
  if (flags.enableParallel) return "parallel"
  if (flags.enableExa) return "exa"
  return Number.parseInt(checksum(sessionID) ?? "0", 36) % 2 === 0 ? "exa" : "parallel"
}

const McpResult = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
  }),
})
const decodeMcpResult = Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))

const parsePayload = (payload: string) =>
  Effect.gen(function* () {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    return (yield* decodeMcpResult(trimmed)).result.content.find((item) => item.text)?.text
  })

export const parseResponse = Effect.fn("WebSearchTool.parseResponse")(function* (body: string) {
  const trimmed = body.trim()
  const direct = trimmed ? yield* parsePayload(trimmed) : undefined
  if (direct) return direct
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data = yield* parsePayload(line.substring(6))
    if (data) return data
  }
  return undefined
})

const ExaArgs = Schema.Struct({
  query: Schema.String,
  type: Schema.String,
  numResults: Schema.Number,
  livecrawl: Schema.String,
  contextMaxCharacters: Schema.optional(Schema.Number),
})
const ParallelArgs = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  session_id: Schema.String,
})
const McpRequest = <F extends Schema.Struct.Fields>(args: Schema.Struct<F>) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Literal(1),
    method: Schema.Literal("tools/call"),
    params: Schema.Struct({ name: Schema.String, arguments: args }),
  })

const exaUrl = (apiKey: string | undefined) => {
  if (!apiKey) return EXA_URL
  const url = new URL(EXA_URL)
  url.searchParams.set("exaApiKey", apiKey)
  return url.toString()
}

const callMcp = <F extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  headers: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.schemaBodyJson(McpRequest(args))({
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call" as const,
        params: { name: tool, arguments: value },
      }),
    )
    return yield* Effect.gen(function* () {
      const response = yield* HttpClient.filterStatusOk(http).execute(request)
      const body = yield* collectBoundedResponseBody(
        response,
        MAX_RESPONSE_BYTES,
        () => new Error(`${tool} response exceeded ${MAX_RESPONSE_BYTES} bytes`),
      )
      return yield* parseResponse(body.toString("utf8"))
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(25),
        orElse: () => Effect.fail(new Error(`${tool} request timed out`)),
      }),
    )
  })

const Output = Schema.Struct({
  provider: Provider,
  text: Schema.String,
})

export const Plugin = {
  id: "opencode.tool.websearch",
  effect: Effect.fn("WebSearchTool.Plugin")(function* (ctx: PluginContext) {
    const http = yield* HttpClient.HttpClient
    const config = yield* ConfigService
    const permission = yield* PermissionV2.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          Tool.make({
            description,
            input: Input,
            output: Output,
            toModelOutput: ({ output }) => [{ type: "text", text: output.text }],
            execute: (input, context) => {
              const provider = selectProvider(context.sessionID, config, config.provider)
              return Effect.gen(function* () {
                yield* permission.assert({
                  action: name,
                  resources: [input.query],
                  save: ["*"],
                  metadata: { ...input, provider },
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                })

                const text =
                  provider === "exa"
                    ? yield* callMcp(http, exaUrl(config.exaApiKey), "web_search_exa", ExaArgs, {
                        query: input.query,
                        type: input.type || "auto",
                        numResults: input.numResults || 8,
                        livecrawl: input.livecrawl || "fallback",
                        contextMaxCharacters: input.contextMaxCharacters,
                      })
                    : yield* callMcp(
                        http,
                        PARALLEL_URL,
                        "web_search",
                        ParallelArgs,
                        {
                          objective: input.query,
                          search_queries: [input.query],
                          session_id: context.sessionID,
                          // V2 invocation context does not safely expose the model yet.
                        },
                        {
                          "User-Agent": `opencode/${InstallationVersion}`,
                          ...(config.parallelApiKey ? { Authorization: `Bearer ${config.parallelApiKey}` } : {}),
                        },
                      )
                return {
                  provider,
                  text: text ?? NO_RESULTS,
                }
              }).pipe(
                Effect.mapError(
                  (error) => new ToolFailure({ message: `Unable to search the web for ${input.query}`, error }),
                ),
              )
            },
          }),
        ),
      )
      .pipe(Effect.orDie)
  }),
}
