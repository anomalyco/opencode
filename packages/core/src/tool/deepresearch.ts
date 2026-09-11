export * as DeepResearchTool from "./deepresearch"

import { ToolFailure } from "@argus-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { makeLocationNode } from "../effect/app-node"
import { LayerNodePlatform } from "../effect/app-node-platform"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"
import { configNode as WebSearchConfigNode, ConfigService as WebSearchConfigService } from "./websearch"
import { research } from "../deep-research/orchestrator"
import { Output as ResearchOutput } from "../deep-research/types"

export const name = "search"

export const description = `Perform a deep web search on a requested topic: expands the goal into many parallel search queries, searches multiple providers concurrently, deduplicates and ranks URLs, fetches the top sources in parallel (with per-domain throttling, caching, and timeouts), extracts evidence (claims, code, tables, references) into passages, and returns ranked sources plus evidence with citations. The final answer is synthesized by the model from the returned sources and evidence.

Use this whenever the user asks you to search the web or investigate a topic, including security advisories (CVE/GHSA), library/framework analysis, comparisons, or any topic requiring many sources. Prefer parallel with multiple queries; never search sequentially.

The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.`

export const Input = Schema.Struct({
  goal: Schema.String.annotate({
    description: "The research goal or question to investigate deeply",
  }),
  maxDepth: Schema.optional(
    Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(3)).annotate({
      description: "Maximum research depth: 0 = single round, 1 = follow-up references, 2 = deep graph (default: 2)",
    }),
  ),
  maxSources: Schema.optional(
    Schema.Number.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(30)).annotate({
      description: "Maximum number of ranked sources to return (default: 10)",
    }),
  ),
}).annotate({ identifier: "DeepResearch" })

const Output = Schema.Struct({
  ...ResearchOutput.fields,
  maxSourcesUsed: Schema.Number,
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const http = yield* HttpClient.HttpClient
    const config = yield* WebSearchConfigService
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text: renderResearchReport(output),
            },
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: [input.goal],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })

              const plan = yield* research(input.goal, {
                provider: config.provider,
                enableExa: config.enableExa,
                enableParallel: config.enableParallel,
                exaApiKey: config.exaApiKey,
                parallelApiKey: config.parallelApiKey,
                maxDepth: input.maxDepth ?? 2,
              }, context.sessionID)(http).pipe(
                Effect.catchIf(() => true, () =>
                  Effect.succeed({
                    rounds: [],
                    sources: [],
                    evidence: [],
                    notes: ["Deep research tool error"],
                    queries: [],
                  }),
                ),
              )

              const maxSources = input.maxSources ?? 10
              return {
                goal: input.goal,
                rounds: plan.rounds.slice(0, 4),
                sources: plan.sources.slice(0, maxSources),
                evidence: plan.evidence,
                notes: plan.notes,
                maxSourcesUsed: Math.min(maxSources, plan.sources.length),
              }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: `Unable to run deep research for: ${input.goal}` }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export function renderResearchReport(output: Schema.Schema.Type<typeof Output>): string {
  const lines: string[] = []
  lines.push(`# Deep Research: ${output.goal}`)
  lines.push("")
  if (output.rounds.length > 0) {
    lines.push("## Rounds & Queries")
    for (const round of output.rounds) {
      lines.push(`- Depth ${round.depth}: ${round.queries.join(" · ")}`)
    }
    lines.push("")
  }
  if (output.sources.length > 0) {
    lines.push(`## Ranked Sources (${output.sources.length})`)
    for (const source of output.sources) {
      lines.push(`[${source.rank}] ${source.title} — ${source.url} (${source.sourceType}, score ${source.score.toFixed(2)})`)
    }
    lines.push("")
  }
  if (output.evidence.length > 0) {
    lines.push(`## Evidence (${output.evidence.length} passages)`)
    for (const item of output.evidence) {
      lines.push(`### [${item.sourceIndex + 1}] ${item.heading}`)
      if (item.freshness) lines.push(`_${item.freshness}_`)
      lines.push("", item.passage, "")
      if (item.claims && item.claims.length > 0) {
        lines.push("**Key claims:**")
        for (const claim of item.claims) lines.push(`- ${claim}`)
      }
      if (item.code && item.code.length > 0) {
        lines.push("**Code:**")
        for (const code of item.code) lines.push(code)
      }
      if (item.tables && item.tables.length > 0) {
        lines.push("**Tables:**")
        for (const table of item.tables) lines.push(table)
      }
      lines.push("")
    }
  }
  if (output.notes.length > 0) {
    lines.push(`## Notes`)
    for (const note of output.notes) lines.push(`- ${note}`)
    lines.push("")
  }
  lines.push("## Citation usage")
  lines.push(
    "Cite sources as [1], [2], etc. in your answer, in the order provided above. Only cite sources you actually used.",
  )
  return lines.join("\n")
}

export const node = makeLocationNode({
  name: "tool/deepresearch",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, LayerNodePlatform.httpClient, WebSearchConfigNode],
})