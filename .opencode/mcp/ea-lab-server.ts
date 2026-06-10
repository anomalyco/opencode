import path from "path"
import { McpServer } from "../../packages/opencode/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js"
import { StdioServerTransport } from "../../packages/opencode/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js"
import { z } from "../../packages/opencode/node_modules/zod/v4"
import { EvidenceTypes, ExperimentStages, ExperimentStatuses, ExperienceTypes, OverfitRisks } from "../ea-lab-core/types"
import { createEaLabService } from "./ea-lab-service"
import { startEaLabHttpServer } from "./ea-lab-http"

const service = createEaLabService({
  dbPath: process.env.OPENCODE_EA_LAB_DB,
  riskGatePath: process.env.OPENCODE_EA_LAB_RISK_GATES ?? path.join(process.cwd(), "risk", "gates.yaml"),
})

const args = new Set(process.argv.slice(2))
const httpOnly = args.has("--http")
const noHttp = args.has("--no-http")
const withHttp = httpOnly || !noHttp

if (withHttp) {
  const server = startEaLabHttpServer({ service })
  console.error(`[ea-lab] http listening on http://${server.hostname}:${server.port}`)
}

if (!httpOnly) {
  const mcp = new McpServer({ name: "ea-lab-memory-service", version: "0.1.0" })

  mcp.registerTool(
    "ea_lab_health",
    {
      description: "Read EA Lab memory service health and schema state.",
      inputSchema: {},
    },
    async () => toolText(JSON.stringify(await service.health(), null, 2)),
  )

  mcp.registerTool(
    "ea_lab_store_evidence",
    {
      description: "Store redacted evidence for EA research, implementation, tests, logs, URLs, or manual notes.",
      inputSchema: {
        evidence_type: z.enum(EvidenceTypes),
        description: z.string().min(1),
        uri: z.string().optional(),
        file_path: z.string().optional(),
        commit_hash: z.string().optional(),
        message_id: z.string().optional(),
        experiment_id: z.string().optional(),
        checksum: z.string().optional(),
      },
    },
    async (input) => toolText(JSON.stringify(await service.storeEvidence(input), null, 2)),
  )

  mcp.registerTool(
    "ea_lab_search_evidence",
    {
      description: "Search redacted evidence records. Use this before making claims from prior work.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(20).optional() },
    },
    async (input) => toolText(JSON.stringify(await service.searchEvidence(input), null, 2)),
  )

  mcp.registerTool(
    "ea_lab_store_experiment",
    {
      description: "Create an EA experiment ledger entry before implementation or backtesting.",
      inputSchema: {
        title: z.string().min(1),
        symbol: z.string().min(1),
        timeframe: z.string().min(1),
        strategy: z.string().min(1),
        hypothesis: z.string().min(1),
        implementation_summary: z.string().optional(),
        test_conditions: z.record(z.string(), z.unknown()).optional(),
        metrics: z.record(z.string(), z.unknown()).optional(),
        result_status: z.enum(ExperimentStatuses).optional(),
        stage: z.enum(ExperimentStages).optional(),
        overfit_risk: z.enum(OverfitRisks).optional(),
      },
    },
    async (input) => toolText(JSON.stringify(await service.storeExperiment(input), null, 2)),
  )

  mcp.registerTool(
    "ea_lab_update_experiment_result",
    {
      description: "Update experiment result status, stage, metrics, and overfit risk after verification.",
      inputSchema: {
        id: z.string().min(1),
        metrics: z.record(z.string(), z.unknown()).optional(),
        result_status: z.enum(ExperimentStatuses).optional(),
        stage: z.enum(ExperimentStages).optional(),
        overfit_risk: z.enum(OverfitRisks).optional(),
      },
    },
    async (input) => toolText(JSON.stringify(await service.updateExperimentResult(input), null, 2)),
  )

  mcp.registerTool(
    "ea_lab_store_experience",
    {
      description: "Store a success, failure, near miss, rejected idea, or risk lesson with reuse and anti-rules.",
      inputSchema: {
        type: z.enum(ExperienceTypes),
        situation: z.string().min(1),
        trigger_conditions: z.record(z.string(), z.unknown()).optional(),
        action_taken: z.string().min(1),
        outcome: z.string().min(1),
        lesson: z.string().min(1),
        reuse_rule: z.string().min(1),
        anti_rule: z.string().min(1),
        confidence: z.enum(["low", "medium", "high"]).optional(),
        status: z.enum(["draft", "active", "stale", "contradicted", "archived"]).optional(),
        tags: z.array(z.string()).optional(),
        evidence_ids: z.array(z.string()).optional(),
      },
    },
    async (input) => toolText(JSON.stringify(await service.storeExperience(input), null, 2)),
  )

  mcp.registerTool(
    "ea_lab_search_similar_experiences",
    {
      description: "Find deterministic similar success/failure memories by symbol, strategy, timeframe, tags, and query text.",
      inputSchema: {
        symbol: z.string().optional(),
        strategy: z.string().optional(),
        timeframe: z.string().optional(),
        tags: z.array(z.string()).optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async (input) => toolText(JSON.stringify(await service.searchSimilarExperiences({
      query: input.query ?? "*",
      symbol: input.symbol,
      strategy: input.strategy,
      timeframe: input.timeframe,
      limit: input.limit,
    }), null, 2)),
  )

  mcp.registerTool(
    "ea_lab_check_risk_gates",
    {
      description: "Check a proposed promotion or risk change against authoritative risk/gates.yaml hard gates.",
      inputSchema: {
        stage: z.enum(ExperimentStages),
        metrics: z.record(z.string(), z.unknown()).optional(),
        has_out_of_sample: z.boolean().optional(),
        has_demo_forward: z.boolean().optional(),
        spread_slippage_documented: z.boolean().optional(),
        wants_live_trading: z.boolean().optional(),
        wants_lot_increase: z.boolean().optional(),
        wants_gate_relaxation: z.boolean().optional(),
        uses_martingale: z.boolean().optional(),
        uses_grid: z.boolean().optional(),
        has_hard_max_loss: z.boolean().optional(),
      },
    },
    async (input) => toolText(JSON.stringify(await service.checkRiskGates(input), null, 2)),
  )

  const transport = new StdioServerTransport()
  await mcp.connect(transport)
  console.error("[ea-lab] mcp stdio connected")
}

function toolText(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  }
}
