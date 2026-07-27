import { afterEach, describe, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { fileURLToPath, pathToFileURL } from "url"
import { Effect, Layer, Result, Schema } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Agent } from "@/agent/agent"
import { InstanceState } from "@/effect/instance-state"

import { ToolJsonSchema } from "@/tool/json-schema"
import { MessageID, SessionID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { MCP } from "@/mcp"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { Workflow } from "@opencode-ai/core/workflow"
import { TestWorkflow } from "../fixture/workflow"
import { WorkflowSchema } from "@opencode-ai/core/workflow/schema"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Truncate } from "@/tool/truncate"

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})

// Fake Plugin.Service that returns a single plugin whose `tool` map contains
// one definition with `args: undefined`. Used to exercise the plugin entry
// point of `fromPlugin` for the #27451 / #27630 regression.
const brokenPluginLayer = Layer.succeed(
  Plugin.Service,
  Plugin.Service.of({
    init: () => Effect.void,
    trigger: ((_name: unknown, _input: unknown, output: unknown) =>
      Effect.succeed(output)) as Plugin.Interface["trigger"],
    list: () =>
      Effect.succeed([
        {
          tool: {
            broken_plugin_tool: {
              description: "plugin tool with missing args",
              args: undefined as unknown as Record<string, never>,
              execute: async () => "ok",
            },
          },
        },
      ]),
  }),
)

const root = LayerNode.group([ToolRegistry.node, Agent.node])
const replacements = [
  [Config.node, configLayer],
  [RuntimeFlags.node, RuntimeFlags.layer()],
  [Workflow.node, TestWorkflow.layer()],
] as const

