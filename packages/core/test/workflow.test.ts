import { describe, expect } from "bun:test"
import { AgentV2 } from "@opencode-ai/core/agent"
import { EventV2 } from "@opencode-ai/core/event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionInput } from "@opencode-ai/core/session/input"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionTools } from "@opencode-ai/core/tool/session-tools"
import { Tool } from "@opencode-ai/core/tool/tool"
import { CouncilWorkflow } from "@opencode-ai/core/workflow/council"
import { WorkflowHandoff } from "@opencode-ai/core/workflow/handoff"
import { HeavyWorkflow } from "@opencode-ai/core/workflow/heavy"
import { WorkflowRuntime } from "@opencode-ai/core/workflow/runtime"
import { DateTime, Effect, Fiber, Layer, Ref, Schema } from "effect"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
const parent = SessionV2.Info.make({
  id: SessionV2.ID.make("ses_workflow_parent"),
  projectID: ProjectV2.ID.global,
  title: "Workflow parent",
  model: {
    id: ModelV2.ID.make("gpt-5.6-luna"),
    providerID: ProviderV2.ID.make("openai"),
    variant: ModelV2.VariantID.make("medium"),
  },
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
      const models: Array<ModelV2.Ref | undefined> = []
      const prompts: string[] = []
      const progress: Record<string, unknown>[] = []
      const runtime = makeRuntime((input) => {
        agents.push(input.agent)
        models.push(input.model)
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
          childTimeoutMs: 60_000,
          onFailure: "keep",
          models: {},
        },
        runtime,
      )

      expect(output.status).toBe("completed")
      expect(output.nodes).toHaveLength(3)
      expect(output.nodes.map((node) => node.depth)).toEqual([0, 1, 2])
      expect(output.nodes.map((node) => node.parent_id)).toEqual([undefined, output.nodes[0]?.id, output.nodes[1]?.id])
      expect(output.nodes[0]?.session_id).toContain(":synthesis")
      expect(output.nodes[0]?.planning_session_id).toContain(":plan")
      expect(output.nodes.at(-1)?.changed_files).toEqual(["src/example.ts"])
      expect(agents).toContain("heavy-writer")
      expect(models.every((model) => model === parent.model)).toBe(true)
      expect(prompts.some((prompt) => prompt.includes("Ancestor context"))).toBe(true)
      expect(prompts.some((prompt) => prompt.includes('"nodes"') && prompt.includes("deep finding"))).toBe(true)
      expect(progress.some((item) => item.phase === "recursing")).toBe(true)
      expect(
        progress
          .filter((item) => ["planning", "recursing", "executing", "synthesizing"].includes(String(item.phase)))
          .every((item) => typeof item.session_id === "string"),
      ).toBe(true)
      expect(
        progress.some((item) => item.phase === "synthesizing" && String(item.session_id).includes(":synthesis")),
      ).toBe(true)
    }),
  )

  it.effect("runs independent recursive read branches concurrently", () =>
    Effect.gen(function* () {
      let active = 0
      let maximum = 0
      const runtime: WorkflowRuntime.Interface = {
        childID: (_parentID, id) => SessionV2.ID.make(`ses_${id}`),
        runChild: <Result extends Tool.SchemaType<any>>(input: WorkflowRuntime.ChildInput<Result>) =>
          Effect.gen(function* () {
            if (input.agent === "heavy-planner" && input.parentID === parent.id)
              return Schema.decodeUnknownSync(input.result)({
                rationale: "parallel research",
                tasks: [
                  {
                    id: "one",
                    title: "First branch",
                    objective: "Research the first independent area",
                    capability: "read",
                    mode: "recurse",
                    depends_on: [],
                  },
                  {
                    id: "two",
                    title: "Second branch",
                    objective: "Research the second independent area",
                    capability: "read",
                    mode: "recurse",
                    depends_on: [],
                  },
                ],
              })
            if (input.agent === "heavy-planner") {
              active++
              maximum = Math.max(maximum, active)
              yield* Effect.promise(() => Bun.sleep(20))
              active--
              return Schema.decodeUnknownSync(input.result)({
                rationale: "one bounded leaf",
                tasks: [
                  {
                    id: "work",
                    title: "Research",
                    objective: "Complete the branch research",
                    capability: "read",
                    mode: "leaf",
                    depends_on: [],
                  },
                ],
              })
            }
            return Schema.decodeUnknownSync(input.result)(nodeResult)
          }),
        progress: () => Effect.void,
      }

      yield* HeavyWorkflow.run(
        "Research two independent areas",
        parent,
        context,
        {
          maxDepth: 2,
          tasksPerNode: 4,
          maxNodes: 8,
          concurrency: 4,
          childTimeoutMs: 60_000,
          onFailure: "keep",
          models: {},
        },
        runtime,
      )

      expect(maximum).toBe(2)
    }),
  )

  it.effect("removes terminal report-only tasks because every Heavy node already synthesizes", () =>
    Effect.gen(function* () {
      const agents: string[] = []
      const runtime = makeRuntime((input) => {
        agents.push(input.agent)
        if (input.agent === "heavy-planner")
          return {
            rationale: "research then report",
            tasks: [
              {
                id: "one",
                title: "Research storage",
                objective: "Collect storage evidence",
                capability: "read",
                mode: "leaf",
                depends_on: [],
              },
              {
                id: "two",
                title: "Research networking",
                objective: "Collect networking evidence",
                capability: "read",
                mode: "leaf",
                depends_on: [],
              },
              {
                id: "report",
                title: "Synthesize final report",
                objective: "Assemble the findings into the final report",
                capability: "read",
                mode: "leaf",
                depends_on: ["one", "two"],
              },
              {
                id: "recommendation",
                title: "Synthesize architecture recommendation",
                objective: "Write the final architecture recommendation",
                capability: "read",
                mode: "leaf",
                depends_on: ["one", "two"],
              },
            ],
          }
        return nodeResult
      })

      const output = yield* HeavyWorkflow.run(
        "Research and report",
        parent,
        context,
        {
          maxDepth: 1,
          tasksPerNode: 4,
          maxNodes: 8,
          concurrency: 4,
          childTimeoutMs: 60_000,
          onFailure: "keep",
          models: {},
        },
        runtime,
      )

      expect(agents.filter((agent) => agent === "heavy-reader")).toHaveLength(2)
      expect(output.nodes.map((node) => node.title)).not.toContain("Synthesize final report")
      expect(output.nodes.map((node) => node.title)).not.toContain("Synthesize architecture recommendation")
    }),
  )

  it.effect("runs one Council review inside Heavy before the root synthesis", () =>
    Effect.gen(function* () {
      const agents: string[] = []
      const prompts: string[] = []
      const runtime = makeRuntime((input) => {
        agents.push(input.agent)
        prompts.push(input.prompt)
        if (input.agent === "heavy-planner")
          return {
            rationale: "collect evidence",
            tasks: [
              {
                id: "research",
                title: "Research",
                objective: "Collect the evidence",
                capability: "read",
                mode: "leaf",
                depends_on: [],
              },
            ],
          }
        if (input.agent === "council-planner")
          return {
            rationale: "challenge the Heavy result",
            issues: [{ id: "decision", question: "Is the conclusion justified?" }],
            perspectives: [
              { id: "delivery", title: "Delivery", instructions: "Assess feasibility." },
              { id: "risk", title: "Risk", instructions: "Challenge assumptions." },
            ],
          }
        if (input.agent === "council-perspective")
          return {
            perspective_id: "ignored",
            summary: "Proceed conditionally",
            issues: [
              {
                id: "issue-1",
                question: "Is the conclusion justified?",
                stance: "conditional",
                rationale: "Evidence is promising",
                evidence: ["https://example.com/evidence"],
              },
            ],
            recommendations: ["Validate the hotspot"],
            risks: ["Capacity remains unmeasured"],
          }
        if (input.agent === "council-synthesizer")
          return {
            status: "completed",
            summary: "The Council recommends a measured prototype",
            consensus: ["Prototype before committing"],
            disagreements: [],
            recommendations: ["Benchmark the hotspot"],
            risks: ["Unmeasured capacity"],
          }
        return nodeResult
      })

      const output = yield* HeavyWorkflow.run(
        "Assess the architecture",
        parent,
        context,
        {
          maxDepth: 1,
          tasksPerNode: 4,
          maxNodes: 8,
          concurrency: 4,
          childTimeoutMs: 60_000,
          onFailure: "keep",
          models: {},
          council: {
            perspectives: 2,
            concurrency: 2,
            childTimeoutMs: 60_000,
            debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
            models: {},
          },
        },
        runtime,
      )

      expect(output.council?.status).toBe("completed")
      expect(output.council?.synthesis_session_id).toContain(":synthesis")
      expect(agents).toContain("council-planner")
      expect(agents).toContain("council-perspective")
      expect(agents).toContain("council-synthesizer")
      expect(prompts.findLast((prompt) => prompt.startsWith("Synthesize a Heavy workflow node"))).toContain(
        '"workflow": "council"',
      )
      const handoff = JSON.parse(WorkflowHandoff.heavy(output).split("\n", 1)[0] ?? "{}")
      expect(handoff.session_manifest).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ session_id: output.root_session_id, stage: "planning" }),
          expect.objectContaining({ session_id: output.nodes[0]?.session_id, stage: "report" }),
          expect.objectContaining({ session_id: output.council?.root_session_id, stage: "council-planning" }),
          expect.objectContaining({ session_id: output.council?.synthesis_session_id, stage: "synthesis" }),
        ]),
      )
    }),
  )

  it.effect("reports recoverable Heavy child failures while preserving partial results", () =>
    Effect.gen(function* () {
      const progress: Record<string, unknown>[] = []
      const runtime = makeRuntime((input) => {
        if (input.agent === "heavy-planner") return new Tool.Failure({ message: "planner unavailable" })
        return nodeResult
      }, progress)

      const output = yield* HeavyWorkflow.run(
        "Finish without the planner",
        parent,
        context,
        {
          maxDepth: 1,
          tasksPerNode: 2,
          maxNodes: 4,
          concurrency: 2,
          childTimeoutMs: 60_000,
          onFailure: "keep",
          models: {},
        },
        runtime,
      )

      expect(output.status).toBe("partial")
      expect(progress).toContainEqual(
        expect.objectContaining({
          workflow: "heavy",
          phase: "recovering",
          stage: "planning",
          error: "planner unavailable",
        }),
      )
    }),
  )

  it.effect("runs Council participants concurrently by round over stable issue IDs", () =>
    Effect.gen(function* () {
      const debatePrompts: string[] = []
      const models: Array<ModelV2.Ref | undefined> = []
      const progress: Record<string, unknown>[] = []
      const runtime = makeRuntime((input) => {
        models.push(input.model)
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
      }, progress)

      const output = yield* CouncilWorkflow.run(
        "Should we adopt this design?",
        parent,
        { ...context, agent: AgentV2.ID.make("council"), toolCallID: "call-council" },
        {
          perspectives: 2,
          concurrency: 2,
          childTimeoutMs: 60_000,
          debate: { mode: "auto", topics: 1, participants: 2, rounds: 2 },
          models: {},
        },
        runtime,
      )

      expect(output.perspectives.map((perspective) => perspective.perspective_id)).toEqual([
        "perspective-1",
        "perspective-2",
      ])
      expect(models.every((model) => model === parent.model)).toBe(true)
      expect(output.debate).toHaveLength(4)
      expect(output.debate.every((item) => item.issue_id === "issue-1")).toBe(true)
      expect(output.disagreements.every((item) => item.issue_id === "issue-1")).toBe(true)
      expect(output.debate.map((item) => item.round)).toEqual([1, 1, 2, 2])
      expect(output.perspectives.every((item) => item.session_id.startsWith("ses_"))).toBe(true)
      expect(output.debate.every((item) => item.session_id.startsWith("ses_"))).toBe(true)
      expect(debatePrompts.filter((prompt) => prompt.includes("round 2"))).toHaveLength(2)
      expect(debatePrompts.filter((prompt) => prompt.includes('"argument": "engaged argument"'))).toHaveLength(2)
      expect(progress.find((item) => item.phase === "perspectives")?.session_ids).toHaveLength(2)
      expect(
        progress.filter((item) => item.phase === "debating").every((item) => typeof item.session_id === "string"),
      ).toBe(true)
      expect(
        progress.some((item) => item.phase === "synthesizing" && String(item.session_id).includes(":synthesis")),
      ).toBe(true)
    }),
  )

  it.effect("continues Council synthesis with partial results after a perspective times out", () =>
    Effect.gen(function* () {
      const agents: string[] = []
      const progress: Record<string, unknown>[] = []
      const runtime = makeRuntime((input) => {
        agents.push(input.agent)
        if (input.agent === "council-planner")
          return {
            rationale: "compare independent views",
            issues: [{ id: "decision", question: "Proceed?" }],
            perspectives: [
              { id: "safety", title: "Safety", instructions: "Assess risk." },
              { id: "delivery", title: "Delivery", instructions: "Assess value." },
            ],
          }
        if (input.agent === "council-perspective" && input.id.endsWith("perspective-1"))
          return new Tool.Failure({ message: "Safety perspective timed out after 1000 ms" })
        if (input.agent === "council-perspective")
          return {
            perspective_id: "ignored",
            summary: "Proceed carefully",
            issues: [
              {
                id: "ignored",
                question: "Proceed?",
                stance: "conditional",
                rationale: "Value remains",
                evidence: [],
              },
            ],
            recommendations: [],
            risks: [],
          }
        return {
          status: "completed",
          summary: "Partial council synthesis",
          consensus: [],
          disagreements: [],
          recommendations: [],
          risks: ["One perspective timed out"],
        }
      }, progress)

      const output = yield* CouncilWorkflow.run(
        "Proceed?",
        parent,
        { ...context, agent: AgentV2.ID.make("council"), toolCallID: "call-council-timeout" },
        {
          perspectives: 2,
          concurrency: 2,
          childTimeoutMs: 1_000,
          debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
          models: {},
        },
        runtime,
      )

      expect(output.status).toBe("partial")
      expect(output.perspectives).toHaveLength(1)
      expect(agents).toContain("council-synthesizer")
      expect(progress).toContainEqual(
        expect.objectContaining({
          workflow: "council",
          phase: "failed",
          stage: "perspective",
          error: "Safety perspective timed out after 1000 ms",
        }),
      )
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
          childTimeoutMs: 60_000,
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

  it.effect("uses a stage override instead of the inherited parent model", () =>
    Effect.sync(() => {
      expect(WorkflowRuntime.resolveModel(parent.model, undefined)).toBe(parent.model)
      expect(WorkflowRuntime.resolveModel(parent.model, "anthropic/claude-sonnet-4-5")).toEqual({
        id: ModelV2.ID.make("claude-sonnet-4-5"),
        providerID: ProviderV2.ID.make("anthropic"),
      })
    }),
  )

  it.effect("interrupts and fails a child that exceeds its deadline", () =>
    Effect.gen(function* () {
      const interrupts = yield* Ref.make(0)
      const createdModel = yield* Ref.make<ModelV2.Ref | undefined>(undefined)
      const dependencies = Layer.mergeAll(
        Layer.mock(EventV2.Service, {}),
        Layer.mock(SessionV2.Service, {
          create: (input) =>
            Ref.set(createdModel, input.model).pipe(
              Effect.as(
                SessionV2.Info.make({
                  ...parent,
                  id: input.id ?? SessionV2.ID.make("ses_workflow_child"),
                  parentID: input.parentID,
                  title: input.title ?? "Workflow child",
                  agent: input.agent,
                  model: input.model,
                }),
              ),
            ),
          messages: () => Effect.succeed([]),
          prompt: (input) =>
            Effect.succeed(
              SessionInput.Admitted.make({
                admittedSeq: 0,
                id: input.id ?? SessionMessage.ID.make("msg_workflow_child"),
                sessionID: input.sessionID,
                prompt: { text: input.prompt.text },
                delivery: input.delivery ?? "steer",
                timeCreated: DateTime.makeUnsafe(0),
              }),
            ),
          resume: () => Effect.never,
          interrupt: () => Ref.update(interrupts, (count) => count + 1),
          revert: {
            stage: () => Effect.die("unused"),
            clear: () => Effect.die("unused"),
            commit: () => Effect.die("unused"),
          },
        }),
        Layer.mock(SessionTools.Service, {
          register: () => Effect.void,
          entries: () => new Map(),
        }),
      )
      const fiber = yield* WorkflowRuntime.Service.use((runtime) =>
        runtime.runChild({
          id: "timed-child",
          parentID: parent.id,
          location: parent.location,
          title: "Timed child",
          agent: AgentV2.ID.make("heavy-reader"),
          model: parent.model,
          timeoutMs: 1_000,
          prompt: "Investigate",
          result: Schema.Struct({ summary: Schema.String }),
        }),
      ).pipe(Effect.provide(WorkflowRuntime.layer.pipe(Layer.provide(dependencies))), Effect.flip, Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust(1_000)
      const failure = yield* Fiber.join(fiber)

      expect(failure).toBeInstanceOf(Tool.Failure)
      expect(failure.message).toBe("Timed child timed out after 1000 ms")
      expect(yield* Ref.get(interrupts)).toBe(1)
      expect(yield* Ref.get(createdModel)).toBe(parent.model)
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
      Effect.suspend(() => {
        const result = resolve(input)
        if (result instanceof Tool.Failure) return Effect.fail(result)
        return Effect.sync(() => Schema.decodeUnknownSync(input.result)(result))
      }),
    progress: (_context, structured) =>
      Effect.sync(() => {
        checkpoints.push(structured)
      }),
  }
}
