import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./kb-query.txt"
import { Log } from "../util/log"
import { loadRaidConfig, validateRaidConfig } from "../raid/raid-config"
import { RaidKnowledgeBase } from "../raid/raid-kb"
import { RaidOrchestrator } from "../raid/raid-orchestrator"

const log = Log.create({ service: "kb-query-tool" })

export const KbQueryTool = Tool.define("kb-query", {
  description: DESCRIPTION,
  parameters: z.object({
    query: z.string().describe("Natural language question to answer using the knowledge base"),
    documentIds: z
      .array(z.string())
      .describe("Optional specific document IDs to query (if empty, searches all relevant docs)")
      .optional(),
    showProgress: z
      .boolean()
      .describe("Show detailed progress during query orchestration")
      .optional()
      .default(true),
  }),
  async execute(params, ctx) {
    const { query, documentIds, showProgress } = params
    try {
      // Load and validate config
      const config = loadRaidConfig()
      const validation = validateRaidConfig(config)

      if (!validation.valid) {
        return {
          title: "Config Error",
          metadata: {},
          output: `KB configuration error:\n${validation.errors.join("\n")}`,
        }
      }

      // Initialize KB and orchestrator
      const kb = new RaidKnowledgeBase(config)
      const orchestrator = new RaidOrchestrator(config, kb)

      // Track progress
      const onProgress = showProgress
        ? (progress: any) => {
            if (progress.type === "routing") {
              ctx.metadata?.({ title: `Routing: ${progress.message}` })
            } else if (progress.type === "querying") {
              const percent =
                progress.shardsQueried && progress.totalShards
                  ? Math.round((progress.shardsQueried / progress.totalShards) * 100)
                  : 0
              ctx.metadata?.({ title: `Querying (${percent}%): ${progress.message}` })
            } else if (progress.type === "fusing") {
              ctx.metadata?.({ title: `Fusing: ${progress.message}` })
            } else if (progress.type === "complete") {
              ctx.metadata?.({ title: `Complete: ${progress.message}` })
            } else if (progress.type === "error") {
              ctx.metadata?.({ title: `Error: ${progress.message}` })
            }
          }
        : undefined

      // Execute query
      const answer = await orchestrator.orchestrateQuery(query, documentIds, onProgress)

      kb.close()

      return {
        title: `Query: ${query}`,
        metadata: {},
        output: answer,
      }
    } catch (error) {
      log.error("Failed to query knowledge base", { error })
      return {
        title: "Error",
        metadata: {},
        output: `Error querying knowledge base: ${error}`,
      }
    }
  },
})