const it = testEffect(LayerNode.compile(root, replacements))
const withWorkflow = testEffect(
  LayerNode.compile(root, [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer()],
    [
      Workflow.node,
      TestWorkflow.layer({
        heavy: (_input, context) => {
          const progress = context.onProgress
          return Effect.all(
            [
              progress?.({
                structured: {
                  workflow: "heavy",
                  phase: "executing",
                  stage: "execution",
                  root_session_id: "ses_heavy_root",
                  session_id: "ses_heavy_worker",
                  parent_session_id: "ses_heavy_root",
                  child_status: "running",
                  child_activity: "provider_active",
                  child_agent: "heavy-writer",
                  child_title: "Heavy worker",
                  node_id: "heavy-child",
                  parent_node_id: "heavy-root",
                  node_depth: 1,
                  depends_on: [],
                  report_path: "/project/.opencode/reports/heavy/stages/ses_heavy_worker.md",
                  prompt_bytes: 4096,
                  started_at: 100,
                  updated_at: 100,
                  elapsed_ms: 0,
                },
                text: "Heavy is executing a worker",
              }) ?? Effect.void,
              progress?.({
                structured: {
                  workflow: "heavy",
                  phase: "executing",
                  stage: "execution",
                  root_session_id: "ses_heavy_root",
                  session_id: "ses_heavy_worker",
                  parent_session_id: "ses_heavy_root",
                  child_status: "completed",
                  child_agent: "heavy-writer",
                  child_title: "Heavy worker",
                  node_id: "heavy-child",
                  parent_node_id: "heavy-root",
                  node_depth: 1,
                  depends_on: [],
                  report_path: "/project/.opencode/reports/heavy/stages/ses_heavy_worker.md",
                  prompt_bytes: 4096,
                  started_at: 100,
                  updated_at: 500,
                  elapsed_ms: 400,
                },
                text: "Heavy worker completed",
              }) ?? Effect.void,
              progress?.({
                structured: {
                  workflow: "council",
                  phase: "perspectives",
                  stage: "perspective",
                  root_session_id: "ses_heavy_council_root",
                  session_id: "ses_heavy_council_risk",
                  parent_session_id: "ses_heavy_council_root",
                  child_status: "completed",
                  child_agent: "council-perspective",
                  child_title: "Council: risk",
                  node_id: "risk",
                  parent_node_id: "council-root",
                  node_depth: 1,
                  report_path: "/project/.opencode/reports/heavy/stages/ses_heavy_council_risk.md",
                  prompt_bytes: 2048,
                  started_at: 600,
                  updated_at: 900,
                  elapsed_ms: 300,
                },
                text: "Council risk perspective completed",
              }) ?? Effect.void,
            ],
            { concurrency: 1, discard: true },
          ).pipe(
            Effect.as(
              WorkflowSchema.HeavyOutput.make({
                workflow: "heavy",
                status: "completed",
                execution_status: "partial",
                artifact_status: "available",
                evidence_status: "completed",
                summary: "Recursive work completed",
                final_response: "The durable Heavy synthesis is authoritative.",
                usage: {
                  input: 100,
                  output: 20,
                  reasoning: 5,
                  cache_read: 50,
                  cache_write: 0,
                  cost: 0,
                  cost_status: "unavailable",
                },
                root_session_id: SessionSchema.ID.make("ses_heavy_root"),
                report_path: "/project/.opencode/reports/heavy/HEAVY_REPORT.md",
                source_provenance: [
                  {
                    url: "https://example.com/workflow",
                    report_paths: ["/project/.opencode/reports/heavy/stages/ses_heavy_worker.md"],
                  },
                ],
                session_manifest: [
                  {
                    session_id: SessionSchema.ID.make("ses_nested_council_debater"),
                    parent_session_id: SessionSchema.ID.make("ses_nested_council_plan"),
                    run_id: "run-heavy-council",
                    parent_run_id: "run-heavy-root",
                    workflow: "council",
                    workflow_depth: 1,
                    status: "completed",
                    agent: "council-debater",
                    title: "Nested Council debate",
                    stage: "debate",
                    issue: "issue-1",
                    round: 1,
                    report_path: "/project/.opencode/reports/heavy/stages/ses_nested_council_debater.md",
                    prompt_bytes: 8192,
                    started_at: 1_000,
                    updated_at: 1_500,
                    elapsed_ms: 500,
                  },
                ],
                delegations: [
                  {
                    id: "run-heavy-council",
                    parent_id: "run-heavy-root",
                    parent_session_id: SessionSchema.ID.make("ses_heavy_worker"),
                    workflow: "council",
                    depth: 1,
                    objective: "Challenge the recursive implementation",
                    status: "completed",
                    summary: "Nested Council preserved a minority position",
                    root_session_id: SessionSchema.ID.make("ses_nested_council"),
                    session_ids: [SessionSchema.ID.make("ses_nested_council_debater")],
                    report_path: "/project/.opencode/reports/heavy/runs/run-heavy-council/COUNCIL_REPORT.md",
                  },
                ],
                nodes: [
                  {
                    id: "heavy-root",
                    session_id: SessionSchema.ID.make("ses_heavy_synthesis"),
                    planning_session_id: SessionSchema.ID.make("ses_heavy_root"),
                    depth: 0,
                    title: "Heavy root",
                    objective: "Trace the implementation",
                    capability: "write",
                    status: "completed",
                    summary: "Recursive work completed",
                    decisions: ["Keep the V2 workflow canonical"],
                    findings: [
                      {
                        claim: "Nested evidence survives",
                        evidence: [
                          "src/workflow.ts",
                          "https://example.com/workflow",
                          "large report evidence ".repeat(4_000),
                        ],
                      },
                    ],
                    changed_files: ["src/workflow.ts"],
                    validation: ["bun test"],
                    risks: [],
                    follow_up: [],
                  },
                  {
                    id: "heavy-child",
                    parent_id: "heavy-root",
                    session_id: SessionSchema.ID.make("ses_heavy_worker"),
                    depth: 1,
                    title: "Inspect the recursive implementation",
                    objective: "Trace the implementation",
                    capability: "write",
                    status: "completed",
                    summary: "The worker submitted its durable report",
                    decisions: ["Preserve the child report trail"],
                    findings: [{ claim: "The child report is available", evidence: ["src/workflow.ts"] }],
                    changed_files: ["src/workflow.ts"],
                    validation: ["bun test"],
                    risks: [],
                    follow_up: [],
                  },
                ],
                council: {
                  workflow: "council",
                  status: "completed",
                  summary: "Independent review supports the result",
                  root_session_id: SessionSchema.ID.make("ses_heavy_council_root"),
                  synthesis_session_id: SessionSchema.ID.make("ses_heavy_council_synthesis"),
                  perspectives: [
                    {
                      perspective_id: "risk",
                      summary: "The result is adequately bounded",
                      issues: [
                        {
                          id: "issue-1",
                          question: "Is the result justified?",
                          stance: "support",
                          rationale: "Evidence is preserved",
                          evidence: ["https://example.com/workflow"],
                        },
                      ],
                      recommendations: ["Keep the report trail"],
                      risks: [],
                      session_id: SessionSchema.ID.make("ses_heavy_council_risk"),
                    },
                  ],
                  debate: [],
                  consensus: ["Preserve the report trail"],
                  disagreements: [],
                  recommendations: ["Keep the report trail"],
                  risks: [],
                },
              }),
            ),
          )
        },
        council: (_input, context) => {
          const progress = context.onProgress
          return Effect.all(
            [
              progress?.({
                structured: {
                  workflow: "council",
                  phase: "perspectives",
                  stage: "perspective",
                  root_session_id: "ses_council_root",
                  session_id: "ses_council_perspective",
                  child_status: "timed_out",
                  child_agent: "council-perspective",
                  child_title: "Council safety perspective",
                  started_at: 100,
                  updated_at: 1_100,
                  elapsed_ms: 1_000,
                  error: "Perspective timed out",
                },
                text: "Council safety perspective timed out",
              }) ?? Effect.void,
              progress?.({
                structured: {
                  workflow: "council",
                  phase: "synthesizing",
                  stage: "synthesis",
                  root_session_id: "ses_council_root",
                  session_id: "ses_council_synthesis",
                  session_ids: ["ses_council_perspective"],
                  child_status: "completed",
                  child_agent: "council-synthesizer",
                  child_title: "Council synthesis",
                  started_at: 1_200,
                  updated_at: 1_500,
                  elapsed_ms: 300,
                },
                text: "Council synthesized the deliberation",
              }) ?? Effect.void,
            ],
            { concurrency: 1, discard: true },
          ).pipe(
            Effect.as(
              WorkflowSchema.CouncilOutput.make({
                workflow: "council",
                status: "partial",
                summary: "Debate completed",
                root_session_id: SessionSchema.ID.make("ses_council_root"),
                synthesis_session_id: SessionSchema.ID.make("ses_council_synthesis"),
                report_path: "/project/.opencode/reports/council/COUNCIL_REPORT.md",
                delegations: [
                  {
                    id: "run-council-heavy",
                    parent_id: "run-council-root",
                    parent_session_id: SessionSchema.ID.make("ses_council_perspective"),
                    workflow: "heavy",
                    depth: 1,
                    objective: "Validate the disputed implementation detail",
                    status: "completed",
                    summary: "Nested Heavy validated the implementation",
                    root_session_id: SessionSchema.ID.make("ses_nested_heavy"),
                    report_path: "/project/.opencode/reports/council/runs/run-council-heavy/HEAVY_REPORT.md",
                  },
                ],
                perspectives: [
                  {
                    perspective_id: "safety",
                    summary: "Proceed conditionally",
                    issues: [
                      {
                        id: "issue-1",
                        question: "Should this ship?",
                        stance: "conditional",
                        rationale: "Validation is required",
                        evidence: ["test output"],
                      },
                    ],
                    recommendations: ["Run validation"],
                    risks: ["Regression risk"],
                    session_id: SessionSchema.ID.make("ses_council_perspective"),
                  },
                ],
                debate: [
                  {
                    issue_id: "issue-1",
                    perspective_id: "safety",
                    round: 1,
                    stance: "conditional",
                    argument: "Ship after validation",
                    concessions: [],
                    rebuttals: ["Speed alone is insufficient"],
                    evidence: ["test output"],
                    session_id: SessionSchema.ID.make("ses_council_debate"),
                  },
                ],
                consensus: ["Validation is required"],
                disagreements: [],
                recommendations: ["Run validation"],
                risks: ["Regression risk"],
              }),
            ),
          )
        },
      }),
    ],
  ]),
)
const withResearch = testEffect(
  LayerNode.compile(root, [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer()],
    [
      Workflow.node,
      TestWorkflow.layer({
        research: (_input, context) =>
          (
            context.onProgress?.({
              structured: {
                workflow: "research",
                phase: "investigating",
                stage: "evidence",
                root_session_id: "ses_research_plan",
                session_id: "ses_research_evidence",
                parent_session_id: "ses_research_plan",
                child_status: "completed",
                child_agent: "research-reader",
                child_title: "Research evidence",
                node_id: "evidence-1",
                parent_node_id: "research-root",
                node_depth: 1,
                report_path: "/project/.opencode/reports/research/stages/ses_research_evidence.md",
                started_at: 100,
                updated_at: 500,
                elapsed_ms: 400,
              },
              text: "Research evidence completed",
            }) ?? Effect.void
          ).pipe(
            Effect.as(
              WorkflowSchema.ResearchOutput.make({
                workflow: "research",
                status: "completed",
                execution_status: "completed",
                artifact_status: "available",
                evidence_status: "completed",
                summary: "Adaptive research completed",
                final_response: "The standalone Research synthesis is authoritative.",
                root_session_id: SessionSchema.ID.make("ses_research_plan"),
                report_path: "/project/.opencode/reports/research/RESEARCH_REPORT.md",
                trace_path: "/project/.opencode/reports/research/RESEARCH_TRACE.md",
                graph_path: "/project/.opencode/reports/research/RESEARCH_GRAPH.json",
                nodes: [
                  {
                    id: "research-root",
                    depth: 0,
                    title: "Research root",
                    objective: "Investigate the decision",
                    planning_session_id: SessionSchema.ID.make("ses_research_plan"),
                    synthesis_session_id: SessionSchema.ID.make("ses_research_synthesis"),
                    contract: {
                      rationale: "Test the governing claim.",
                      objective: "Investigate the decision",
                      deliverables: ["Standalone report"],
                      assumptions: [],
                      unknowns: [],
                      falsifiers: [],
                      tasks: [],
                    },
                    waves: [
                      {
                        number: 1,
                        rationale: "Initial contract",
                        tasks: [
                          {
                            id: "evidence-1",
                            title: "Research evidence",
                            question: "What does the evidence show?",
                            priority: "critical",
                            role: "evidence",
                            mode: "leaf",
                            status: "completed",
                            session_id: SessionSchema.ID.make("ses_research_evidence"),
                            report_path: "/project/.opencode/reports/research/stages/ses_research_evidence.md",
                            reused: false,
                          },
                        ],
                        assessment_session_id: SessionSchema.ID.make("ses_research_assessment"),
                        assessment: {
                          decision: "stop",
                          rationale: "Coverage is complete.",
                          information_gain: "low",
                          coverage: "complete",
                          addressed_gap_ids: [],
                          tasks: [],
                          disputes: [],
                          deliverable_coverage: [
                            {
                              deliverable: "Standalone report",
                              status: "covered",
                              reason: "The completed evidence covers the requested report.",
                            },
                          ],
                        },
                      },
                    ],
                    result: {
                      status: "completed",
                      summary: "Adaptive research completed",
                      claims: [
                        {
                          id: "research-root:claim",
                          statement: "The evidence supports the decision",
                          kind: "fact",
                          status: "supported",
                          confidence: "high",
                          evidence_ids: [],
                          contradicts: [],
                          assumptions: [],
                        },
                      ],
                      evidence: [],
                      gaps: [],
                      disputes: [],
                      assumptions: [],
                      conclusions: ["Proceed"],
                      recommendations: [],
                      limitations: [],
                    },
                  },
                ],
                graph: {
                  claims: [
                    {
                      id: "research-root:claim",
                      statement: "The evidence supports the decision",
                      kind: "fact",
                      status: "supported",
                      confidence: "high",
                      evidence_ids: [],
                      contradicts: [],
                      assumptions: [],
                    },
                  ],
                  evidence: [],
                  gaps: [],
                  disputes: [],
                  assumptions: [],
                },
                evaluation: {
                  report_words: 1_500,
                  report_sections: 6,
                  standalone_pass: true,
                  claims: 1,
                  supported_claims: 1,
                  traceable_supported_claims: 0,
                  evidence_records: 0,
                  verified_sources: 0,
                  open_critical_gaps: 0,
                  consequential_disputes: 0,
                  council_reviews: 0,
                  evidence_tasks: 1,
                  reused_artifacts: 0,
                  coverage_complete: true,
                },
                councils: [],
              }),
            ),
          ),
      }),
    ],
  ]),
)
const withCodeMode = testEffect(
  LayerNode.compile(root, [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalCodeMode: true })],
    [Workflow.node, TestWorkflow.layer()],
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        tools: () =>
          Effect.succeed({
            weather_current: {
              def: {
                name: "current",
                description: "current weather",
                inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
              } as MCPToolDef,
              client: {} as MCP.McpTool["client"],
            },
          }),
        clients: () => Effect.succeed({ weather: {} as any }),
      }),
    ],
  ]),
)
const withEmptyCodeMode = testEffect(
  LayerNode.compile(root, [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalCodeMode: true })],
    [Workflow.node, TestWorkflow.layer()],
    [
      MCP.node,
      Layer.mock(MCP.Service, {
        tools: () => Effect.succeed({}),
        clients: () => Effect.succeed({}),
      }),
    ],
  ]),
)
const withBrokenPlugin = testEffect(LayerNode.compile(root, [...replacements, [Plugin.node, brokenPluginLayer]]))

