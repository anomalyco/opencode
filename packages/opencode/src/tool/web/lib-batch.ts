import { Flag } from "@/flag/flag"
import { ProviderID } from "@/provider/schema"
import z from "zod"
import { blank, zero } from "../shared/shape"
import { Tool } from "../shared/tool"
import { batchList, batchResult, stableBatchKey, type BatchOut } from "../shared/batch"
import { CodeSearchTool } from "./codesearch"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"

const tools = ["websearch", "webfetch", "codesearch"] as const

type Call = z.infer<typeof LibBatchCallSchema>
type Row = {
  tool: Call["tool"]
  out: BatchOut
}

function gate(ctx: Tool.Context, tool: Call["tool"]) {
  if (!["websearch", "codesearch"].includes(tool)) return
  const mdl = ctx.extra?.model as { providerID?: string } | undefined
  if (mdl?.providerID === ProviderID.opencode) return
  if (Flag.OPENCODE_ENABLE_EXA) return
  return `${tool} is unavailable for the current provider route. It only surfaces when providerID=opencode or OPENCODE_ENABLE_EXA is enabled.`
}

function blocked(item: Call, why: string): Row {
  return {
    tool: item.tool,
    out: {
      title: `${item.tool} unavailable`,
      metadata: { unavailable: true, reason: why },
      output: why,
    },
  }
}

export const LibBatchCallSchema = z
  .object({
    tool: z.enum(tools),
    query: z.preprocess(blank, z.string().optional()).describe("Query for websearch or codesearch calls."),
    numResults: z.preprocess(zero, z.coerce.number().int().min(1).max(20).optional()).describe("Optional websearch result count."),
    livecrawl: z.enum(["fallback", "preferred"]).optional().describe("Optional websearch live crawl mode."),
    type: z.enum(["auto", "fast", "deep"]).optional().describe("Optional websearch mode."),
    contextMaxCharacters: z
      .preprocess(zero, z.coerce.number().int().min(100).max(50000).optional())
      .describe("Optional websearch context character cap."),
    url: z.preprocess(blank, z.string().optional()).describe("URL for webfetch calls."),
    format: z.enum(["text", "markdown", "html"]).optional().describe("Optional webfetch output format."),
    timeout: z.preprocess(zero, z.coerce.number().int().min(1).max(120).optional()).describe("Optional webfetch timeout in seconds."),
    tokensNum: z
      .preprocess(zero, z.coerce.number().int().min(1000).max(50000).optional())
      .describe("Optional codesearch token budget."),
  })
  .strict()
  .superRefine((value, ctx) => {
    const need = (key: "query" | "url") => {
      if (value[key] != null) return
      ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when tool=${value.tool}` })
    }
    if (value.tool === "webfetch") {
      need("url")
      return
    }
    need("query")
  })

export const LibBatchTool = Tool.define("lib_batch", async () => ({
  description:
    "Run multiple external research calls in one tool invocation. Supports websearch, webfetch, and codesearch with one permission check, deduped parallel execution, and indexed structured output.",
  parameters: z.object({
    calls: z.array(LibBatchCallSchema).min(1).max(16).describe("Ordered external research calls to run in one batch."),
  }),
  async execute(input: { calls: Call[] }, ctx: Tool.Context<Record<string, unknown>>) {
    const needs = new Set(input.calls.map((item) => item.tool))
    const [websearch, webfetch, codesearch] = await Promise.all([
      needs.has("websearch") ? WebSearchTool.init() : Promise.resolve(undefined),
      needs.has("webfetch") ? WebFetchTool.init() : Promise.resolve(undefined),
      needs.has("codesearch") ? CodeSearchTool.init() : Promise.resolve(undefined),
    ])

    await ctx.ask({
      permission: "lib_batch",
      patterns: ["*"],
      always: ["*"],
      metadata: { count: input.calls.length },
    })

    const cache = new Map<string, Promise<Row>>()
    const base = { ...ctx, ask: async () => {} }
    const rows = await Promise.all(
      input.calls.map(async (item) => {
        const key = stableBatchKey(item)
        const hit = cache.get(key)
        if (hit) return hit
        const next = (async () => {
          const why = gate(ctx, item.tool)
          if (why) return blocked(item, why)
          const out: BatchOut =
            item.tool === "websearch"
              ? await websearch!.execute(
                  {
                    query: item.query!,
                    numResults: item.numResults,
                    livecrawl: item.livecrawl,
                    type: item.type,
                    contextMaxCharacters: item.contextMaxCharacters,
                  },
                  base,
                )
              : item.tool === "webfetch"
                ? await webfetch!.execute(
                    {
                      url: item.url!,
                      format: item.format ?? "markdown",
                      ...(item.timeout ? { timeout: item.timeout } : {}),
                    },
                    base,
                  )
                : await codesearch!.execute(
                    {
                      query: item.query!,
                      tokensNum: item.tokensNum ?? 5000,
                    },
                    base,
                  )
          return { tool: item.tool, out }
        })()
        cache.set(key, next)
        return next
      }),
    )

    const deduped = input.calls.length - cache.size
    const coverage = batchList(input.calls.flatMap((item) => [item.query, item.url]))

    return batchResult({
      title: `lib batch (${rows.length})`,
      rows,
      mode: "parallel",
      deduped,
      coverage,
      call: (item) => ({ tool: item.tool }),
      result: (item) => ({ tool: item.tool }),
      label: (item) => `${item.tool} — ${item.out.title}`,
      include_attachments: true,
      include_attachment_counts: true,
    })
  },
}))
