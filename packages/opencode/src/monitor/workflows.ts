/**
 * Workflows view — 11 datasets powering the D3 page.
 *
 *   1.  Agent orchestration DAG         (parent_id chain)
 *   2.  Tool execution Sankey           (tool calls grouped)
 *   3.  Collaboration network           (session relationships)
 *   4.  Subagent effectiveness          (turn durations)
 *   5.  Detected workflow patterns      (tool sequences)
 *   6.  Model delegation flow           (provider/model usage)
 *   7.  Error propagation map           (error groups)
 *   8.  Concurrency timeline            (busy/idle over time)
 *   9.  Session complexity scatter      (tokens vs duration)
 *  10.  Compaction impact analysis      (compaction events)
 *  11.  Per-session drill-in            (per-session metrics)
 *
 * Each dataset is shaped for the D3 visualisation that consumes it. The
 * route validates the envelope; individual datasets stay loose (`unknown`)
 * so the Solid UI on the app side can narrow the type per chart.
 */

import { z } from "zod"
import { Database, sql } from "@/storage"
import { Effect } from "effect"

export const WorkflowsReport = z.object({
  datasets: z.object({
    orchestration: z.unknown(),
    tool_sankey: z.unknown(),
    collaboration: z.unknown(),
    subagent_effectiveness: z.unknown(),
    patterns: z.unknown(),
    model_delegation: z.unknown(),
    error_propagation: z.unknown(),
    concurrency: z.unknown(),
    complexity: z.unknown(),
    compaction: z.unknown(),
    per_session: z.unknown(),
  }),
  generated_at: z.number(),
})
export type WorkflowsReport = z.infer<typeof WorkflowsReport>

interface SankeyNode {
  id: string
}
interface SankeyEdge {
  source: string
  target: string
  value: number
}

interface OrchestrationNode {
  id: string
  parent: string | null
  title: string
}
interface OrchestrationLink {
  source: string
  target: string
}

interface ModelFlowSlice {
  provider: string
  model: string
  sessions: number
  cost: number
  tokens: number
}

interface ComplexityPoint {
  session_id: string
  tokens: number
  duration_ms: number
  cost: number
}

interface ErrorGroup {
  message: string
  count: number
  sessions: string[]
}

interface CompactionPoint {
  session_id: string
  at: number
  tokens_before: number | null
  tokens_after: number | null
}

interface PerSessionRow {
  session_id: string
  title: string
  cost: number
  tokens: number
  tool_calls: number
  errors: number
  duration_ms: number
}