afterEach(async () => {
  await disposeAllInstances()
})

describe("tool.registry", () => {
  it.instance("does not expose task_status", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("task_status")
    }),
  )

  it.instance("registers Heavy, Council, and Research compatibility tools", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      expect(yield* registry.ids()).toEqual(expect.arrayContaining(["heavy_run", "council_run", "research_run"]))
    }),
  )

  withResearch.instance("Research bridge preserves the claim graph and child session metadata", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const research = yield* agents.get("research")
      if (!research) throw new Error("Research agent not found")
      const tool = (yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: research,
      })).find((item) => item.id === "research_run")
      if (!tool) throw new Error("Research tool not found")
      const result = yield* tool.execute(
        { question: "Investigate the decision", effort: "deep" },
        {
          sessionID: SessionID.make("ses_parent"),
          messageID: MessageID.make("msg_parent"),
          callID: "call_research",
          agent: "research",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      const handoff = JSON.parse(result.output)
      expect(result.metadata.workflow).toBe("research")
      expect(result.metadata.rootSessionID).toBe("ses_research_plan")
      expect(result.metadata.reportPath).toBe("/project/.opencode/reports/research/RESEARCH_REPORT.md")
      expect(result.metadata.childSessionIDs).toContain("ses_research_evidence")
      expect(handoff.graph_path).toBe("/project/.opencode/reports/research/RESEARCH_GRAPH.json")
      expect(handoff.claim_graph.claims).toEqual([
        expect.objectContaining({ id: "research-root:claim", status: "supported" }),
      ])
    }),
  )

  withWorkflow.instance("Heavy bridge preserves the complete recursive result and child session metadata", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const heavy = yield* agents.get("heavy")
      if (!heavy) throw new Error("Heavy agent not found")
      const tool = (yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: heavy,
      })).find((item) => item.id === "heavy_run")
      if (!tool) throw new Error("Heavy tool not found")

      const updates: Array<{ title?: string; metadata?: Record<string, unknown> }> = []
      const result = yield* tool.execute(
        { task: "Trace the implementation" },
        {
          sessionID: SessionID.make("ses_parent"),
          messageID: MessageID.make("msg_parent"),
          callID: "call_heavy",
          agent: "heavy",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: (input) =>
            Effect.sync(() => {
              updates.push(input)
            }),
          ask: () => Effect.void,
        },
      )

      expect(result.metadata.rootSessionID).toBe("ses_heavy_root")
      expect(result.metadata.reportPath).toBe("/project/.opencode/reports/heavy/HEAVY_REPORT.md")
      expect(result.metadata.childSessionIDs).toEqual([
        "ses_heavy_root",
        "ses_heavy_worker",
        "ses_heavy_council_risk",
        "ses_nested_council_debater",
        "ses_heavy_synthesis",
        "ses_heavy_council_root",
        "ses_heavy_council_synthesis",
        "ses_nested_council",
      ])
      expect(updates[0]?.title).toBe("Heavy is executing a worker")
      expect(updates[0]?.metadata).toMatchObject({
        workflow: "heavy",
        status: "running",
        phase: "executing",
        progress: "Heavy is executing a worker",
        activeSessionID: "ses_heavy_worker",
        rootSessionID: "ses_heavy_root",
        childSessionIDs: ["ses_heavy_root", "ses_heavy_worker"],
        childSessions: [
          {
            sessionID: "ses_heavy_worker",
            parentSessionID: "ses_heavy_root",
            status: "running",
            workflow: "heavy",
            agent: "heavy-writer",
            title: "Heavy worker",
            stage: "execution",
            nodeID: "heavy-child",
            parentNodeID: "heavy-root",
            depth: 1,
            dependsOn: [],
            reportPath: "/project/.opencode/reports/heavy/stages/ses_heavy_worker.md",
            promptBytes: 4096,
            elapsedMs: 0,
          },
        ],
      })
      expect(updates[2]?.metadata).toMatchObject({
        workflow: "heavy",
        status: "running",
        rootSessionID: "ses_heavy_root",
        activeSessionID: "ses_heavy_council_risk",
        councilUsed: true,
      })
      expect(
        result.metadata.childSessions.filter((session: { sessionID: string }) =>
          ["ses_heavy_worker", "ses_heavy_council_risk", "ses_nested_council_debater"].includes(session.sessionID),
        ),
      ).toEqual([
        {
          sessionID: "ses_heavy_worker",
          parentSessionID: "ses_heavy_root",
          status: "completed",
          workflow: "heavy",
          agent: "heavy-writer",
          title: "Heavy worker",
          stage: "execution",
          nodeID: "heavy-child",
          parentNodeID: "heavy-root",
          depth: 1,
          capability: undefined,
          dependsOn: [],
          issue: undefined,
          round: undefined,
          reportPath: "/project/.opencode/reports/heavy/stages/ses_heavy_worker.md",
          promptBytes: 4096,
          startedAt: 100,
          updatedAt: 500,
          elapsedMs: 400,
          error: undefined,
        },
        {
          sessionID: "ses_heavy_council_risk",
          parentSessionID: "ses_heavy_council_root",
          status: "completed",
          workflow: "council",
          agent: "council-perspective",
          title: "Council: risk",
          stage: "perspective",
          nodeID: "risk",
          parentNodeID: "council-root",
          depth: 1,
          capability: undefined,
          dependsOn: undefined,
          issue: undefined,
          round: undefined,
          reportPath: "/project/.opencode/reports/heavy/stages/ses_heavy_council_risk.md",
          promptBytes: 2048,
          startedAt: 600,
          updatedAt: 900,
          elapsedMs: 300,
          error: undefined,
        },
        {
          sessionID: "ses_nested_council_debater",
          parentSessionID: "ses_nested_council_plan",
          runID: "run-heavy-council",
          parentRunID: "run-heavy-root",
          status: "completed",
          workflow: "council",
          agent: "council-debater",
          title: "Nested Council debate",
          stage: "debate",
          nodeID: undefined,
          parentNodeID: undefined,
          depth: 1,
          capability: undefined,
          dependsOn: undefined,
          issue: "issue-1",
          round: 1,
          reportPath: "/project/.opencode/reports/heavy/stages/ses_nested_council_debater.md",
          promptBytes: 8192,
          startedAt: 1000,
          updatedAt: 1500,
          elapsedMs: 500,
          error: undefined,
        },
      ])
      expect(new Set(result.metadata.childSessions.map((session: { sessionID: string }) => session.sessionID))).toEqual(
        new Set(result.metadata.childSessionIDs),
      )
      expect(result.metadata).toMatchObject({
        status: "completed",
        phase: "completed",
        activeSessionID: undefined,
        councilUsed: true,
        reports: [
          {
            sessionID: "ses_heavy_synthesis",
            status: "completed",
            title: "Heavy root",
            stage: "final",
          },
          {
            sessionID: "ses_heavy_worker",
            status: "completed",
            title: "Inspect the recursive implementation",
            stage: "execution",
          },
          {
            sessionID: "ses_nested_council",
            status: "completed",
            title: "Council: Challenge the recursive implementation",
            stage: "council-delegation",
            reportPath: "/project/.opencode/reports/heavy/runs/run-heavy-council/COUNCIL_REPORT.md",
          },
          {
            sessionID: "ses_heavy_council_synthesis",
            status: "completed",
            title: "Council synthesis",
            stage: "council-final",
          },
          {
            sessionID: "ses_heavy_council_risk",
            status: "completed",
            title: "Council: risk",
            stage: "council-perspective",
          },
        ],
      })
      expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(Truncate.MAX_BYTES)
      expect(result.metadata.truncated).toBe(false)
      expect(result.metadata.outputPath).toBeUndefined()
      const handoff = JSON.parse(result.output.split("\n", 1)[0] ?? "{}")
      expect(handoff.handoff_compacted).toBe(true)
      expect(handoff.final_report.summary).toBe("Recursive work completed")
      expect(handoff.final_report.session_id).toBe("ses_heavy_synthesis")
      expect(handoff.final_response).toBe(
        "The durable Heavy synthesis is authoritative.\n\n[Full Heavy report](/project/.opencode/reports/heavy/HEAVY_REPORT.md)",
      )
      expect(handoff.report_link).toBe("[Full Heavy report](/project/.opencode/reports/heavy/HEAVY_REPORT.md)")
      expect(handoff.execution_status).toBe("partial")
      expect(handoff.artifact_status).toBe("available")
      expect(handoff.evidence_status).toBe("completed")
      expect(handoff.usage.input).toBe(100)
      expect(handoff.source_manifest).toEqual(["https://example.com/workflow"])
      expect(handoff.source_provenance).toEqual([
        expect.objectContaining({
          url: "https://example.com/workflow",
        }),
      ])
      expect(handoff.coverage_diagnostics).toEqual({
        coverage_complete: true,
        unaccounted_artifacts: [],
      })
      expect(handoff.council_review.summary).toBe("Independent review supports the result")
      expect(handoff.council_report_manifest[0]).toMatchObject({
        kind: "synthesis",
        session_id: "ses_heavy_council_synthesis",
      })
      expect(handoff.delegation_manifest).toEqual([
        expect.objectContaining({
          workflow: "council",
          root_session_id: "ses_nested_council",
          report_path: "/project/.opencode/reports/heavy/runs/run-heavy-council/COUNCIL_REPORT.md",
        }),
      ])
      expect(handoff.report_manifest).toEqual([
        expect.objectContaining({
          title: "Inspect the recursive implementation",
          status: "completed",
          session_id: "ses_heavy_worker",
        }),
      ])
      expect(
        handoff.session_manifest.filter(
          (session: { status?: string }) => session.status === "failed" || session.status === "timed_out",
        ),
      ).toEqual([])
    }),
  )

  withWorkflow.instance("Council bridge preserves debate and participant session metadata", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const council = yield* agents.get("council")
      if (!council) throw new Error("Council agent not found")
      const tool = (yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: council,
      })).find((item) => item.id === "council_run")
      if (!tool) throw new Error("Council tool not found")

      const updates: Array<{ title?: string; metadata?: Record<string, unknown> }> = []
      const result = yield* tool.execute(
        { question: "Should this ship?" },
        {
          sessionID: SessionID.make("ses_parent"),
          messageID: MessageID.make("msg_parent"),
          callID: "call_council",
          agent: "council",
          abort: AbortSignal.any([]),
          messages: [],
          metadata: (input) =>
            Effect.sync(() => {
              updates.push(input)
            }),
          ask: () => Effect.void,
        },
      )

      expect(result.metadata.rootSessionID).toBe("ses_council_root")
      expect(result.metadata.reportPath).toBe("/project/.opencode/reports/council/COUNCIL_REPORT.md")
      expect(result.metadata.childSessionIDs).toEqual([
        "ses_council_root",
        "ses_council_perspective",
        "ses_council_synthesis",
        "ses_council_debate",
        "ses_nested_heavy",
      ])
      expect(updates[0]?.metadata).toMatchObject({
        workflow: "council",
        status: "running",
        phase: "perspectives",
        activeSessionID: "ses_council_perspective",
        childSessions: [
          {
            sessionID: "ses_council_perspective",
            status: "timed_out",
            error: "Perspective timed out",
          },
        ],
      })
      expect(updates[1]?.metadata).toMatchObject({
        workflow: "council",
        status: "running",
        phase: "synthesizing",
        progress: "Council synthesized the deliberation",
        activeSessionID: "ses_council_synthesis",
        rootSessionID: "ses_council_root",
        childSessionIDs: ["ses_council_root", "ses_council_perspective", "ses_council_synthesis"],
      })
      expect(result.metadata.status).toBe("partial")
      expect(result.metadata.phase).toBe("partial")
      expect(result.metadata.activeSessionID).toBeUndefined()
      expect(result.metadata.reports[0]).toEqual({
        sessionID: "ses_council_synthesis",
        status: "partial",
        title: "Council synthesis",
        stage: "final",
        reportPath: "/project/.opencode/reports/council/COUNCIL_REPORT.md",
      })
      expect(
        result.metadata.childSessions.filter((session: { sessionID: string }) =>
          ["ses_council_perspective", "ses_council_synthesis"].includes(session.sessionID),
        ),
      ).toMatchObject([
        { sessionID: "ses_council_perspective", status: "timed_out" },
        { sessionID: "ses_council_synthesis", status: "completed" },
      ])
      expect(new Set(result.metadata.childSessions.map((session: { sessionID: string }) => session.sessionID))).toEqual(
        new Set(result.metadata.childSessionIDs),
      )
      expect(result.output).toContain("Speed alone is insufficient")
      expect(result.output).toContain("Validation is required")
      const handoff = JSON.parse(result.output.split("\n", 1)[0] ?? "{}")
      expect(handoff.final_report.consensus).toEqual(["Validation is required"])
      expect(handoff.final_report.session_id).toBe("ses_council_synthesis")
      expect(handoff.final_response).toBe("[Full Council report](/project/.opencode/reports/council/COUNCIL_REPORT.md)")
      expect(handoff.perspective_reports).toEqual([
        expect.objectContaining({
          perspective_id: "safety",
          session_id: "ses_council_perspective",
        }),
      ])
      expect(handoff.debate_reports).toEqual([
        expect.objectContaining({
          issue_id: "issue-1",
          perspective_id: "safety",
          session_id: "ses_council_debate",
        }),
      ])
      expect(handoff.delegation_manifest).toEqual([
        expect.objectContaining({
          workflow: "heavy",
          root_session_id: "ses_nested_heavy",
          report_path: "/project/.opencode/reports/council/runs/run-council-heavy/HEAVY_REPORT.md",
        }),
      ])
    }),
  )

  it.instance("does not expose execute unless code mode is enabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()

      expect(ids).not.toContain("execute")
    }),
  )

  withCodeMode.instance("exposes execute when code mode is enabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const ids = yield* registry.ids()
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: yield* agents.defaultInfo(),
      })
      const execute = tools.find((tool) => tool.id === "execute")

      expect(ids).toContain("execute")
      expect(tools.map((tool) => tool.id)).toContain("execute")
      expect(execute?.description).toContain("tools.weather.current(input: {\n  city: string,\n})")
    }),
  )

  withEmptyCodeMode.instance("does not expose execute when code mode has no visible tools", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agents = yield* Agent.Service
      const tools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: yield* agents.defaultInfo(),
      })

      expect(tools.map((tool) => tool.id)).not.toContain("execute")
    }),
  )

  it.instance("hides task background parameter unless experimental background subagents are enabled", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const agent = yield* Agent.Service
      const build = yield* agent.get("build")
      if (!build) throw new Error("build agent not found")
      const task = (yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: build,
      })).find((tool) => tool.id === "task")

      expect(task?.jsonSchema).toBeDefined()
      expect((task?.jsonSchema?.properties as Record<string, unknown> | undefined)?.background).toBeUndefined()
    }),
  )

  it.instance("loads tools from .opencode/tool (singular)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".opencode")
      const tool = path.join(opencode, "tool")
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
  )

  it.instance("ignores non-tool exports in .opencode/tool files", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const tool = path.join(test.directory, ".opencode", "tool")
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "mixed.ts"),
          [
            "export const helper = 'not a tool'",
            "export default {",
            "  description: 'mixed tool',",
            "  args: {},",
            "  execute: async () => 'ok',",
            "}",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("mixed")
      expect(ids).not.toContain("mixed_helper")
    }),
  )

  // Regression for #27451 / #27630: a custom tool that omits `args` must not
  // crash registry initialization with
  // `Object.entries requires that input parameter not be null or undefined`.
  // Pre-1.14.49 the code path was `z.object(def.args)`, and `z.object(undefined)`
  // silently produced an empty schema — so the tool registered as no-args.
  // Preserve that tolerance.
  it.instance("tolerates a custom tool exporting null/undefined args (no-args fallback)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const tool = path.join(test.directory, ".opencode", "tool")
      yield* Effect.promise(() => fs.mkdir(tool, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tool, "noargs.ts"),
          [
            "export default {",
            "  description: 'tool with no args',",
            "  args: undefined,",
            "  execute: async () => 'ok',",
            "}",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      // Built-in tools must still load — a single malformed custom tool must
      // not poison the whole registry.
      expect(ids).toContain("read")
      const loaded = (yield* registry.all()).find((t) => t.id === "noargs")
      if (!loaded) throw new Error("noargs tool was not loaded")
      expect(loaded.jsonSchema).toMatchObject({ type: "object", properties: {} })
    }),
  )

  // Same regression, plugin entry point. The original reports (#27451, #27630)
  // came in through `plugin.list()` — `oh-my-opencode` was registering a tool
  // with `args: undefined` and crashing every message submit. The file-scan
  // and plugin-list loops both funnel through `fromPlugin`, but covering both
  // entry points means a future refactor that splits them won't silently lose
  // protection.
  withBrokenPlugin.instance("tolerates a plugin tool registered with null/undefined args", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("read")
      expect(ids).toContain("broken_plugin_tool")
    }),
  )

  it.instance("loads tools from .opencode/tools (plural)", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".opencode")
      const tools = path.join(opencode, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "hello.ts"),
          [
            "export default {",
            "  description: 'hello tool',",
            "  args: {},",
            "  execute: async () => {",
            "    return 'hello world'",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("hello")
    }),
  )

  it.instance("loads Zod-schema custom tools with JSON Schema and validation", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const customTools = path.join(test.directory, ".opencode", "tools")
      const pluginTool = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(customTools, "sql.ts"),
          [
            `import { tool } from ${JSON.stringify(pluginTool)}`,
            "export default tool({",
            "  description: 'query database',",
            "  args: { query: tool.schema.string().describe('SQL query to execute') },",
            "  execute: async ({ query }) => query,",
            "})",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "sql")
      if (!loaded) throw new Error("custom sql tool was not loaded")
      expect(loaded?.jsonSchema).toMatchObject({
        type: "object",
        properties: {
          query: { type: "string", description: "SQL query to execute" },
        },
        required: ["query"],
      })
      expect(Result.isSuccess(Schema.decodeUnknownResult(loaded.parameters)({ query: "select 1" }))).toBe(true)
      expect(Result.isSuccess(Schema.decodeUnknownResult(loaded.parameters)({}))).toBe(false)

      const agents = yield* Agent.Service
      const promptTools = yield* registry.tools({
        providerID: ProviderV2.ID.opencode,
        modelID: ModelV2.ID.make("test"),
        agent: yield* agents.defaultInfo(),
      })
      const promptTool = promptTools.find((tool) => tool.id === "sql")
      if (!promptTool) throw new Error("custom sql tool was not returned for prompts")
      expect(ToolJsonSchema.fromTool(promptTool)).toMatchObject({
        properties: {
          query: { type: "string", description: "SQL query to execute" },
        },
        required: ["query"],
      })
    }),
  )

  it.instance(
    "preserves Zod arg descriptions from older config-scoped plugin packages",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const opencode = path.join(test.directory, ".opencode")
        const customTools = path.join(opencode, "tools")
        const plugin = path.join(opencode, "node_modules", "@opencode-ai", "plugin")
        yield* Effect.promise(() => fs.mkdir(path.join(plugin, "dist"), { recursive: true }))
        yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
        yield* Effect.promise(() =>
          fs.cp(path.dirname(fileURLToPath(import.meta.resolve("zod"))), path.join(opencode, "node_modules", "zod"), {
            dereference: true,
            recursive: true,
          }),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(plugin, "package.json"),
            JSON.stringify({ name: "@opencode-ai/plugin", type: "module", exports: { ".": "./dist/index.js" } }),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(plugin, "dist", "index.js"),
            [
              "import { z } from 'zod'",
              "export function tool(input) {",
              "  return input",
              "}",
              "tool.schema = z",
              "",
            ].join("\n"),
          ),
        )
        yield* Effect.promise(() =>
          Bun.write(
            path.join(customTools, "addition.ts"),
            [
              'import { tool } from "@opencode-ai/plugin"',
              "export default tool({",
              "  description: 'Use this tool to add two numbers and return their sum.',",
              "  args: {",
              "    left: tool.schema.number().describe('The first number to add'),",
              "    right: tool.schema.number().describe('The second number to add'),",
              "  },",
              "  execute: async (args) => `${args.left} + ${args.right} = ${args.left + args.right}`,",
              "})",
              "",
            ].join("\n"),
          ),
        )

        const registry = yield* ToolRegistry.Service
        const loaded = (yield* registry.all()).find((tool) => tool.id === "addition")
        if (!loaded) throw new Error("custom addition tool was not loaded")

        expect(ToolJsonSchema.fromTool(loaded)).toMatchObject({
          properties: {
            left: { type: "number", description: "The first number to add" },
            right: { type: "number", description: "The second number to add" },
          },
        })
      }),
    20_000,
  )

  it.instance("preserves attachments from structured custom tool results", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const customTools = path.join(test.directory, ".opencode", "tools")
      const pluginTool = pathToFileURL(path.resolve(import.meta.dir, "../../../plugin/src/tool.ts")).href
      yield* Effect.promise(() => fs.mkdir(customTools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(customTools, "image.ts"),
          [
            `import { tool } from ${JSON.stringify(pluginTool)}`,
            "export default tool({",
            "  description: 'image tool',",
            "  args: {},",
            "  execute: async () => ({",
            "    output: 'here is an image',",
            "    attachments: [{ type: 'file', mime: 'image/png', filename: 'picture.png', url: 'data:image/png;base64,AAAA' }],",
            "  }),",
            "})",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "image")
      if (!loaded) throw new Error("custom image tool was not loaded")
      const agents = yield* Agent.Service
      const result = yield* loaded.execute({}, {
        sessionID: SessionID.make("ses_test"),
        messageID: MessageID.make("msg_test"),
        agent: (yield* agents.defaultInfo()).name,
        abort: new AbortController().signal,
        messages: [],
        metadata: () => Effect.void,
        ask: () => Effect.void,
      } satisfies Tool.Context)

      expect(result.output).toBe("here is an image")
      expect(result.attachments).toEqual([
        { type: "file", mime: "image/png", filename: "picture.png", url: "data:image/png;base64,AAAA" },
      ])
    }),
  )

  it.instance("loads legacy JSON-schema-shaped custom tools with wire schema", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const tools = path.join(test.directory, ".opencode", "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "legacy.ts"),
          [
            "export default {",
            "  description: 'legacy schema tool',",
            "  args: { text: { type: 'string', description: 'Text to render' } },",
            "  execute: async ({ text }) => text,",
            "}",
            "",
          ].join("\n"),
        ),
      )

      const registry = yield* ToolRegistry.Service
      const loaded = (yield* registry.all()).find((tool) => tool.id === "legacy")
      if (!loaded) throw new Error("legacy custom tool was not loaded")
      expect(ToolJsonSchema.fromTool(loaded)).toMatchObject({
        type: "object",
        properties: {
          text: { type: "string", description: "Text to render" },
        },
        required: ["text"],
      })
    }),
  )

  it.instance("loads tools with external dependencies without crashing", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const opencode = path.join(test.directory, ".opencode")
      const tools = path.join(opencode, "tools")
      yield* Effect.promise(() => fs.mkdir(tools, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(opencode, "package.json"),
          JSON.stringify({
            name: "custom-tools",
            dependencies: {
              "@opencode-ai/plugin": "^0.0.0",
              cowsay: "^1.6.0",
            },
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(opencode, "package-lock.json"),
          JSON.stringify({
            name: "custom-tools",
            lockfileVersion: 3,
            packages: {
              "": {
                dependencies: {
                  "@opencode-ai/plugin": "^0.0.0",
                  cowsay: "^1.6.0",
                },
              },
            },
          }),
        ),
      )

      const cowsay = path.join(opencode, "node_modules", "cowsay")
      yield* Effect.promise(() => fs.mkdir(cowsay, { recursive: true }))
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "package.json"),
          JSON.stringify({
            name: "cowsay",
            type: "module",
            exports: "./index.js",
          }),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(cowsay, "index.js"),
          ["export function say({ text }) {", "  return `moo ${text}`", "}", ""].join("\n"),
        ),
      )
      yield* Effect.promise(() =>
        Bun.write(
          path.join(tools, "cowsay.ts"),
          [
            "import { say } from 'cowsay'",
            "export default {",
            "  description: 'tool that imports cowsay at top level',",
            "  args: { text: { type: 'string' } },",
            "  execute: async ({ text }: { text: string }) => {",
            "    return say({ text })",
            "  },",
            "}",
            "",
          ].join("\n"),
        ),
      )
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("cowsay")
    }),
  )
})
