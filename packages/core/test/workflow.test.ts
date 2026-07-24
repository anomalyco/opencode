import { describe, expect } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Tool } from "@opencode-ai/core/tool/tool"
import { CouncilWorkflow } from "@opencode-ai/core/workflow/council"
import { HeavyWorkflow } from "@opencode-ai/core/workflow/heavy"
import { WorkflowRuntime } from "@opencode-ai/core/workflow/runtime"
import { DateTime, Effect, Layer, Schema } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
const parent = SessionV2.Info.make({
  id: SessionV2.ID.make("ses_workflow_parent"),
  projectID: ProjectV2.ID.global,
  title: "Workflow parent",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
  location: { directory: AbsolutePath.make("/project") },
})
const context: Tool.Context = {
  sessionID: parent.id,
  agent: AgentV2.ID.make("heavy"),
  assistantMessageID: SessionMessage.ID.make("msg_workflow_parent"),
  toolCallID: "call-workflow",
}
const nodeResult = {
  status: "completed",
  summary: "complete",
  decisions: [],
  findings: [{ claim: "deep finding", evidence: ["src/example.ts"] }],
  changed_files: ["src/example.ts"],
  validation: ["bun test"],
  risks: [],
  follow_up: [],
}

describe("workflows", () => {
  it.effect("propagates recursive Heavy work through write-capable child sessions", () =>
    Effect.gen(function* () {
      let plans = 0
      const agents: string[] = []
      const prompts: string[] = []
      const progress: Record<string, unknown>[] = []
      const runtime = makeRuntime((input) => {
        agents.push(input.agent)
        prompts.push(input.prompt)
        if (input.agent === "heavy-planner") {
          plans++
          return {
            rationale: `plan ${plans}`,
            tasks:
              plans === 1
                ? [
                    {
                      id: "investigate",
                      title: "Investigate deeply",
                      objective: "Trace and fix the implementation",
                      capability: "write",
                      mode: "leaf",
                      depends_on: [],
                    },
                  ]
                : [
                    {
                      id: "implement",
                      title: "Implement",
                      objective: "Make and validate the change",
                      capability: "write",
                      mode: "leaf",
                      depends_on: [],
                    },
                  ],
          }
        }
        return nodeResult
      }, progress)

      const output = yield* HeavyWorkflow.run(
        "Fix the implementation thoroughly",
        parent,
        context,
        {
          maxDepth: 2,
          tasksPerNode: 4,
          maxNodes: 8,
          concurrency: 4,
          onFailure: "keep",
          models: {},
        },
        runtime,
      )

      expect(output.status).toBe("completed")
      expect(output.nodes).toHaveLength(3)
      expect(output.nodes.map((node) => node.depth)).toEqual([0, 1, 2])
      expect(output.nodes.map((node) => node.parent_id)).toEqual([undefined, output.nodes[0]?.id, output.nodes[1]?.id])
      expect(output.nodes.at(-1)?.changed_files).toEqual(["src/example.ts"])
      expect(agents).toContain("heavy-writer")
      expect(prompts.some((prompt) => prompt.includes("Ancestor context"))).toBe(true)
      expect(prompts.some((prompt) => prompt.includes('"nodes"') && prompt.includes("deep finding"))).toBe(true)
      expect(progress.some((item) => item.phase === "recursing")).toBe(true)
    }),
  )

  it.effect("runs Council participants concurrently by round over stable issue IDs", () =>
    Effect.gen(function* () {
      const debatePrompts: string[] = []
      const runtime = makeRuntime((input) => {
        if (input.agent === "council-planner")
          return {
            rationale: "cover both sides",
            issues: [{ id: "model-id", question: "Should the design be adopted?" }],
            perspectives: [
              { id: "pro", title: "Pro", instructions: "Argue for adoption." },
              { id: "con", title: "Con", instructions: "Challenge adoption." },
            ],
          }
        if (input.agent === "council-perspective") {
          const support = input.id.endsWith("perspective-1")
          return {
            perspective_id: "ignored",
            summary: support ? "adopt" : "reject",
            issues: [
              {
                id: "issue-1",
                question: "Should the design be adopted?",
                stance: support ? "support" : "oppose",
                rationale: support ? "benefits" : "risks",
                evidence: [support ? "benefit evidence" : "risk evidence"],
              },
            ],
            recommendations: [],
            risks: [],
          }
        }
        if (input.agent === "council-debater") {
          debatePrompts.push(input.prompt)
          return {
            issue_id: "ignored",
            perspective_id: "ignored",
            round: 1,
            stance: input.id.endsWith("perspective-1") ? "support" : "oppose",
            argument: "engaged argument",
            concessions: [],
            rebuttals: ["counterpoint"],
            evidence: ["debate evidence"],
          }
        }
        return {
          status: "completed",
          summary: "balanced answer",
          consensus: ["Evidence matters"],
          disagreements: [
            {
              issue_id: "planner-model-id",
              question: "Should the design be adopted?",
              positions: ["support", "oppose"],
            },
          ],
          recommendations: ["Proceed conditionally"],
          risks: ["Open disagreement"],
        }
      })

      const output = yield* CouncilWorkflow.run(
        "Should we adopt this design?",
        parent,
        { ...context, agent: AgentV2.ID.make("council"), toolCallID: "call-council" },
        {
          perspectives: 2,
          concurrency: 2,
          debate: { mode: "auto", topics: 1, participants: 2, rounds: 2 },
          models: {},
        },
        runtime,
      )

      expect(output.perspectives.map((perspective) => perspective.perspective_id)).toEqual([
        "perspective-1",
        "perspective-2",
      ])
      expect(output.debate).toHaveLength(4)
      expect(output.debate.every((item) => item.issue_id === "issue-1")).toBe(true)
      expect(output.disagreements.every((item) => item.issue_id === "issue-1")).toBe(true)
      expect(output.debate.map((item) => item.round)).toEqual([1, 1, 2, 2])
      expect(output.perspectives.every((item) => item.session_id.startsWith("ses_"))).toBe(true)
      expect(output.debate.every((item) => item.session_id.startsWith("ses_"))).toBe(true)
      expect(debatePrompts.filter((prompt) => prompt.includes("round 2"))).toHaveLength(2)
      expect(debatePrompts.filter((prompt) => prompt.includes('"argument": "engaged argument"'))).toHaveLength(2)
    }),
  )

  it.effect("red-teams the first stable issue when Council initially agrees", () =>
    Effect.gen(function* () {
      const debatePrompts: string[] = []
      const runtime = makeRuntime((input) => {
        if (input.agent === "council-planner")
          return {
            rationale: "test consensus",
            issues: [{ id: "decision", question: "Proceed?" }],
            perspectives: [{ id: "one", title: "One", instructions: "Assess." }],
          }
        if (input.agent === "council-perspective")
          return {
            perspective_id: "ignored",
            summary: "proceed",
            issues: [
              {
                id: "issue-1",
                question: "Proceed?",
                stance: "support",
                rationale: "looks sound",
                evidence: [],
              },
            ],
            recommendations: [],
            risks: [],
          }
        if (input.agent === "council-debater") {
          debatePrompts.push(input.prompt)
          return {
            issue_id: "issue-1",
            perspective_id: "ignored",
            round: 1,
            stance: "conditional",
            argument: "hidden condition",
            concessions: [],
            rebuttals: [],
            evidence: [],
          }
        }
        return {
          status: "completed",
          summary: "tested consensus",
          consensus: [],
          disagreements: [],
          recommendations: [],
          risks: [],
        }
      })

      const output = yield* CouncilWorkflow.run(
        "Proceed?",
        parent,
        { ...context, agent: AgentV2.ID.make("council"), toolCallID: "call-red-team" },
        {
          perspectives: 2,
          concurrency: 2,
          debate: { mode: "auto", topics: 1, participants: 2, rounds: 1 },
          models: {},
        },
        runtime,
      )

      expect(output.perspectives).toHaveLength(2)
      expect(debatePrompts).toHaveLength(2)
      expect(debatePrompts.every((prompt) => prompt.includes("rigorous red team"))).toBe(true)
    }),
  )
})

function makeRuntime(
  resolve: (input: WorkflowRuntime.ChildInput<Tool.SchemaType<any>>) => unknown,
  checkpoints: Record<string, unknown>[] = [],
): WorkflowRuntime.Interface {
  return {
    childID: (_parentID, id) => SessionV2.ID.make(`ses_${id}`),
    runChild: <Result extends Tool.SchemaType<any>>(input: WorkflowRuntime.ChildInput<Result>) =>
      Effect.sync(() => Schema.decodeUnknownSync(input.result)(resolve(input))),
    progress: (_context, structured) =>
      Effect.sync(() => {
        checkpoints.push(structured)
      }),
  }
}