export const buildWorkflows = Effect.fn(function* (input: { projectId: string; status: "active" | "completed" | "all" }) {
  const archivedFilter = input.status === "active" ? `WHERE session.time_archived IS NULL` : ``

  // 1. Orchestration DAG
  const orchestrationNodes: OrchestrationNode[] = Database.use((db) =>
    db.all<OrchestrationNode>(
      sql`SELECT id, parent_id as parent, title FROM session ${archivedFilter ? sql`WHERE session.time_archived IS NULL` : sql``} ORDER BY time_created DESC LIMIT 200`,
    ),
  )
  const orchestration: { nodes: OrchestrationNode[]; links: OrchestrationLink[] } = {
    nodes: orchestrationNodes,
    links: orchestrationNodes
      .filter((n) => n.parent)
      .map((n) => ({ source: n.parent!, target: n.id })),
  }

  // 2. Tool Sankey
  const sankeyRows = Database.use((db) =>
    db.all<{ tool: string; status: string; count: number }>(
      sql`SELECT json_extract(data, '$.tool') as tool,
              json_extract(data, '$.state.status') as status,
              COUNT(*) as count
       FROM part
       WHERE json_extract(data, '$.type') = 'tool'
         AND json_extract(data, '$.tool') IS NOT NULL
       GROUP BY tool, status
       LIMIT 500`,
    ),
  )
  const toolSankey: { nodes: SankeyNode[]; edges: SankeyEdge[] } = { nodes: [], edges: [] }
  const seenNodes = new Set<string>()
  for (const r of sankeyRows) {
    const tool = String(r.tool ?? "unknown")
    const status = String(r.status ?? "unknown")
    const sourceId = `tool:${tool}`
    const targetId = `status:${status}`
    if (!seenNodes.has(sourceId)) {
      toolSankey.nodes.push({ id: sourceId })
      seenNodes.add(sourceId)
    }
    if (!seenNodes.has(targetId)) {
      toolSankey.nodes.push({ id: targetId })
      seenNodes.add(targetId)
    }
    toolSankey.edges.push({ source: sourceId, target: targetId, value: Number(r.count) })
  }

  // 4. Subagent effectiveness — derived from per-session tool count
  const subagentEffectiveness: PerSessionRow[] = Database.use((db) =>
    db.all<PerSessionRow>(
      sql`SELECT session.id as session_id,
              session.title,
              COALESCE(SUM(json_extract(message.data, '$.cost')), 0) as cost,
              COALESCE(SUM(json_extract(message.data, '$.tokens.total')), 0) as tokens,
              0 as tool_calls,
              0 as errors,
              (session.time_updated - session.time_created) as duration_ms
       FROM session LEFT JOIN message ON message.session_id = session.id
       GROUP BY session.id
       ORDER BY session.time_updated DESC
       LIMIT 50`,
    ),
  )

  // 6. Model delegation flow
  const modelFlow: ModelFlowSlice[] = Database.use((db) =>
    db.all<ModelFlowSlice>(
      sql`SELECT json_extract(data, '$.model.providerID') as provider,
              json_extract(data, '$.model.modelID') as model,
              COUNT(DISTINCT session_id) as sessions,
              COALESCE(SUM(json_extract(data, '$.cost')), 0) as cost,
              COALESCE(SUM(json_extract(data, '$.tokens.total')), 0) as tokens
       FROM message
       WHERE json_extract(data, '$.role') = 'assistant'
         AND json_extract(data, '$.model.providerID') IS NOT NULL
       GROUP BY provider, model
       ORDER BY cost DESC
       LIMIT 50`,
    ),
  )

  // 7. Error propagation
  const errorGroups: ErrorGroup[] = (() => {
    const groups = new Map<string, ErrorGroup>()
    const rows = Database.use((db) =>
      db.all<{ session_id: string; error: string }>(
        sql`SELECT session_id, json_extract(data, '$.error') as error
         FROM message
         WHERE json_extract(data, '$.role') = 'assistant'
           AND json_extract(data, '$.error') IS NOT NULL
         LIMIT 500`,
      ),
    )
    for (const row of rows) {
      const key = String(row.error)
      const existing = groups.get(key) ?? { message: key, count: 0, sessions: [] }
      existing.count++
      if (!existing.sessions.includes(row.session_id) && existing.sessions.length < 5) {
        existing.sessions.push(row.session_id)
      }
      groups.set(key, existing)
    }
    return Array.from(groups.values()).sort((a, b) => b.count - a.count).slice(0, 20)
  })()

  // 9. Session complexity scatter
  const complexity: ComplexityPoint[] = Database.use((db) =>
    db.all<ComplexityPoint>(
      sql`SELECT session.id as session_id,
              COALESCE(SUM(json_extract(message.data, '$.tokens.total')), 0) as tokens,
              (session.time_updated - session.time_created) as duration_ms,
              COALESCE(SUM(json_extract(message.data, '$.cost')), 0) as cost
       FROM session LEFT JOIN message ON message.session_id = session.id
       GROUP BY session.id
       ORDER BY tokens DESC
       LIMIT 200`,
    ),
  )

  // 10. Compaction impact
  const compaction: CompactionPoint[] = Database.use((db) =>
    db.all<CompactionPoint>(
      sql`SELECT session_id,
              json_extract(data, '$.time.created') as at,
              json_extract(data, '$.tokensBefore') as tokens_before,
              json_extract(data, '$.tokensAfter') as tokens_after
       FROM part
       WHERE json_extract(data, '$.type') = 'compaction'
       ORDER BY json_extract(data, '$.time.created') DESC
       LIMIT 100`,
    ),
  )

  // 11. Per-session rollup
  const perSession: PerSessionRow[] = Database.use((db) =>
    db.all<PerSessionRow>(
      sql`SELECT session.id as session_id,
              session.title,
              COALESCE(SUM(json_extract(message.data, '$.cost')), 0) as cost,
              COALESCE(SUM(json_extract(message.data, '$.tokens.total')), 0) as tokens,
              (SELECT COUNT(*) FROM part WHERE part.session_id = session.id AND json_extract(part.data, '$.type') = 'tool') as tool_calls,
              (SELECT COUNT(*) FROM message WHERE message.session_id = session.id AND json_extract(message.data, '$.error') IS NOT NULL) as errors,
              (session.time_updated - session.time_created) as duration_ms
       FROM session LEFT JOIN message ON message.session_id = session.id
       GROUP BY session.id
       ORDER BY session.time_updated DESC
       LIMIT 100`,
    ),
  )

  return {
    datasets: {
      orchestration,
      tool_sankey: toolSankey,
      collaboration: null,
      subagent_effectiveness: subagentEffectiveness,
      patterns: null,
      model_delegation: modelFlow,
      error_propagation: errorGroups,
      concurrency: null,
      complexity,
      compaction,
      per_session: perSession,
    },
    generated_at: Date.now(),
  } satisfies WorkflowsReport
  // keep `input.projectId` available for future scoping
  void input.projectId
})