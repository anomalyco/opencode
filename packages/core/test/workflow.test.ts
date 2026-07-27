import { describe, expect } from "bun:test"
import { LLMError, LLMEvent, TransportReason } from "@opencode-ai/llm"
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
import { WorkflowExecution } from "@opencode-ai/core/workflow/execution"
import { WorkflowHandoff } from "@opencode-ai/core/workflow/handoff"
import { HeavyWorkflow } from "@opencode-ai/core/workflow/heavy"
import { ResearchWorkflow } from "@opencode-ai/core/workflow/research"
import { WorkflowReport } from "@opencode-ai/core/workflow/report"
import { WorkflowRuntime } from "@opencode-ai/core/workflow/runtime"
import { WorkflowSchema } from "@opencode-ai/core/workflow/schema"
import { StudioWorkflow } from "@opencode-ai/core/workflow/studio"
import { DateTime, Deferred, Effect, Fiber, Layer, Ref, Result, Schema } from "effect"
import { TestClock } from "effect/testing"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "./fixture/tmpdir"
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
  it.effect("runs a bounded Studio brief, concepts, critique, and direction", () =>
    Effect.gen(function* () {
      const agents: string[] = []
      const runtime = makeRuntime((input) => {
        agents.push(input.agent)
        if (input.agent === "studio-planner") {
          expect(input.report).toBe(false)
          return {
            rationale: "The brief needs complete but structurally different options.",
            objective: "Design a new public program",
            deliverables: ["A coherent premise", "A practical next step"],
            constraints: ["Keep the program accessible"],
            assumptions: ["The audience is mixed"],
            choice_points: ["How much participation to require"],
            concepts: [
              {
                title: "Civic ritual",
                mandate: "Organize the program around a shared recurring ritual.",
                differentiators: ["collective cadence"],
                exclusions: ["passive spectatorship"],
              },
              {
                title: "Open toolkit",
                mandate: "Organize the program as adaptable tools owned by participants.",
                differentiators: ["local authorship"],
                exclusions: ["one fixed sequence"],
              },
              {
                title: "Living exchange",
                mandate: "Organize the program around reciprocal exchanges that change over time.",
                differentiators: ["reciprocity"],
                exclusions: ["one-way delivery"],
              },
            ],
          }
        }
        if (input.agent === "studio-creator") {
          const conceptID = input.prompt.match(/"id": "(concept-[1-3])"/)?.[1] ?? "concept"
          return {
            status: "completed",
            concept_id: conceptID,
            title: conceptID,
            pitch: `A complete pitch for ${conceptID}`,
            deliverables: [
              { deliverable: "A coherent premise", content: `Premise for ${conceptID}` },
              { deliverable: "A practical next step", content: `Next step for ${conceptID}` },
            ],
            differentiators: [`Distinctive logic for ${conceptID}`],
            tradeoffs: [`Tradeoff for ${conceptID}`],
            risks: [],
            open_choices: [],
          }
        }
        if (input.agent === "studio-critic") {
          expect(input.reportReadMode).toBe("artifacts")
          return {
            status: "completed",
            summary: "All three routes satisfy the brief through different operating logics.",
            assessments: [1, 2, 3].map((index) => ({
              concept_id: `concept-${index}`,
              disposition: index === 2 ? "advance" : "hold",
              strengths: [`Strength ${index}`],
              weaknesses: [],
              missing_deliverables: [],
              overlaps: [],
              distinctive_elements: [`Distinctive element ${index}`],
            })),
            cross_concept_patterns: [],
            missing_requirements: [],
            recommendations: ["Preserve all three routes through direction."],
          }
        }
        if (input.agent === "studio-director") {
          expect(input.reportMode).toBe("document")
          expect(input.prompt).not.toContain("fantasy")
          return {
            status: "completed",
            summary: "The open toolkit is the strongest default, with two viable alternatives.",
            recommended_concept_ids: ["concept-2"],
            preserved_concept_ids: ["concept-1", "concept-2", "concept-3"],
            deliverable_coverage: [
              {
                deliverable: "A coherent premise",
                status: "complete",
                report_section: "Three complete concepts",
                concept_ids: ["concept-1", "concept-2", "concept-3"],
                limitations: [],
              },
              {
                deliverable: "A practical next step",
                status: "complete",
                report_section: "How to proceed",
                concept_ids: ["concept-1", "concept-2", "concept-3"],
                limitations: [],
              },
            ],
            decisions: ["Use the open toolkit as the default route."],
            tradeoffs: ["Local authorship requires facilitation."],
            next_choices: ["Choose the initial participant cohort."],
          }
        }
        return new Tool.Failure({ message: `Unexpected Studio agent: ${input.agent}` })
      })

      const output = yield* StudioWorkflow.run(
        "Design a new public program",
        parent,
        context,
        {
          concepts: 3,
          concurrency: 3,
          childTimeoutMs: 60_000,
          minimumReportWords: 1_200,
          models: {},
        },
        runtime,
      )

      expect(output.status).toBe("completed")
      expect(output.plan.deliverables).toEqual(["A coherent premise", "A practical next step"])
      expect(output.concepts.map((concept) => concept.concept_id)).toEqual(["concept-1", "concept-2", "concept-3"])
      expect(output.critique.assessments).toHaveLength(3)
      expect(output.synthesis.recommended_concept_ids).toEqual(["concept-2"])
      expect(output.synthesis.preserved_concept_ids).toEqual(["concept-1", "concept-2", "concept-3"])
      expect(output.evaluation).toMatchObject({
        concepts_planned: 3,
        concepts_completed: 3,
        concepts_preserved: 3,
        concepts_distinct: 3,
        deliverables_complete: 2,
      })
      expect(agents).toEqual([
        "studio-planner",
        "studio-creator",
        "studio-creator",
        "studio-creator",
        "studio-critic",
        "studio-director",
      ])
      expect(agents.some((agent) => agent.startsWith("council-") || agent.startsWith("research-"))).toBe(false)
    }),
  )

  it.effect("preserves all completed Studio concepts when final direction drops one", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime((input) => {
        if (input.agent === "studio-planner")
          return {
            objective: "Create alternatives",
            deliverables: ["Complete proposal"],
            concepts: ["Route one", "Route two", "Route three"],
          }
        if (input.agent === "studio-creator") {
          const conceptID = input.prompt.match(/"id": "(concept-[1-3])"/)?.[1] ?? "concept"
          return {
            status: "completed",
            concept_id: conceptID,
            title: conceptID,
            pitch: conceptID,
            deliverables: [{ deliverable: "Complete proposal", content: conceptID }],
          }
        }
        if (input.agent === "studio-critic")
          return {
            status: "completed",
            summary: "The routes remain distinct.",
            assessments: [1, 2, 3].map((index) => ({
              concept_id: `concept-${index}`,
              disposition: "hold",
              distinctive_elements: [`Difference ${index}`],
            })),
          }
        if (input.agent === "studio-director")
          return {
            status: "completed",
            summary: "An incomplete direction",
            recommended_concept_ids: ["concept-1"],
            preserved_concept_ids: ["concept-1", "concept-2"],
            deliverable_coverage: [
              {
                deliverable: "Complete proposal",
                status: "complete",
                concept_ids: ["concept-1", "concept-2"],
              },
            ],
          }
        return new Tool.Failure({ message: `Unexpected Studio agent: ${input.agent}` })
      })

      const output = yield* StudioWorkflow.run(
        "Create alternatives",
        parent,
        context,
        {
          concepts: 3,
          concurrency: 3,
          childTimeoutMs: 60_000,
          minimumReportWords: 1_200,
          models: {},
        },
        runtime,
      )

      expect(output.status).toBe("partial")
      expect(output.synthesis.preserved_concept_ids).toEqual(["concept-1", "concept-2", "concept-3"])
      expect(output.summary).toContain("Final direction failed")
    }),
  )

  it.live("preserves the director-authored Studio document and keeps audit paths in the trace", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((tmp) =>
        Effect.gen(function* () {
          const reportPath = path.join(tmp.path, "STUDIO_REPORT.md")
          const conceptPath = path.join(tmp.path, "stages", "concept.md")
          const document =
            "# A Native Creative Document\n\n## First route\n\nConcrete user-facing material.\n\n## Direction\n\nKeep both viable choices visible."
          const output = WorkflowSchema.StudioOutput.make({
            workflow: "studio",
            status: "completed",
            summary: "Keep both viable choices visible.",
            final_response: document,
            root_session_id: SessionV2.ID.make("ses_studio_plan"),
            critique_session_id: SessionV2.ID.make("ses_studio_critique"),
            synthesis_session_id: SessionV2.ID.make("ses_studio_director"),
            synthesis_report_path: reportPath,
            report_path: reportPath,
            plan: {
              rationale: "Develop alternatives.",
              objective: "Create a direction",
              deliverables: ["Complete direction"],
              constraints: [],
              assumptions: [],
              choice_points: [],
              concepts: [
                {
                  id: "concept-1",
                  title: "First route",
                  mandate: "Develop the first route.",
                  differentiators: ["Distinct structure"],
                  exclusions: [],
                },
              ],
            },
            concepts: [
              {
                status: "completed",
                concept_id: "concept-1",
                title: "First route",
                pitch: "A concrete route.",
                deliverables: [{ deliverable: "Complete direction", content: "Concrete user-facing material." }],
                differentiators: ["Distinct structure"],
                tradeoffs: [],
                risks: [],
                open_choices: [],
                session_id: SessionV2.ID.make("ses_studio_concept"),
                report_path: conceptPath,
              },
            ],
            critique: {
              status: "completed",
              summary: "The route is coherent.",
              assessments: [
                {
                  concept_id: "concept-1",
                  disposition: "advance",
                  strengths: ["Coherent"],
                  weaknesses: [],
                  missing_deliverables: [],
                  overlaps: [],
                  distinctive_elements: ["Distinct structure"],
                },
              ],
              cross_concept_patterns: [],
              missing_requirements: [],
              recommendations: [],
              session_id: SessionV2.ID.make("ses_studio_critique"),
            },
            synthesis: {
              status: "completed",
              summary: "Keep both viable choices visible.",
              recommended_concept_ids: ["concept-1"],
              preserved_concept_ids: ["concept-1"],
              deliverable_coverage: [
                {
                  deliverable: "Complete direction",
                  status: "complete",
                  report_section: "Direction",
                  concept_ids: ["concept-1"],
                  limitations: [],
                },
              ],
              decisions: [],
              tradeoffs: [],
              next_choices: [],
              coverage: [],
            },
            evaluation: {
              report_words: 16,
              report_sections: 3,
              standalone_pass: true,
              concepts_planned: 1,
              concepts_completed: 1,
              concepts_preserved: 1,
              concepts_distinct: 1,
              deliverables_total: 1,
              deliverables_complete: 1,
              deliverables_partial: 0,
              deliverables_missing: 0,
              coverage_complete: true,
            },
          })

          yield* Effect.promise(() => Bun.write(reportPath, document))
          yield* Effect.promise(() => WorkflowReport.writeStudio("Create a direction", output, reportPath))

          expect(yield* Effect.promise(() => Bun.file(reportPath).text())).toBe(document)
          const trace = yield* Effect.promise(() => Bun.file(WorkflowReport.studioTracePath(reportPath)).text())
          expect(trace).toContain("# Studio Trace")
          expect(trace).toContain(conceptPath)
          const handoff = JSON.parse(WorkflowHandoff.studio(output))
          expect(JSON.stringify(handoff.concepts)).not.toContain(conceptPath)
        }),
      ),
    ),
  )

  it.effect("allows Studio only one narrow Research delegation", () =>
    Effect.gen(function* () {
      const execution = yield* WorkflowExecution.make({
        workflow: "studio",
        access: "read",
        objective: "Develop several concepts",
        sessionID: parent.id,
        toolCallID: "call-studio",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        delegates: {
          studio: new Set(["research"]),
        },
      })
      yield* WorkflowExecution.delegate(execution, {
        workflow: "research",
        objective: "Verify one legal constraint",
        sessionID: SessionV2.ID.make("ses_studio_critic"),
        toolCallID: "call-studio-research-1",
      })
      const repeated = yield* Effect.result(
        WorkflowExecution.delegate(execution, {
          workflow: "research",
          objective: "Verify one scientific constraint",
          sessionID: SessionV2.ID.make("ses_studio_critic"),
          toolCallID: "call-studio-research-2",
        }),
      )

      expect(Result.isFailure(repeated)).toBe(true)
      if (Result.isFailure(repeated))
        expect(repeated.failure.message).toBe("Studio may delegate at most one narrow uncertainty to Research")
    }),
  )

  it.effect("normalizes Research contracts and evidence ledgers", () =>
    Effect.sync(() => {
      expect(
        Schema.decodeUnknownSync(WorkflowSchema.ResearchContractSubmission)({
          objective: "Compare the options",
          deliverables: "A defensible recommendation",
          assumptions: "Current pricing applies",
          unknowns: ["Actual demand"],
          falsifiers: "A measured regression",
          flat_rationale: "Partition demand evidence before synthesis.",
          tasks: [
            {
              title: "Verify demand",
              objective: "Find current demand evidence",
              priority: "critical",
              mode: "deep",
              depends_on: "baseline",
              subquestions: ["Measure demand", "Test regional variation"],
              evidence_methods: ["Primary survey", "Independent comparison"],
              exclusions: ["Final recommendation"],
              decision_relevance: "Demand can reverse the recommendation.",
            },
          ],
        }),
      ).toMatchObject({
        objective: "Compare the options",
        rationale: "Partition demand evidence before synthesis.",
        deliverables: ["A defensible recommendation"],
        assumptions: ["Current pricing applies"],
        tasks: [
          {
            id: "question-1",
            question: "Find current demand evidence",
            priority: "critical",
            role: "recursive",
            mode: "recurse",
            depends_on: ["baseline"],
            subquestions: ["Measure demand", "Test regional variation"],
            evidence_methods: ["Primary survey", "Independent comparison"],
            exclusions: ["Final recommendation"],
            decision_relevance: "Demand can reverse the recommendation.",
          },
        ],
      })
      expect(
        Schema.decodeUnknownSync(WorkflowSchema.ResearchBranchSubmission)({
          status: "complete",
          summary: "Evidence collected",
          claims: {
            claim: "Demand increased",
            kind: "fact",
            status: "supported",
            confidence: "high",
            evidence_ids: "survey",
          },
          evidence: {
            id: "survey",
            summary: "A current primary survey",
            claim_ids: "claim-1",
            stance: "support",
            source_type: "primary",
            verification: "verified",
            url: "https://example.com/survey",
          },
          gaps: { question: "Regional variation", priority: "material", reason: "No regional split" },
          disputes: {
            question: "Whether the increase persists",
            consequential: true,
            priority: "material",
          },
        }),
      ).toMatchObject({
        status: "completed",
        claims: [{ id: "claim-1", kind: "fact", status: "supported", evidence_ids: ["survey"] }],
        evidence: [{ id: "survey", claim_ids: ["claim-1"], verification: "verified" }],
        gaps: [{ id: "gap-1", status: "open" }],
        disputes: [{ id: "dispute-1", consequential: true, status: "open" }],
      })
      expect(() =>
        Schema.decodeUnknownSync(WorkflowSchema.ResearchContractSubmission)({
          tasks: [{ title: "Ambiguous branch", question: "Investigate", mode: "research" }],
        }),
      ).toThrow('got "research"')
      expect(() =>
        Schema.decodeUnknownSync(WorkflowSchema.ResearchAssessmentSubmission)({
          decision: "continue_one_targeted_wave",
          rationale: "One more wave is warranted.",
          information_gain: "high",
          coverage: "incomplete",
          deliverable_coverage: [],
        }),
      ).toThrow('got "continue_one_targeted_wave"')
    }),
  )

  it.effect("runs adaptive Research waves and stops on diminishing information gain", () =>
    Effect.gen(function* () {
      let assessments = 0
      let evidenceTasks = 0
      let syntheses = 0
      let baselineID = ""
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner") {
          expect(input.report).toBe(false)
          return {
            rationale: "Establish the baseline before testing the decisive caveat.",
            objective: "Assess a policy",
            deliverables: ["A standalone recommendation"],
            assumptions: ["The published baseline is representative"],
            unknowns: ["Whether the result transfers"],
            falsifiers: ["Independent evidence reverses the baseline"],
            tasks: [
              {
                id: "baseline",
                title: "Establish baseline",
                question: "What does the strongest current baseline show?",
                priority: "critical",
                mode: "leaf",
                depends_on: [],
                rationale: "The conclusion needs an empirical anchor.",
                expected_evidence: ["Primary evidence"],
              },
            ],
          }
        }
        if (input.agent === "research-reader" || input.agent === "research-critic") {
          evidenceTasks++
          if (evidenceTasks === 2) {
            expect(String(input.agent)).toBe("research-critic")
            expect(baselineID).not.toBe("")
            expect(input.prompt).toContain("Establish baseline")
            expect(input.prompt).toContain("research-artifact-")
            expect(input.prompt).toContain("artifact-bound critique")
          }
          return {
            status: "completed",
            summary: `Evidence wave ${evidenceTasks}`,
            claims: [
              {
                id: `claim-${evidenceTasks}`,
                statement: evidenceTasks === 1 ? "The baseline supports the policy" : "The caveat does not reverse it",
                kind: "fact",
                status: "supported",
                confidence: "high",
                evidence_ids: [`evidence-${evidenceTasks}`],
                contradicts: [],
                assumptions: [],
              },
            ],
            evidence: [
              {
                id: `evidence-${evidenceTasks}`,
                summary: "Inspected primary evidence",
                claim_ids: [`claim-${evidenceTasks}`],
                stance: "support",
                source_type: "primary",
                verification: "verified",
                url: `https://example.com/source-${evidenceTasks}`,
              },
            ],
            gaps: [],
            disputes: [],
            assumptions: [],
            conclusions: [],
            recommendations: [],
            limitations: [],
          }
        }
        if (input.agent === "research-assessor") {
          expect(input.report).toBe(false)
          expect(input.reportReadMode).toBe("artifacts")
          assessments++
          if (assessments === 1) {
            baselineID = input.prompt.match(/"id": "(research-[^"]+\.w1\.1)"/)?.[1] ?? ""
            return {
              decision: "continue",
              rationale: "One transferability caveat could still reverse the decision.",
              information_gain: "high",
              coverage: "incomplete",
              addressed_gap_ids: [],
              tasks: [
                {
                  id: "transfer",
                  title: "Test transferability",
                  question: "Does independent evidence invalidate transferability?",
                  priority: "critical",
                  role: "critic",
                  mode: "leaf",
                  depends_on: [baselineID],
                  rationale: "This is the only remaining decision-changing uncertainty.",
                  expected_evidence: ["Independent challenge evidence"],
                },
              ],
              disputes: [],
              deliverable_coverage: coveredDeliverables(input),
            }
          }
          return {
            decision: "continue",
            rationale: "Remaining questions are unlikely to change the answer.",
            information_gain: "low",
            coverage: "adequate",
            addressed_gap_ids: [],
            tasks: [
              {
                id: "low-value",
                title: "Repeat baseline",
                question: "What does the strongest current baseline show?",
                priority: "background",
                mode: "leaf",
                depends_on: [],
                rationale: "Duplicate work",
                expected_evidence: [],
              },
            ],
            disputes: [],
            deliverable_coverage: coveredDeliverables(input),
          }
        }
        syntheses++
        expect(input.reportContentFirst).toBe(true)
        expect(input.reportMode).toBe("document")
        expect(input.reportReadMode).toBe("artifacts")
        return {
          status: "completed",
          summary: "The integrated evidence supports the policy with a bounded caveat.",
          claims: [
            {
              id: "baseline",
              statement: "The baseline supports the policy",
              kind: "fact",
              status: "supported",
              confidence: "high",
              evidence_ids: ["baseline-evidence"],
              contradicts: [],
              assumptions: [],
            },
            {
              id: "caveat",
              statement: "The caveat does not reverse it",
              kind: "inference",
              status: "supported",
              confidence: "medium",
              evidence_ids: ["caveat-evidence"],
              contradicts: [],
              assumptions: [],
            },
          ],
          evidence: [
            {
              id: "baseline-evidence",
              summary: "Canonical baseline support",
              claim_ids: ["baseline"],
              stance: "support",
              source_type: "primary",
              verification: "verified",
              url: "https://example.com/source-1",
            },
            {
              id: "caveat-evidence",
              summary: "Canonical caveat support",
              claim_ids: ["caveat"],
              stance: "support",
              source_type: "primary",
              verification: "verified",
              url: "https://example.com/source-2",
            },
          ],
          gaps: [],
          disputes: [],
          assumptions: [],
          conclusions: ["Adopt the policy conditionally"],
          recommendations: ["Measure the caveat in deployment"],
          limitations: ["One population remains unmeasured"],
          deliverable_coverage: [
            {
              deliverable: "A standalone recommendation",
              status: "complete",
              report_section: "Recommendation",
              claim_ids: ["baseline", "caveat"],
              limitations: ["One population remains unmeasured"],
            },
          ],
        }
      })

      const output = yield* ResearchWorkflow.run(
        "Assess whether the policy should be adopted",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        researchSettings(),
        runtime,
      )

      expect(output.status).toBe("completed")
      expect(output.nodes).toHaveLength(1)
      expect(output.nodes[0]?.waves).toHaveLength(2)
      expect(output.nodes[0]?.waves[1]?.stop_reason).toContain("low information gain")
      expect(output.nodes[0]?.waves[1]?.stop_code).toBe("low_information_gain")
      expect(output.nodes[0]?.waves[1]?.tasks[0]?.depends_on).toEqual([baselineID])
      expect(evidenceTasks).toBe(2)
      expect(assessments).toBe(2)
      expect(syntheses).toBe(1)
      expect(output.graph.claims.map((claim) => claim.statement)).toEqual(
        expect.arrayContaining(["The baseline supports the policy", "The caveat does not reverse it"]),
      )
      expect(output.evaluation).toMatchObject({
        standalone_pass: true,
        evidence_tasks: 2,
        evidence_leaves: 1,
        critic_tasks: 1,
        dependent_tasks: 1,
        supported_claims: 2,
        traceable_supported_claims: 2,
      })
    }),
  )

  it.effect("forces a targeted wave before synthesis when an assessor leaves a deliverable uncovered", () =>
    Effect.gen(function* () {
      let assessments = 0
      const deliverable = 'title: Security review — contents: ["Threats","Mitigations"]'
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner")
          return {
            rationale: "Establish the baseline, then audit contract coverage.",
            objective: "Assess the system",
            deliverables: [deliverable],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: [
              {
                id: "baseline",
                title: "Baseline",
                question: "What is the baseline architecture?",
                priority: "material",
                role: "evidence",
                depends_on: [],
                rationale: "The answer needs context.",
                expected_evidence: [],
              },
            ],
          }
        if (input.agent === "research-reader") return researchBranch("Bounded evidence")
        if (input.agent === "research-assessor") {
          assessments++
          return {
            decision: "stop",
            stop_reason: "evidence_saturated",
            rationale: assessments === 1 ? "The baseline is covered." : "The security analysis is now covered.",
            information_gain: "low",
            coverage: assessments === 1 ? "incomplete" : "complete",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [],
            deliverable_coverage: [
              {
                deliverable,
                status: assessments === 1 ? "missing" : "covered",
                reason: assessments === 1 ? "No security evidence was collected." : "The targeted wave closed the gap.",
              },
            ],
          }
        }
        return {
          ...researchBranch("Standalone synthesis"),
          deliverable_coverage: [
            {
              deliverable,
              status: "complete",
              report_section: "Security",
              claim_ids: ["security"],
              limitations: [],
            },
          ],
        }
      })

      const output = yield* ResearchWorkflow.run(
        "Assess the system",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        { ...researchSettings(), minDepth: 1 },
        runtime,
      )

      expect(output.nodes[0]?.waves).toHaveLength(2)
      expect(output.nodes[0]?.waves[0]?.assessment.decision).toBe("continue")
      expect(output.nodes[0]?.waves[0]?.assessment.rationale).toContain("engine overrode")
      expect(output.nodes[0]?.waves[1]?.tasks[0]?.title).toBe("Complete contract deliverable: Security review")
    }),
  )

  it.effect("promotes source-discovering critic work to an evidence-capable agent", () =>
    Effect.gen(function* () {
      const agents: string[] = []
      const runtime = makeRuntime((input) => {
        agents.push(input.agent)
        if (input.agent === "research-planner")
          return {
            rationale: "Collect the baseline before checking current prices.",
            objective: "Compare providers",
            deliverables: [],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: [
              {
                id: "baseline",
                title: "Baseline",
                question: "What capabilities are required?",
                priority: "critical",
                role: "evidence",
                depends_on: [],
                rationale: "Establish requirements.",
                expected_evidence: [],
              },
              {
                id: "pricing",
                title: "Verify latest provider pricing",
                question: "Use web search to verify current provider pricing.",
                priority: "critical",
                role: "critic",
                depends_on: ["baseline"],
                rationale: "Fresh pricing may reverse the choice.",
                expected_evidence: ["Current provider price sheets"],
              },
            ],
          }
        if (input.agent === "research-reader") return researchBranch("Evidence")
        if (input.agent === "research-assessor")
          return {
            decision: "stop",
            stop_reason: "evidence_saturated",
            rationale: "The comparison is covered.",
            information_gain: "low",
            coverage: "complete",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [],
            deliverable_coverage: [],
          }
        return researchBranch("Synthesis")
      })

      const output = yield* ResearchWorkflow.run(
        "Compare providers",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        { ...researchSettings(), minDepth: 1 },
        runtime,
      )

      expect(output.nodes[0]?.waves[0]?.tasks.map((task) => task.role)).toEqual(["evidence", "evidence"])
      expect(output.nodes[0]?.waves[0]?.tasks[1]?.decomposition_reason).toContain("fresh source discovery")
      expect(agents).not.toContain("research-critic")
    }),
  )

  it.effect("uses hierarchical branch synthesis instead of flattening recursive Research", () =>
    Effect.gen(function* () {
      let contracts = 0
      const synthesisPrompts: string[] = []
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner") {
          contracts++
          return {
            rationale: "Decompose only the broad branch.",
            objective: contracts === 1 ? "Root" : "Branch",
            deliverables: ["Evidence"],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: [
              {
                id: contracts === 1 ? "branch" : "leaf",
                title: contracts === 1 ? "Broad branch" : "Evidence leaf",
                question:
                  contracts === 1 ? "Investigate the bounded broad branch" : "Collect the decisive branch evidence",
                priority: "critical",
                mode: contracts === 1 ? "recurse" : "leaf",
                depends_on: [],
                rationale: "Own one bounded contribution.",
                expected_evidence: [],
              },
            ],
          }
        }
        if (input.agent === "research-reader")
          return {
            ...researchBranch("Leaf evidence establishes the decisive fact."),
            claims: [
              {
                id: "leaf-claim",
                statement: "The decisive fact is supported",
                kind: "fact",
                status: "supported",
                confidence: "high",
                evidence_ids: [],
                contradicts: [],
                assumptions: [],
              },
            ],
          }
        if (input.agent === "research-assessor")
          return {
            decision: "stop",
            rationale: "The branch is adequately covered.",
            information_gain: "low",
            coverage: "adequate",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [],
            deliverable_coverage: coveredDeliverables(input),
          }
        synthesisPrompts.push(input.prompt)
        return researchBranch(synthesisPrompts.length === 1 ? "Bounded branch synthesis" : "Standalone root synthesis")
      })

      const output = yield* ResearchWorkflow.run(
        "Answer a broad cross-domain question",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        { ...researchSettings(), maxDepth: 3 },
        runtime,
      )

      expect(output.nodes).toHaveLength(2)
      expect(output.nodes.map((node) => node.depth)).toEqual([0, 1])
      expect(synthesisPrompts).toHaveLength(2)
      expect(synthesisPrompts[1]).toContain("Bounded branch synthesis")
      expect(synthesisPrompts[1]).toContain("sole author of the final standalone report")
      expect(output.raw_graph?.claims.some((claim) => claim.statement === "The decisive fact is supported")).toBe(true)
    }),
  )

  it.effect("reserves fair evidence budgets before launching recursive Research branches", () =>
    Effect.gen(function* () {
      let planners = 0
      let readers = 0
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner") {
          planners++
          if (planners === 1)
            return {
              rationale: "Partition the root into four domains.",
              objective: "Root",
              deliverables: [],
              assumptions: [],
              unknowns: [],
              falsifiers: [],
              tasks: ["Client", "Server", "Network", "Storage"].map((title, index) => ({
                id: `domain-${index}`,
                title,
                question: `Investigate the ${title.toLowerCase()} domain`,
                priority: "critical",
                role: "recursive",
                depends_on: [],
                rationale: "The domain needs local evidence.",
                expected_evidence: [],
              })),
            }
          const domain = input.prompt.match(/Current branch:\n([^\n]+)/)?.[1] ?? "domain"
          return {
            rationale: "The first wave establishes direct evidence before any deeper recursion.",
            objective: "Domain",
            deliverables: [],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: [
              ["benchmark", `What performance ceiling does the ${domain} implementation benchmark establish?`],
              ["capacity", `Which ${domain} workload variables determine sustainable capacity?`],
              ["failure", `What ${domain} failure modes invalidate the operating envelope?`],
              ["recovery", `Which ${domain} recovery evidence supports the lifecycle design?`],
            ].map(([id, question]) => ({
              id: `premature-${id}`,
              title: `Question ${id}`,
              question,
              priority: "critical",
              role: "recursive",
              depends_on: [],
              rationale: "Collect bounded evidence.",
              expected_evidence: [],
            })),
          }
        }
        if (input.agent === "research-reader") {
          readers++
          return researchBranch(`Evidence ${readers}`)
        }
        if (input.agent === "research-assessor")
          return {
            decision: "stop",
            stop_reason: "evidence_saturated",
            rationale: "Use the evidence available within the assigned subtree budget.",
            information_gain: "low",
            coverage: "adequate",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [],
            deliverable_coverage: coveredDeliverables(input),
          }
        return researchBranch("Bounded synthesis")
      })

      const output = yield* ResearchWorkflow.run(
        "Investigate four broad domains",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        {
          ...researchSettings(),
          maxDepth: 3,
          maxNodes: 13,
          minEvidencePerBranch: 2,
        },
        runtime,
      )

      const branches = output.nodes.filter((node) => node.depth === 1)
      expect(branches).toHaveLength(4)
      expect(branches.map((node) => node.budget_allocated)).toEqual([2, 2, 2, 2])
      expect(branches.map((node) => node.budget_unused)).toEqual([0, 0, 0, 0])
      expect(branches.every((node) => node.waves[0]?.tasks.length === 2)).toBe(true)
      expect(branches.flatMap((node) => node.waves[0]?.tasks ?? []).every((task) => task.role === "evidence")).toBe(
        true,
      )
      expect(output.nodes[0]?.waves[0]?.tasks.map((task) => task.reserved_subtree_slots)).toEqual([2, 2, 2, 2])
      expect(readers).toBe(8)
      expect(output.evaluation).toMatchObject({
        evidence_tasks: 12,
        evidence_leaves: 8,
        recursive_branches: 4,
        productive_recursive_branches: 4,
        synthesis_only_branches: 0,
        root_budget_slots: 12,
        root_unused_slots: 0,
      })
    }),
  )

  it.effect("preserves surplus root budget for evidence-directed follow-up", () =>
    Effect.gen(function* () {
      let planners = 0
      let readers = 0
      let rootAssessments = 0
      const remaining: number[] = []
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner") {
          planners++
          if (planners === 1)
            return {
              rationale: "Partition the root while preserving room to reconcile the domains.",
              objective: "Root",
              deliverables: [],
              assumptions: [],
              unknowns: [],
              falsifiers: [],
              tasks: ["Client", "Server", "Network", "Storage"].map((title, index) => ({
                id: `domain-${index}`,
                title,
                question: `Investigate the ${title.toLowerCase()} domain`,
                priority: "critical",
                role: "recursive",
                depends_on: [],
                rationale: "The domain needs local evidence.",
                expected_evidence: [],
              })),
            }
          const domain = input.prompt.match(/Current branch:\n([^\n]+)/)?.[1] ?? "domain"
          return {
            rationale: "Use the minimum productive branch budget.",
            objective: "Domain",
            deliverables: [],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: ["baseline", "limit"].map((id) => ({
              id,
              title: `Question ${id}`,
              question: `What ${id} evidence governs ${domain}?`,
              priority: "critical",
              role: "evidence",
              depends_on: [],
              rationale: "Collect bounded evidence.",
              expected_evidence: [],
            })),
          }
        }
        if (input.agent === "research-reader") {
          readers++
          return researchBranch(`Evidence ${readers}`)
        }
        if (input.agent === "research-assessor") {
          if (input.prompt.includes("Current branch:\nInvestigate the"))
            return {
              decision: "stop",
              stop_reason: "evidence_saturated",
              rationale: "The bounded branch is covered.",
              information_gain: "low",
              coverage: "adequate",
              addressed_gap_ids: [],
              tasks: [],
              disputes: [],
              deliverable_coverage: coveredDeliverables(input),
            }
          rootAssessments++
          remaining.push(Number(input.prompt.match(/Remaining task slots after this wave: (\d+)/)?.[1] ?? -1))
          if (rootAssessments === 1)
            return {
              decision: "continue",
              rationale: "One cross-domain check can still change the synthesis.",
              information_gain: "high",
              coverage: "incomplete",
              addressed_gap_ids: [],
              tasks: [
                {
                  id: "cross-domain",
                  title: "Cross-domain capacity check",
                  question: "Do the domain constraints produce a new shared bottleneck?",
                  priority: "critical",
                  role: "evidence",
                  depends_on: [],
                  rationale: "Reconcile the completed domains before synthesis.",
                  expected_evidence: [],
                },
              ],
              disputes: [],
              deliverable_coverage: coveredDeliverables(input),
            }
          return {
            decision: "stop",
            stop_reason: "evidence_saturated",
            rationale: "The cross-domain check closes the remaining question.",
            information_gain: "low",
            coverage: "adequate",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [],
            deliverable_coverage: coveredDeliverables(input),
          }
        }
        return researchBranch("Bounded synthesis")
      })

      const output = yield* ResearchWorkflow.run(
        "Investigate four domains and reconcile their constraints",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        {
          ...researchSettings(),
          maxDepth: 3,
          maxNodes: 16,
          minEvidencePerBranch: 2,
        },
        runtime,
      )

      expect(output.nodes.filter((node) => node.depth === 1).map((node) => node.budget_allocated)).toEqual([2, 2, 2, 2])
      expect(output.nodes[0]?.waves).toHaveLength(2)
      expect(output.nodes[0]?.waves[1]?.tasks).toHaveLength(1)
      expect(remaining).toEqual([3, 2])
      expect(readers).toBe(9)
      expect(output.evaluation).toMatchObject({
        evidence_tasks: 13,
        evidence_leaves: 9,
        root_budget_slots: 15,
        root_unused_slots: 2,
      })
    }),
  )

  it.effect("allows assessors to earn deeper recursion only after direct branch evidence", () =>
    Effect.gen(function* () {
      let planners = 0
      let childAssessments = 0
      let readers = 0
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner") {
          planners++
          if (planners === 1)
            return {
              rationale: "Create one bounded domain branch.",
              objective: "Root",
              deliverables: [],
              assumptions: [],
              unknowns: [],
              falsifiers: [],
              tasks: [
                {
                  id: "domain",
                  title: "Domain",
                  question: "Investigate the domain",
                  priority: "critical",
                  role: "recursive",
                  depends_on: [],
                  rationale: "The domain requires local planning.",
                  expected_evidence: [],
                },
              ],
            }
          if (planners === 2)
            return {
              rationale: "Start by establishing the branch baseline.",
              objective: "Domain",
              deliverables: [],
              assumptions: [],
              unknowns: [],
              falsifiers: [],
              tasks: [
                {
                  id: "premature",
                  title: "Premature decomposition",
                  question: "Establish the direct branch baseline",
                  priority: "critical",
                  role: "recursive",
                  depends_on: [],
                  rationale: "The planner initially considered another decomposition.",
                  expected_evidence: [],
                },
              ],
            }
          return {
            rationale: "Investigate the compound gap discovered by assessment.",
            objective: "Compound gap",
            deliverables: [],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: [
              {
                id: "deep-evidence",
                title: "Deep evidence",
                question: "What resolves the discovered compound gap?",
                priority: "critical",
                role: "evidence",
                depends_on: [],
                rationale: "Resolve the newly evidenced gap.",
                expected_evidence: [],
              },
            ],
          }
        }
        if (input.agent === "research-reader") {
          readers++
          return researchBranch(`Evidence ${readers}`)
        }
        if (input.agent === "research-assessor") {
          if (input.prompt.includes("Current branch:\nInvestigate the domain")) {
            childAssessments++
            if (childAssessments === 1) {
              const baselineID = input.prompt.match(/"id": "(research-[^"]+\.w1\.1)"/)?.[1] ?? ""
              return {
                decision: "continue",
                rationale: "The first evidence wave exposed one genuinely compound gap.",
                information_gain: "high",
                coverage: "incomplete",
                addressed_gap_ids: [],
                tasks: [
                  {
                    id: "deeper",
                    title: "Discovered compound gap",
                    question: "Resolve the discovered compound gap",
                    priority: "critical",
                    role: "recursive",
                    depends_on: [baselineID],
                    rationale: "This decomposition is justified by evidence from the completed wave.",
                    expected_evidence: [],
                  },
                ],
                disputes: [],
                deliverable_coverage: coveredDeliverables(input),
              }
            }
          }
          return {
            decision: "stop",
            stop_reason: "evidence_saturated",
            rationale: "The remaining evidence is sufficient.",
            information_gain: "low",
            coverage: "adequate",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [],
            deliverable_coverage: coveredDeliverables(input),
          }
        }
        return researchBranch("Bounded synthesis")
      })

      const output = yield* ResearchWorkflow.run(
        "Investigate an adaptively deepened domain",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        { ...researchSettings(), maxDepth: 3 },
        runtime,
      )

      expect(output.nodes.map((node) => node.depth)).toEqual([0, 1, 2])
      expect(output.nodes[1]?.waves[0]?.tasks[0]?.role).toBe("evidence")
      expect(output.nodes[1]?.waves[0]?.tasks[0]?.decomposition_reason).toContain(
        "another recursive level must be earned",
      )
      expect(output.nodes[1]?.waves[1]?.tasks[0]?.role).toBe("recursive")
      expect(output.nodes[2]?.waves[0]?.tasks[0]?.role).toBe("evidence")
      expect(readers).toBe(2)
      expect(output.evaluation).toMatchObject({
        recursive_branches: 2,
        productive_recursive_branches: 2,
        synthesis_only_branches: 0,
        evidence_leaves: 2,
        max_branch_depth: 2,
        max_evidence_depth: 3,
      })
    }),
  )

  it.effect("does not confuse multiple evidence methods with independently recursive work", () =>
    Effect.gen(function* () {
      let planners = 0
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner") {
          planners++
          if (planners > 1)
            return {
              rationale: "The promoted branch has one atomic evidence question.",
              objective: "Resolve the promoted branch",
              deliverables: [],
              assumptions: [],
              unknowns: [],
              falsifiers: [],
              flat_rationale: "This nested branch is already one coherent atomic source question.",
              tasks: [
                {
                  id: "atomic",
                  title: "Atomic evidence",
                  question: "What does the decisive source establish?",
                  priority: "critical",
                  mode: "atomic",
                  depends_on: [],
                  rationale: "It answers the nested branch directly.",
                  expected_evidence: ["One decisive source"],
                },
              ],
            }
          return {
            rationale: "Cover three broad dimensions.",
            objective: "Assess a broad decision",
            deliverables: [],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            flat_rationale:
              "Each domain could theoretically be investigated by one capable worker, so a flat plan would reduce orchestration overhead.",
            tasks: ["Evidence", "Constraints", "Consequences"].map((title, index) => ({
              id: `flat-${index}`,
              title,
              question: `What are the ${title.toLowerCase()} for this decision?`,
              priority: index === 0 ? "critical" : "material",
              mode: "atomic",
              depends_on: [],
              rationale: `${title} materially affects the answer.`,
              expected_evidence: ["Primary evidence", "Independent context"],
              subquestions: [`What establishes ${title.toLowerCase()}?`, `What limits ${title.toLowerCase()}?`],
              evidence_methods: ["Primary-source inspection", "Independent comparison"],
              exclusions: ["Final synthesis"],
              decision_relevance: `${title} can reverse the decision.`,
            })),
          }
        }
        if (input.agent === "research-assessor")
          return {
            decision: "stop",
            stop_reason: "evidence_saturated",
            rationale: "The assigned evidence is covered.",
            information_gain: "low",
            coverage: "complete",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [],
            deliverable_coverage: coveredDeliverables(input),
          }
        return researchBranch("Bounded synthesis")
      })
      const output = yield* ResearchWorkflow.run(
        "Assess a broad decision",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        { ...researchSettings(), effort: "deep", maxDepth: 3, maxBranchesPerNode: 3 },
        runtime,
      )

      expect(output.nodes.map((node) => node.depth)).toEqual([0, 1])
      expect(output.nodes[0]?.waves[0]?.tasks.map((task) => task.role)).toEqual(["recursive", "evidence", "evidence"])
      expect(output.nodes[0]?.waves[0]?.tasks[0]?.decomposition_reason).toContain(
        "configured minimum useful evidence depth",
      )
      expect(output.evaluation).toMatchObject({
        recursive_branches: 1,
        productive_recursive_branches: 1,
        synthesis_only_branches: 0,
        evidence_leaves: 3,
        max_evidence_depth: 2,
      })
    }),
  )

  it.effect("reuses a completed content-addressed evidence artifact across recursive branches", () =>
    Effect.gen(function* () {
      let contracts = 0
      let evidenceRuns = 0
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner") {
          contracts++
          if (contracts === 3) {
            expect(input.prompt).toContain("Authorized upstream artifact inventory")
            expect(input.prompt).toContain("First branch")
            expect(input.prompt).toContain("Branch synthesis")
          }
          if (contracts === 1)
            return {
              rationale: "Compare two branches after a shared measurement.",
              objective: "Root",
              deliverables: ["Comparison"],
              assumptions: [],
              unknowns: [],
              falsifiers: [],
              tasks: [
                {
                  id: "first",
                  title: "First branch",
                  question: "Analyze the first decision branch",
                  priority: "critical",
                  mode: "recurse",
                  depends_on: [],
                  rationale: "Own the first decision.",
                  expected_evidence: [],
                },
                {
                  id: "second",
                  title: "Second branch",
                  question: "Analyze the second decision branch",
                  priority: "critical",
                  mode: "recurse",
                  depends_on: ["first"],
                  rationale: "Own the second decision.",
                  expected_evidence: [],
                },
              ],
            }
          return {
            rationale: "Use the same shared measurement.",
            objective: "Branch",
            deliverables: ["Branch result"],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: [
              {
                id: "shared",
                title: "Shared measurement",
                question: "What does the canonical shared measurement show?",
                priority: "critical",
                mode: "leaf",
                depends_on: [],
                rationale: "Both branches require the identical artifact.",
                expected_evidence: ["Canonical measurement"],
              },
            ],
          }
        }
        if (input.agent === "research-reader") {
          evidenceRuns++
          return researchBranch("Canonical shared evidence")
        }
        if (input.agent === "research-assessor")
          return {
            decision: "stop",
            rationale: "Coverage is adequate.",
            information_gain: "low",
            coverage: "adequate",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [],
            deliverable_coverage: coveredDeliverables(input),
          }
        return researchBranch("Branch synthesis")
      })
      const output = yield* ResearchWorkflow.run(
        "Compare two decisions with shared evidence",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        { ...researchSettings(), maxDepth: 3 },
        runtime,
      )
      const branches = output.nodes.filter((node) => node.depth === 1)
      const artifacts = branches.map((node) => node.waves[0]?.tasks[0])
      expect(branches).toHaveLength(2)
      expect(evidenceRuns).toBe(1)
      expect(artifacts[0]?.artifact_id).toBe(artifacts[1]?.artifact_id)
      expect(artifacts.map((artifact) => artifact?.reused)).toEqual([false, true])
      expect(output.evaluation.reused_artifacts).toBe(1)
    }),
  )

  it.effect("honors Research stop-on-failure before launching a follow-up wave", () =>
    Effect.gen(function* () {
      let assessments = 0
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner")
          return {
            rationale: "Attempt the decisive evidence.",
            objective: "Investigate",
            deliverables: [],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: [
              {
                id: "decisive",
                title: "Decisive evidence",
                question: "Can the decisive source be inspected?",
                priority: "critical",
                mode: "leaf",
                depends_on: [],
                rationale: "It governs the answer.",
                expected_evidence: [],
              },
            ],
          }
        if (input.agent === "research-reader") return new Tool.Failure({ message: "Source unavailable" })
        if (input.agent === "research-assessor") {
          assessments++
          return {
            decision: "continue",
            rationale: "Try an alternative source.",
            information_gain: "high",
            coverage: "incomplete",
            addressed_gap_ids: [],
            tasks: [
              {
                id: "alternative",
                title: "Alternative source",
                question: "Can an alternative source answer the question?",
                priority: "critical",
                mode: "leaf",
                depends_on: [],
                rationale: "Recover coverage.",
                expected_evidence: [],
              },
            ],
            disputes: [],
            deliverable_coverage: coveredDeliverables(input),
          }
        }
        return researchBranch("Partial synthesis")
      })
      const output = yield* ResearchWorkflow.run(
        "Investigate a source-dependent claim",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        { ...researchSettings(), onFailure: "stop" },
        runtime,
      )
      expect(assessments).toBe(1)
      expect(output.nodes[0]?.waves).toHaveLength(1)
      expect(output.nodes[0]?.waves[0]?.stop_code).toBe("blocked")
      expect(output.nodes[0]?.waves[0]?.stop_reason).toContain("stop-on-failure")
    }),
  )

  it.effect("routes only consequential Research disputes through Council", () =>
    Effect.gen(function* () {
      const agents: string[] = []
      const runtime = makeRuntime((input) => {
        agents.push(input.agent)
        if (input.agent === "research-planner")
          return {
            rationale: "Collect competing evidence.",
            objective: "Resolve a decision",
            deliverables: ["Decision"],
            assumptions: [],
            unknowns: ["Which claim governs"],
            falsifiers: [],
            tasks: [
              {
                id: "evidence",
                title: "Collect evidence",
                question: "What evidence supports the competing claims?",
                priority: "critical",
                mode: "leaf",
                depends_on: [],
                rationale: "Frame the dispute.",
                expected_evidence: [],
              },
            ],
          }
        if (input.agent === "research-reader") return researchBranch("Two credible positions remain.")
        if (input.agent === "research-assessor")
          return {
            decision: "stop",
            rationale: "Evidence is complete, but the governing judgment is disputed.",
            information_gain: "low",
            coverage: "adequate",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [
              {
                id: "governing-claim",
                question: "Which of the two evidence-backed claims should govern?",
                claim_ids: [],
                priority: "critical",
                consequential: true,
                reason: "The choice reverses the recommendation.",
                status: "open",
              },
              {
                id: "wording",
                question: "Which background wording is clearest?",
                claim_ids: [],
                priority: "background",
                consequential: false,
                reason: "It does not change the answer.",
                status: "open",
              },
            ],
            deliverable_coverage: coveredDeliverables(input),
          }
        if (input.agent === "council-planner")
          return {
            rationale: "Use independent positions.",
            issues: [{ id: "decision", question: "Which claim governs?" }],
            perspectives: [
              { id: "support", title: "Support", instructions: "Defend the first claim." },
              { id: "challenge", title: "Challenge", instructions: "Defend the alternative." },
            ],
          }
        if (input.agent === "council-perspective")
          return {
            perspective_id: input.title.endsWith("Support") ? "support" : "challenge",
            summary: "Independent assessment",
            issues: [],
            recommendations: [],
            risks: [],
          }
        if (input.agent === "council-synthesizer")
          return {
            status: "completed",
            summary: "The first claim governs under the stated assumption.",
            consensus: ["Use the first claim conditionally"],
            disagreements: [],
            recommendations: ["Test the assumption"],
            risks: [],
          }
        return researchBranch("The Council resolution is integrated into the standalone answer.")
      })
      const output = yield* ResearchWorkflow.run(
        "Resolve the consequential decision",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        {
          ...researchSettings(),
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

      expect(output.councils).toHaveLength(1)
      expect(output.councils[0]?.profile).toBe("compact")
      expect(output.councils[0]?.question).toContain("Which of the two")
      expect(output.graph.disputes.find((dispute) => dispute.id.endsWith("governing-claim"))?.status).toBe("resolved")
      expect(agents.filter((agent) => agent === "council-planner")).toHaveLength(1)
    }),
  )

  it.effect("clusters related consequential disputes into one Council", () =>
    Effect.gen(function* () {
      let councilPlans = 0
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner")
          return {
            rationale: "Establish the contested capacity model.",
            objective: "Resolve related capacity disputes",
            deliverables: [],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: [
              {
                id: "capacity",
                title: "Capacity evidence",
                question: "What unit and radius govern capacity?",
                priority: "critical",
                mode: "leaf",
                depends_on: [],
                rationale: "Both disputes depend on the same model.",
                expected_evidence: [],
              },
            ],
          }
        if (input.agent === "research-reader") return researchBranch("The unit and radius remain disputed.")
        if (input.agent === "research-assessor")
          return {
            decision: "stop",
            rationale: "Two related judgments remain.",
            information_gain: "low",
            coverage: "adequate",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [
              {
                id: "stream-unit",
                question: "Should section or column units govern the streaming capacity estimate?",
                claim_ids: ["claim-capacity"],
                priority: "critical",
                consequential: true,
                reason: "The unit changes the estimate.",
                status: "open",
              },
              {
                id: "stream-radius",
                question: "Should the streaming capacity estimate use the near or outer radius?",
                claim_ids: ["claim-capacity"],
                priority: "critical",
                consequential: true,
                reason: "The radius changes the same estimate.",
                status: "open",
              },
            ],
            deliverable_coverage: [],
          }
        if (input.agent === "council-planner") {
          councilPlans++
          return {
            rationale: "Resolve the shared model.",
            issues: [
              { id: "unit", question: "Which unit governs?" },
              { id: "radius", question: "Which radius governs?" },
            ],
            perspectives: [
              { id: "support", title: "Support", instructions: "Defend the conservative model." },
              { id: "challenge", title: "Challenge", instructions: "Test the alternative." },
            ],
          }
        }
        if (input.agent === "council-perspective")
          return {
            perspective_id: "position",
            summary: "Independent assessment",
            issues: [],
            recommendations: [],
            risks: [],
          }
        if (input.agent === "council-synthesizer")
          return {
            status: "completed",
            summary: "Use explicit unit and radius semantics.",
            consensus: ["Declare both parameters"],
            disagreements: [],
            recommendations: [],
            risks: [],
          }
        return researchBranch("The clustered Council resolution is integrated.")
      })
      const output = yield* ResearchWorkflow.run(
        "Resolve related capacity disputes",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        {
          ...researchSettings(),
          council: {
            perspectives: 2,
            concurrency: 2,
            childTimeoutMs: 60_000,
            debate: { mode: "off", topics: 2, participants: 2, rounds: 1 },
            models: {},
          },
          maxDebatesPerNode: 2,
        },
        runtime,
      )

      expect(councilPlans).toBe(1)
      expect(output.councils).toHaveLength(1)
      expect(output.councils[0]?.dispute_ids).toHaveLength(2)
      expect(output.councils[0]?.profile).toBe("compact")
      expect(output.councils[0]?.question).toContain("Resolve these related consequential disputes together")
      expect(
        output.graph.disputes.filter(
          (dispute) => dispute.id.endsWith("stream-unit") || dispute.id.endsWith("stream-radius"),
        ),
      ).toEqual([expect.objectContaining({ status: "resolved" }), expect.objectContaining({ status: "resolved" })])
    }),
  )

  it.effect("reviews related disputes once after all adaptive Research waves", () =>
    Effect.gen(function* () {
      let assessments = 0
      let councilPlans = 0
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner")
          return {
            rationale: "Collect evidence before resolving the shared decision.",
            objective: "Resolve a cross-wave dispute",
            deliverables: [],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: [
              {
                id: "baseline",
                title: "Baseline evidence",
                question: "What does the baseline establish?",
                priority: "critical",
                mode: "leaf",
                depends_on: [],
                rationale: "Establish the first side of the decision.",
                expected_evidence: [],
              },
            ],
          }
        if (input.agent === "research-reader") return researchBranch("The evidence preserves a bounded disagreement.")
        if (input.agent === "research-assessor") {
          assessments++
          const shared = {
            id: "shared-capacity",
            question: "Which capacity interpretation should govern?",
            claim_ids: ["capacity-low", "capacity-high"],
            priority: "critical",
            consequential: true,
            reason: "The interpretation reverses the decision.",
            status: "open",
            debate_profile: "compact",
          }
          if (assessments === 1)
            return {
              decision: "continue",
              rationale: "A focused follow-up can test the interpretation.",
              information_gain: "high",
              coverage: "incomplete",
              addressed_gap_ids: [],
              tasks: [
                {
                  id: "follow-up",
                  title: "Follow-up evidence",
                  question: "What evidence distinguishes the capacity interpretations?",
                  priority: "critical",
                  mode: "leaf",
                  depends_on: ["baseline"],
                  rationale: "Test the remaining disagreement.",
                  expected_evidence: [],
                },
              ],
              disputes: [shared],
              deliverable_coverage: [],
            }
          return {
            decision: "stop",
            rationale: "The evidence is saturated and the judgment now needs deliberation.",
            information_gain: "low",
            coverage: "adequate",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [
              shared,
              {
                id: "capacity-boundary",
                question: "Which operating boundary follows from the governing capacity interpretation?",
                claim_ids: ["capacity-high"],
                priority: "material",
                consequential: true,
                reason: "The boundary changes the recommendation.",
                status: "open",
                debate_profile: "compact",
              },
            ],
            deliverable_coverage: [],
          }
        }
        if (input.agent === "council-planner") {
          councilPlans++
          return {
            rationale: "Resolve the connected capacity judgment once.",
            issues: [{ id: "capacity", question: "Which interpretation and boundary govern?" }],
            perspectives: [
              { id: "support", title: "Support", instructions: "Defend the lower interpretation." },
              { id: "challenge", title: "Challenge", instructions: "Test the higher interpretation." },
            ],
          }
        }
        if (input.agent === "council-perspective")
          return {
            perspective_id: "position",
            summary: "A focused position",
            issues: [],
            recommendations: [],
            risks: [],
          }
        if (input.agent === "council-synthesizer")
          return {
            status: "completed",
            summary: "Use the measured boundary conditionally.",
            consensus: [],
            disagreements: [],
            recommendations: ["Measure the boundary"],
            risks: [],
          }
        return researchBranch("The cross-wave Council conclusion is integrated.")
      })
      const output = yield* ResearchWorkflow.run(
        "Resolve a cross-wave dispute",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        {
          ...researchSettings(),
          maxWaves: 2,
          maxDebatesPerNode: 2,
          council: {
            perspectives: 4,
            concurrency: 4,
            childTimeoutMs: 60_000,
            debate: { mode: "always", topics: 3, participants: 4, rounds: 2 },
            models: {},
          },
        },
        runtime,
      )

      expect(assessments).toBe(2)
      expect(councilPlans).toBe(1)
      expect(output.councils).toHaveLength(1)
      expect(output.councils[0]?.profile).toBe("compact")
      expect(output.councils[0]?.dispute_ids).toHaveLength(2)
    }),
  )

  it.effect("reuses a nested Council decision for an equivalent root dispute", () =>
    Effect.gen(function* () {
      let planners = 0
      let councilPlans = 0
      let rootSynthesisPrompt = ""
      const runtime = makeRuntime((input) => {
        if (input.agent === "research-planner") {
          planners++
          if (planners === 1)
            return {
              rationale: "Delegate the capacity question to a bounded systems branch.",
              objective: "Assess production capacity",
              deliverables: [],
              assumptions: [],
              unknowns: [],
              falsifiers: [],
              tasks: [
                {
                  id: "topology",
                  title: "Topology and capacity",
                  question: "Can the authoritative topology sustain the target workload?",
                  priority: "critical",
                  role: "recursive",
                  depends_on: [],
                  rationale: "The systems branch needs local evidence and synthesis.",
                  expected_evidence: [],
                },
              ],
            }
          return {
            rationale: "Collect one bounded capacity evidence report.",
            objective: "Topology capacity",
            deliverables: [],
            assumptions: [],
            unknowns: [],
            falsifiers: [],
            tasks: [
              {
                id: "capacity",
                title: "Capacity evidence",
                question: "What does the available capacity evidence establish?",
                priority: "critical",
                role: "evidence",
                depends_on: [],
                rationale: "Establish the workload-specific evidence boundary.",
                expected_evidence: [],
              },
            ],
          }
        }
        if (input.agent === "research-reader")
          return researchBranch("The topology is plausible, but production capacity is not demonstrated.")
        if (input.agent === "research-assessor") {
          if (input.prompt.includes("Current branch:\nCan the authoritative topology"))
            return {
              decision: "stop",
              stop_reason: "evidence_saturated",
              rationale: "The evidence is complete and the capacity interpretation needs judgment.",
              information_gain: "low",
              coverage: "adequate",
              addressed_gap_ids: [],
              tasks: [],
              disputes: [
                {
                  id: "capacity-status",
                  question:
                    "Does the evidence establish 1,000-player authoritative capacity, or only a plausible prototype architecture?",
                  claim_ids: ["capacity-supported", "capacity-unproven"],
                  priority: "critical",
                  consequential: true,
                  reason: "The answer controls the production claim.",
                  status: "open",
                  debate_profile: "compact",
                },
              ],
              deliverable_coverage: coveredDeliverables(input),
            }
          return {
            decision: "stop",
            stop_reason: "evidence_saturated",
            rationale: "The branch evidence is complete.",
            information_gain: "low",
            coverage: "adequate",
            addressed_gap_ids: [],
            tasks: [],
            disputes: [
              {
                id: "production-capacity",
                question: "Does the evidence establish production capacity for 1,000 concurrent voxel players?",
                claim_ids: ["root-capacity"],
                priority: "critical",
                consequential: true,
                reason: "The production claim must remain bounded by the evidence.",
                status: "open",
                debate_profile: "compact",
              },
            ],
            deliverable_coverage: coveredDeliverables(input),
          }
        }
        if (input.agent === "council-planner") {
          councilPlans++
          return {
            rationale: "Resolve whether the evidence supports a prototype or production claim.",
            issues: [{ id: "capacity", question: "What capacity claim does the evidence support?" }],
            perspectives: [
              { id: "support", title: "Support", instructions: "Test the strongest supportable claim." },
              { id: "challenge", title: "Challenge", instructions: "Identify the missing production evidence." },
            ],
          }
        }
        if (input.agent === "council-perspective")
          return {
            perspective_id: "position",
            summary: "The architecture is plausible, but the workload has not been measured.",
            issues: [],
            recommendations: [],
            risks: [],
          }
        if (input.agent === "council-synthesizer")
          return {
            status: "completed",
            summary:
              "Treat 1,000 concurrent voxel players as a prototype target, not demonstrated production capacity.",
            consensus: ["The evidence supports a plausible prototype architecture, not production capacity."],
            disagreements: [],
            recommendations: ["Run the integrated workload benchmark before making a production claim."],
            risks: [],
          }
        if (input.agent === "research-synthesizer" && input.prompt.includes("sole author"))
          rootSynthesisPrompt = input.prompt
        return researchBranch("The existing Council capacity ruling is integrated.")
      })

      const output = yield* ResearchWorkflow.run(
        "Assess production capacity for 1,000 concurrent voxel players",
        parent,
        { ...context, agent: AgentV2.ID.make("research") },
        {
          ...researchSettings(),
          maxDepth: 3,
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

      expect(councilPlans).toBe(1)
      expect(output.councils).toHaveLength(1)
      expect(
        output.graph.disputes.find((dispute) => dispute.question.includes("production capacity for 1,000"))?.status,
      ).toBe("resolved")
      expect(rootSynthesisPrompt).toContain(
        "The evidence supports a plausible prototype architecture, not production capacity.",
      )
    }),
  )

  it.effect("separates canonical claim lineage from transitive evidence", () =>
    Effect.sync(() => {
      const raw = WorkflowSchema.ResearchGraph.make({
        claims: [
          {
            id: "child-claim",
            statement: "The child established the platform constraint.",
            kind: "fact",
            status: "supported",
            confidence: "high",
            evidence_ids: ["child-evidence"],
            contradicts: [],
            assumptions: [],
          },
          {
            id: "cycle-a",
            statement: "Cycle A",
            kind: "inference",
            status: "supported",
            confidence: "low",
            evidence_ids: ["cycle-b"],
            contradicts: [],
            assumptions: [],
          },
          {
            id: "cycle-b",
            statement: "Cycle B",
            kind: "inference",
            status: "supported",
            confidence: "low",
            evidence_ids: ["cycle-a"],
            contradicts: [],
            assumptions: [],
          },
        ],
        evidence: [
          {
            id: "child-evidence",
            summary: "Authorized child report",
            claim_ids: ["child-claim"],
            stance: "support",
            source_type: "artifact",
            verification: "not_applicable",
            report_path: "/reports/child.md",
          },
        ],
        gaps: [],
        disputes: [],
        assumptions: [],
      })
      const graph = ResearchWorkflow.canonicalGraphFrom(
        WorkflowSchema.ResearchBranchResult.make({
          ...researchBranch("Canonical synthesis"),
          claims: [
            {
              id: "root-supported",
              statement: "The platform constraint governs the recommendation.",
              kind: "inference",
              status: "supported",
              confidence: "high",
              evidence_ids: ["child-claim", "unknown-evidence"],
              contradicts: [],
              assumptions: [],
            },
            {
              id: "root-unsupported",
              statement: "The cyclic lineage proves another conclusion.",
              kind: "inference",
              status: "supported",
              confidence: "low",
              evidence_ids: [],
              contradicts: [],
              assumptions: [],
              derived_from_claim_ids: ["cycle-a"],
            },
          ],
        }),
        raw,
        [],
        [],
      )

      expect(graph.claims[0]).toMatchObject({
        id: "root-supported",
        status: "supported",
        evidence_ids: ["child-evidence"],
        derived_from_claim_ids: ["child-claim"],
      })
      expect(graph.evidence[0]?.claim_ids).toEqual(["child-claim", "root-supported"])
      expect(graph.claims[1]).toMatchObject({
        id: "root-unsupported",
        status: "uncertain",
        evidence_ids: [],
        derived_from_claim_ids: ["cycle-a"],
      })
      const reconciled = ResearchWorkflow.reconcileEvidence(graph, [
        {
          url: "https://example.com/platform",
          report_paths: ["/reports/child.md"],
          verification: "verified",
          kind: "primary",
        },
      ])
      const propagated = reconciled.evidence.find((evidence) => evidence.url === "https://example.com/platform")
      expect(propagated).toBeUndefined()
      expect(reconciled.claims[0]?.evidence_ids).toEqual(["child-evidence"])
    }),
  )

  it.effect("reconciles Research evidence verification from observed source provenance", () =>
    Effect.sync(() => {
      const graph = WorkflowSchema.ResearchGraph.make({
        claims: [
          {
            id: "artifact-claim",
            statement: "The child report supports the conclusion.",
            kind: "fact",
            status: "supported",
            confidence: "high",
            evidence_ids: ["artifact"],
            contradicts: [],
            assumptions: [],
          },
        ],
        evidence: [
          {
            id: "verified",
            summary: "Direct source",
            claim_ids: [],
            stance: "support",
            source_type: "primary",
            verification: "verified",
            url: "https://example.com/direct",
          },
          {
            id: "invented",
            summary: "Unobserved source",
            claim_ids: [],
            stance: "support",
            source_type: "primary",
            verification: "verified",
            url: "https://example.com/unobserved",
          },
          {
            id: "artifact",
            summary: "Authorized child report",
            claim_ids: ["artifact-claim"],
            stance: "support",
            source_type: "artifact",
            verification: "not_applicable",
            report_path: "/reports/child.md",
          },
        ],
        gaps: [],
        disputes: [],
        assumptions: [],
      })
      const reconciled = ResearchWorkflow.reconcileEvidence(graph, [
        {
          url: "https://example.com/direct/",
          report_paths: [],
          verification: "failed",
        },
        {
          url: "https://example.com/child-source",
          report_paths: ["/reports/child.md"],
          verification: "verified",
          kind: "primary",
        },
      ])
      expect(reconciled.evidence.find((evidence) => evidence.id === "verified")?.verification).toBe("failed")
      expect(reconciled.evidence.find((evidence) => evidence.id === "invented")?.verification).toBe("unverified")
      const propagated = reconciled.evidence.find((evidence) => evidence.url === "https://example.com/child-source")
      expect(propagated).toBeUndefined()
      expect(reconciled.claims[0]?.evidence_ids).toEqual(["artifact"])
    }),
  )

  it.effect("aggregates Research session, Council, tool, source, and role metrics", () =>
    Effect.promise(async () => {
      const evaluation = await ResearchWorkflow.evaluate(
        [],
        WorkflowSchema.ResearchGraph.make({
          claims: [],
          evidence: [],
          gaps: [],
          disputes: [],
          assumptions: [],
        }),
        [],
        0,
        {
          sessions: [
            WorkflowSchema.SessionStage.make({
              session_id: SessionV2.ID.make("ses_metrics"),
              run_id: "run-council",
              workflow: "council",
              workflow_depth: 2,
              status: "failed",
              agent: "council-debater",
              title: "Debate",
              stage: "debate",
              started_at: 0,
              updated_at: 10,
              elapsed_ms: 10,
              tool_calls: 4,
              tool_errors: 1,
              usage: {
                input: 100,
                output: 20,
                reasoning: 5,
                cache_read: 10,
                cache_write: 0,
                cost: 0,
                cost_status: "unavailable",
                scope: "child_sessions",
              },
            }),
          ],
          delegations: [],
          sources: [
            {
              url: "https://example.com/source",
              report_paths: [],
              verification: "verified",
            },
          ],
        },
      )

      expect(evaluation).toMatchObject({
        total_sessions: 1,
        failed_sessions: 1,
        council_sessions: 1,
        council_invocations: 1,
        nested_council_invocations: 1,
        tool_calls: 4,
        tool_errors: 1,
        cited_sources: 1,
        verified_citations: 1,
      })
      expect(evaluation.roles?.[0]).toMatchObject({
        agent: "council-debater",
        sessions: 1,
        tool_calls: 4,
        tool_errors: 1,
      })
    }),
  )

  it.live("separates standalone report quality from partial empirical completeness", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const reportPath = path.join(tmp.path, "research.md")
          yield* Effect.promise(() =>
            Bun.write(
              reportPath,
              "# Research\n\n## Answer\n\nThe document answers the decision with the evidence currently available.\n\n## Empirical boundary\n\nA measured benchmark remains necessary before the estimate can be promoted to a guarantee.\n",
            ),
          )
          const claim = WorkflowSchema.ResearchClaim.make({
            id: "root:empirical-boundary",
            statement: "A benchmark remains necessary before treating the estimate as a guarantee.",
            kind: "fact",
            status: "uncertain",
            confidence: "high",
            evidence_ids: [],
            contradicts: [],
            assumptions: [],
          })
          const contract = WorkflowSchema.ResearchContract.make({
            rationale: "Separate the desk-research answer from the empirical boundary.",
            objective: "Assess feasibility",
            deliverables: ["State the empirical acceptance boundary"],
            assumptions: [],
            unknowns: ["Measured performance"],
            falsifiers: ["A failed benchmark"],
            tasks: [],
          })
          const result = WorkflowSchema.ResearchBranchResult.make({
            status: "partial",
            summary: "The report is complete as a document while the empirical claim remains partial.",
            claims: [claim],
            evidence: [],
            gaps: [],
            disputes: [],
            assumptions: [],
            conclusions: ["Use the bounded conclusion"],
            recommendations: ["Run the benchmark"],
            limitations: ["Measured performance is unavailable"],
            deliverable_coverage: [
              {
                deliverable: contract.deliverables[0],
                status: "partial",
                report_section: "Empirical boundary",
                claim_ids: [claim.id],
                limitations: ["Requires a benchmark"],
              },
            ],
          })
          const evaluation = yield* Effect.promise(() =>
            ResearchWorkflow.evaluate(
              [
                WorkflowSchema.ResearchNode.make({
                  id: "research-root",
                  depth: 0,
                  title: "Research root",
                  objective: contract.objective,
                  planning_session_id: SessionV2.ID.make("ses_research_plan"),
                  synthesis_session_id: SessionV2.ID.make("ses_research_synthesis"),
                  synthesis_status: "completed",
                  report_path: reportPath,
                  contract,
                  waves: [],
                  result,
                }),
              ],
              WorkflowSchema.ResearchGraph.make({
                claims: [claim],
                evidence: [],
                gaps: [],
                disputes: [],
                assumptions: [],
              }),
              [],
              5,
            ),
          )

          expect(evaluation.standalone_pass).toBe(true)
          expect(evaluation.deliverables_complete).toBe(0)
          expect(evaluation.deliverables_partial).toBe(1)
          expect(evaluation.deliverables_missing).toBe(0)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("publishes a standalone Research document with separate trace and graph artifacts", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const rootReport = path.join(tmp.path, "stages", "root.md")
          const childReport = path.join(tmp.path, "stages", "child.md")
          const reportPath = path.join(tmp.path, "RESEARCH_REPORT.md")
          yield* Effect.promise(() => mkdir(path.dirname(rootReport), { recursive: true }))
          yield* Effect.promise(() =>
            Bun.write(
              rootReport,
              "# Research final synthesis\n\n## Direct answer\n\nA complete standalone conclusion.\n\n## Evidence\n\nThe decisive evidence and its limitation are explained here.\n",
            ),
          )
          yield* Effect.promise(() => Bun.write(childReport, "# Child evidence\n\nDetailed supporting evidence.\n"))
          const result = WorkflowSchema.ResearchBranchResult.make({
            status: "completed",
            summary: "Standalone conclusion",
            claims: [
              {
                id: "root:claim",
                statement: "The conclusion is supported",
                kind: "fact",
                status: "supported",
                confidence: "high",
                evidence_ids: ["root:evidence"],
                contradicts: [],
                assumptions: [],
              },
            ],
            evidence: [
              {
                id: "root:evidence",
                summary: "Inspected source",
                claim_ids: ["root:claim"],
                stance: "support",
                source_type: "primary",
                verification: "verified",
                url: "https://example.com/evidence",
              },
            ],
            gaps: [],
            disputes: [],
            assumptions: [],
            conclusions: ["Proceed"],
            recommendations: ["Monitor the limiting assumption"],
            limitations: ["One boundary remains"],
            coverage: [
              {
                title: "Evidence branch",
                report_path: childReport,
                received: true,
                used: ["Integrated the decisive evidence"],
                rejected: [],
                unresolved: [],
              },
            ],
          })
          const contract = WorkflowSchema.ResearchContract.make({
            rationale: "Test the decisive claim.",
            objective: "Produce a durable answer",
            deliverables: ["Standalone report"],
            assumptions: [],
            unknowns: ["Whether the claim holds"],
            falsifiers: ["Contrary primary evidence"],
            tasks: [],
          })
          const output = WorkflowSchema.ResearchOutput.make({
            workflow: "research",
            status: "completed",
            summary: result.summary,
            final_response: "A complete standalone conclusion.",
            root_session_id: SessionV2.ID.make("ses_research_plan"),
            report_path: reportPath,
            trace_path: WorkflowReport.researchTracePath(reportPath),
            graph_path: WorkflowReport.researchGraphPath(reportPath),
            nodes: [
              {
                id: "research-root",
                depth: 0,
                title: "Research root",
                objective: contract.objective,
                planning_session_id: SessionV2.ID.make("ses_research_plan"),
                synthesis_session_id: SessionV2.ID.make("ses_research_synthesis"),
                report_path: rootReport,
                contract,
                waves: [
                  {
                    number: 1,
                    rationale: "Initial contract",
                    tasks: [
                      {
                        id: "task-1",
                        title: "Evidence branch",
                        question: "Does the claim hold?",
                        priority: "critical",
                        role: "evidence",
                        mode: "leaf",
                        status: "completed",
                        session_id: SessionV2.ID.make("ses_research_child"),
                        report_path: childReport,
                        reused: false,
                      },
                    ],
                    assessment_session_id: SessionV2.ID.make("ses_research_assessment"),
                    assessment: {
                      decision: "stop",
                      rationale: "The decisive claim is covered.",
                      information_gain: "low",
                      coverage: "complete",
                      addressed_gap_ids: [],
                      tasks: [],
                      disputes: [],
                      deliverable_coverage: [],
                    },
                    stop_reason: "The decisive claim is covered.",
                  },
                ],
                result,
              },
            ],
            graph: {
              claims: result.claims,
              evidence: result.evidence,
              gaps: result.gaps,
              disputes: result.disputes,
              assumptions: result.assumptions,
            },
            raw_graph: {
              claims: result.claims,
              evidence: result.evidence,
              gaps: result.gaps,
              disputes: result.disputes,
              assumptions: result.assumptions,
            },
            evaluation: {
              report_words: 12,
              report_sections: 2,
              standalone_pass: true,
              claims: 1,
              supported_claims: 1,
              traceable_supported_claims: 1,
              evidence_records: 1,
              verified_sources: 1,
              open_critical_gaps: 0,
              consequential_disputes: 0,
              council_reviews: 0,
              evidence_tasks: 1,
              reused_artifacts: 0,
              coverage_complete: true,
            },
            councils: [],
          })

          yield* Effect.promise(() => WorkflowReport.writeResearch(contract.objective, output, reportPath))

          const report = yield* Effect.promise(() => Bun.file(reportPath).text())
          const trace = yield* Effect.promise(() => Bun.file(WorkflowReport.researchTracePath(reportPath)).text())
          const graph = yield* Effect.promise(() => Bun.file(WorkflowReport.researchGraphPath(reportPath)).json())
          const raw = yield* Effect.promise(() => Bun.file(WorkflowReport.researchRawGraphPath(reportPath)).json())
          expect(report).toContain("# Research Report")
          expect(report).toContain("A complete standalone conclusion.")
          expect(report).toContain("The decisive evidence and its limitation are explained here.")
          expect(report).toContain("## Evidence References")
          expect(report).toContain("**C1** — The conclusion is supported")
          expect(report).toContain("**E1** — Inspected source — <https://example.com/evidence>")
          expect(report).toContain("Supports: C1")
          expect(report).toContain("[Evidence branch](stages/child.md)")
          expect(report).not.toContain("## Adaptive Waves")
          expect(trace).toContain("# Research Trace")
          expect(trace).toContain("## Adaptive Waves")
          expect(trace).toContain("RESEARCH_RAW_GRAPH.json")
          expect(trace).toContain("root:claim")
          expect(graph.claims).toEqual([expect.objectContaining({ id: "root:claim" })])
          expect(raw.claims).toEqual([expect.objectContaining({ id: "root:claim" })])

          const directPath = path.join(tmp.path, "DIRECT_RESEARCH_REPORT.md")
          yield* Effect.promise(() =>
            Bun.write(
              directPath,
              "# Direct research answer\n\n## Finding\n\nThe root author wrote this document directly.\n\n## Limit\n\nOne bounded uncertainty remains.\n",
            ),
          )
          const direct = WorkflowSchema.ResearchOutput.make({
            ...output,
            report_path: directPath,
            nodes: output.nodes.map((node) => ({ ...node, report_path: directPath })),
          })
          yield* Effect.promise(() => WorkflowReport.writeResearch(contract.objective, direct, directPath))
          const directReport = yield* Effect.promise(() => Bun.file(directPath).text())
          expect(directReport).toStartWith("# Direct research answer")
          expect(directReport).toContain("The root author wrote this document directly.")
          expect(directReport).toContain("## Evidence References")
          expect(directReport).toContain("**E1** — Inspected source — <https://example.com/evidence>")
          expect(directReport).not.toContain("## Main Document")

          const crowdedPath = path.join(tmp.path, "CROWDED_RESEARCH_REPORT.md")
          yield* Effect.promise(() =>
            Bun.write(
              crowdedPath,
              "# Crowded research answer\n\n## Finding\n\nThe concise narrative remains primary.\n\n## Limit\n\nThe exhaustive graph remains separate.\n",
            ),
          )
          const crowdedEvidence = Array.from({ length: 6 }, (_, index) => ({
            id: `source-${index + 1}`,
            summary: `Ranked source ${index + 1}`,
            claim_ids: ["crowded-claim"],
            stance: "support" as const,
            source_type: "primary" as const,
            verification: "verified" as const,
            url: `https://example.com/source-${index + 1}`,
          }))
          const crowded = WorkflowSchema.ResearchOutput.make({
            ...output,
            report_path: crowdedPath,
            nodes: output.nodes.map((node) => ({ ...node, report_path: crowdedPath })),
            graph: {
              ...output.graph,
              claims: [
                {
                  id: "crowded-claim",
                  statement: "The claim has more evidence than the readable appendix should show.",
                  kind: "fact",
                  status: "contested",
                  confidence: "high",
                  evidence_ids: [
                    "self-reference",
                    ...crowdedEvidence.map((evidence) => evidence.id),
                    "challenge-source",
                  ],
                  contradicts: [],
                  assumptions: [],
                },
              ],
              evidence: [
                {
                  id: "self-reference",
                  summary: "The final report cannot support itself.",
                  claim_ids: ["crowded-claim"],
                  stance: "support",
                  source_type: "artifact",
                  verification: "not_applicable",
                  report_path: crowdedPath,
                },
                ...crowdedEvidence,
                {
                  id: "challenge-source",
                  summary: "Preserved opposing evidence",
                  claim_ids: ["crowded-claim"],
                  stance: "challenge",
                  source_type: "secondary",
                  verification: "unverified",
                  url: "https://example.com/challenge",
                },
              ],
            },
          })
          yield* Effect.promise(() => WorkflowReport.writeResearch(contract.objective, crowded, crowdedPath))
          const crowdedReport = yield* Effect.promise(() => Bun.file(crowdedPath).text())
          expect(crowdedReport.match(/^- \*\*E\d+\*\*/gm)).toHaveLength(5)
          expect(crowdedReport).toContain("RESEARCH_GRAPH.json")
          expect(crowdedReport).toContain("Preserved opposing evidence")
          expect(crowdedReport).not.toContain("source-6")
          expect(crowdedReport).not.toContain("The final report cannot support itself.")
          expect(crowdedReport).not.toContain("[supporting report](CROWDED_RESEARCH_REPORT.md)")
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("marks thin Research documents without rewriting them", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const thin = path.join(tmp.path, "thin.md")
          const substantial = path.join(tmp.path, "substantial.md")
          yield* Effect.promise(() => Bun.write(thin, "# Thin\n\n## Answer\n\nToo short.\n"))
          yield* Effect.promise(() =>
            Bun.write(
              substantial,
              `# Substantial\n\n## Answer\n\n${"Evidence-backed explanation ".repeat(80)}\n\n## Limits\n\n${"Bounded limitation ".repeat(20)}\n`,
            ),
          )
          expect(yield* Effect.promise(() => ResearchWorkflow.validateDocument(thin, 100))).toEqual([
            expect.stringContaining("configured minimum is 100"),
            "The standalone synthesis has fewer than two substantive sections.",
          ])
          expect(yield* Effect.promise(() => ResearchWorkflow.validateDocument(substantial, 100))).toEqual([])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.effect("keeps a thick Research response and its artifact pointers within the handoff budget", () =>
    Effect.sync(() => {
      const result = WorkflowSchema.ResearchBranchResult.make({
        ...researchBranch("Root synthesis"),
        conclusions: ["Conclusion"],
      })
      const output = WorkflowSchema.ResearchOutput.make({
        workflow: "research",
        status: "completed",
        execution_status: "completed",
        artifact_status: "available",
        evidence_status: "partial",
        summary: "Root synthesis",
        final_response: "Substantial standalone research. ".repeat(8_000),
        root_session_id: SessionV2.ID.make("ses_research_root"),
        report_path: "/project/.opencode/reports/RESEARCH_REPORT.md",
        trace_path: "/project/.opencode/reports/RESEARCH_TRACE.md",
        graph_path: "/project/.opencode/reports/RESEARCH_GRAPH.json",
        nodes: [
          {
            id: "research-root",
            depth: 0,
            title: "Research root",
            objective: "Investigate",
            planning_session_id: SessionV2.ID.make("ses_research_root"),
            synthesis_session_id: SessionV2.ID.make("ses_research_synthesis"),
            contract: {
              rationale: "Investigate",
              objective: "Investigate",
              deliverables: [],
              assumptions: [],
              unknowns: [],
              falsifiers: [],
              tasks: [],
            },
            waves: [],
            result,
          },
        ],
        graph: { claims: [], evidence: [], gaps: [], disputes: [], assumptions: [] },
        evaluation: {
          report_words: 8_000,
          report_sections: 4,
          standalone_pass: true,
          claims: 0,
          supported_claims: 0,
          traceable_supported_claims: 0,
          evidence_records: 0,
          verified_sources: 0,
          open_critical_gaps: 0,
          consequential_disputes: 0,
          council_reviews: 0,
          evidence_tasks: 0,
          reused_artifacts: 0,
          coverage_complete: true,
        },
        councils: [],
      })
      const serialized = WorkflowHandoff.research(output)
      const handoff = JSON.parse(serialized)
      expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(40 * 1024)
      expect(handoff.final_response).toEndWith("[Full Research report](/project/.opencode/reports/RESEARCH_REPORT.md)")
      expect(handoff.report_path).toBe("/project/.opencode/reports/RESEARCH_REPORT.md")
      expect(handoff.graph_path).toBe("/project/.opencode/reports/RESEARCH_GRAPH.json")
    }),
  )

  it.effect("normalizes equivalent Heavy terminal result shapes", () =>
    Effect.sync(() => {
      expect(
        Schema.decodeUnknownSync(WorkflowSchema.HeavyNodeSubmission)({
          status: "completed",
          summary: "Compact result",
          decisions: [{ decision: "Use chunked storage", basis: "It bounds working-set memory" }],
          findings: ["Browser support varies by platform"],
          changed_files: [],
          validation: [],
          risks: [],
          follow_up: [],
        }),
      ).toEqual({
        status: "completed",
        summary: "Compact result",
        decisions: ["Use chunked storage — It bounds working-set memory"],
        findings: [{ claim: "Browser support varies by platform", evidence: [] }],
        changed_files: [],
        validation: [],
        risks: [],
        follow_up: [],
      })
    }),
  )

  it.effect("repairs observed planner and terminal schema drift without another model turn", () =>
    Effect.sync(() => {
      expect(
        Schema.decodeUnknownSync(WorkflowSchema.HeavyPlanSubmission)({
          rationale: "Investigate in dependency order",
          tasks: [
            {
              id: "research",
              title: "Research storage",
              capability: "read",
              mode: "standard",
            },
            {
              id: "implement",
              title: "Implement the result",
              capability: "write",
              mode: "direct",
              depends_on: "research",
            },
          ],
        }),
      ).toEqual({
        rationale: "Investigate in dependency order",
        tasks: [
          {
            id: "research",
            title: "Research storage",
            objective: "Research storage",
            capability: "read",
            mode: "leaf",
            depends_on: [],
            relationship: "partition",
            contribution: "Research storage",
            exclusions: [],
          },
          {
            id: "implement",
            title: "Implement the result",
            objective: "Implement the result",
            capability: "write",
            mode: "leaf",
            depends_on: ["research"],
            relationship: "partition",
            contribution: "Implement the result",
            exclusions: [],
          },
        ],
      })
      expect(
        Schema.decodeUnknownSync(WorkflowSchema.HeavyNodeSubmission)({
          status: "complete",
          summary: { result: "Implemented safely", caveat: "Benchmark in production" },
          decisions: { decision: "Use bounded recursion", basis: "It prevents runaway work" },
          findings: {
            finding: "The complete report propagated",
            evidence: ["one", "two", "three", "four", "this fifth entry is deterministically omitted"],
          },
          changed_files: "src/workflow.ts",
          validation: [{ command: "bun test", status: "passed" }],
          risks: { risk: "Higher prompt cost", mitigation: "Monitor prompt bytes" },
          follow_up: { action: "Inspect production metrics" },
        }),
      ).toEqual({
        status: "completed",
        summary: "result: Implemented safely — caveat: Benchmark in production",
        decisions: ["Use bounded recursion — It prevents runaway work"],
        findings: [{ claim: "The complete report propagated", evidence: ["one", "two", "three", "four"] }],
        changed_files: ["src/workflow.ts"],
        validation: ["command: bun test — status: passed"],
        risks: ["risk: Higher prompt cost — mitigation: Monitor prompt bytes"],
        follow_up: ["action: Inspect production metrics"],
      })
      expect(
        Schema.decodeUnknownSync(WorkflowSchema.CouncilSynthesisSubmission)({
          status: "incomplete",
          summary: "One issue remains open",
          consensus: "Keep the durable reports",
          disagreements: {
            question: "How wide should recursion be?",
            positions: "Measure before increasing the limit",
          },
          recommendations: { action: "Benchmark the workflow" },
          risks: [{ risk: "Cost", mitigation: "Use shared budgets" }],
        }),
      ).toEqual({
        status: "partial",
        summary: "One issue remains open",
        consensus: ["Keep the durable reports"],
        disagreements: [
          {
            issue_id: "issue-1",
            question: "How wide should recursion be?",
            positions: ["Measure before increasing the limit"],
          },
        ],
        recommendations: ["action: Benchmark the workflow"],
        risks: ["risk: Cost — mitigation: Use shared budgets"],
      })
    }),
  )

  it.effect("derives source verification from completed and failed web tools", () =>
    Effect.sync(() => {
      const completed = (id: string, name: string, input: Record<string, unknown>, text: string) =>
        SessionMessage.AssistantTool.make({
          type: "tool",
          id,
          name,
          time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(1) },
          state: SessionMessage.ToolStateCompleted.make({
            status: "completed",
            input,
            structured: {},
            content: [{ type: "text", text }],
          }),
        })
      const message = SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_source_observations"),
        type: "assistant",
        agent: "heavy-reader",
        model: parent.model!,
        time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(1) },
        content: [
          completed("call-fetch", "webfetch", { url: "https://example.com/direct;" }, "Directly fetched content."),
          completed(
            "call-search",
            "websearch",
            { query: "example" },
            "Discovered https://example.com/discovered in search results.",
          ),
          SessionMessage.AssistantTool.make({
            type: "tool",
            id: "call-failed-fetch",
            name: "webfetch",
            time: { created: DateTime.makeUnsafe(0), completed: DateTime.makeUnsafe(1) },
            state: SessionMessage.ToolStateError.make({
              status: "error",
              input: { url: "https://example.com/failed" },
              structured: {},
              content: [],
              error: { type: "unknown", message: "Fetch failed" },
            }),
          }),
        ],
      })

      expect(WorkflowRuntime.sourceObservations([message])).toEqual([
        { url: "https://example.com/direct", verification: "verified", method: "direct" },
        { url: "https://example.com/discovered", verification: "unverified", method: "search" },
        { url: "https://example.com/failed", verification: "failed", method: "direct" },
      ])
    }),
  )

  it.effect("marks unresolved evidence partial while keeping available artifacts distinct", () =>
    Effect.sync(() => {
      const session = WorkflowSchema.SessionStage.make({
        session_id: SessionV2.ID.make("ses_health"),
        run_id: "run-health",
        workflow: "heavy",
        workflow_depth: 0,
        status: "completed",
        agent: "heavy-reader",
        title: "Health check",
        stage: "execution",
        started_at: 0,
        updated_at: 1,
        elapsed_ms: 1,
        usage: {
          input: 10,
          output: 2,
          reasoning: 1,
          cache_read: 3,
          cache_write: 0,
          cost: 0,
          cost_status: "unavailable",
          scope: "child_sessions",
        },
      })
      const coverage = [
        WorkflowSchema.ArtifactCoverage.make({
          title: "Benchmark",
          received: true,
          used: ["Architecture"],
          rejected: [],
          unresolved: ["Production throughput remains unmeasured."],
        }),
      ]
      expect(
        WorkflowReport.health("completed", [session], coverage, [
          {
            url: "https://example.com/source",
            report_paths: [],
            verification: "unverified",
          },
        ]),
      ).toEqual({
        execution_status: "completed",
        artifact_status: "available",
        evidence_status: "partial",
      })
      expect(WorkflowReport.aggregateUsage([session])).toMatchObject({
        input: 10,
        scope: "child_sessions",
      })
    }),
  )

  it.effect("preserves an immutable workflow start across terminal timing snapshots", () =>
    Effect.gen(function* () {
      const execution = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Measure the complete workflow",
        sessionID: parent.id,
        toolCallID: "call-workflow-timing",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 2,
        maxWorkflows: 4,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const first = WorkflowExecution.timing(execution, execution.startedAt + 250)
      const terminal = WorkflowExecution.timing(execution, execution.startedAt + 5_000)

      expect(first).toEqual({
        started_at: execution.startedAt,
        completed_at: execution.startedAt + 250,
        elapsed_ms: 250,
      })
      expect(terminal.started_at).toBe(first.started_at)
      expect(terminal.elapsed_ms).toBe(5_000)
    }),
  )

  it.effect("keeps a compact completed-session index when a thick final response exceeds the handoff budget", () =>
    Effect.sync(() => {
      const output = WorkflowSchema.HeavyOutput.make({
        workflow: "heavy",
        status: "completed",
        execution_status: "completed",
        artifact_status: "available",
        evidence_status: "partial",
        summary: "Thick synthesis completed",
        final_response: "Detailed standalone synthesis. ".repeat(8_000),
        root_session_id: SessionV2.ID.make("ses_handoff_root"),
        report_path: "/project/.opencode/reports/HEAVY_REPORT.md",
        session_manifest: [
          {
            session_id: SessionV2.ID.make("ses_handoff_plan"),
            run_id: "run-handoff",
            workflow: "heavy",
            workflow_depth: 0,
            status: "completed",
            agent: "heavy-planner",
            title: "Plan",
            stage: "planning",
            started_at: 0,
            updated_at: 10,
            elapsed_ms: 10,
          },
          {
            session_id: SessionV2.ID.make("ses_handoff_worker"),
            parent_session_id: SessionV2.ID.make("ses_handoff_plan"),
            run_id: "run-handoff",
            workflow: "heavy",
            workflow_depth: 0,
            status: "completed",
            agent: "heavy-reader",
            title: "Worker",
            stage: "execution",
            report_path: "/project/.opencode/reports/stages/worker.md",
            started_at: 10,
            updated_at: 20,
            elapsed_ms: 10,
          },
        ],
        nodes: [
          {
            id: "heavy-root",
            session_id: SessionV2.ID.make("ses_handoff_synthesis"),
            depth: 0,
            title: "Heavy root",
            objective: "Produce a thick report",
            capability: "write",
            status: "completed",
            summary: "Thick synthesis completed",
            decisions: [],
            findings: [],
            changed_files: [],
            validation: [],
            risks: [],
            follow_up: [],
            council_routing: {
              mode: "auto",
              outcome: "not_triggered",
              reason: "No material dispute was identified.",
              signals: [],
            },
          },
        ],
      })

      const serialized = WorkflowHandoff.heavy(output)
      const handoff = JSON.parse(serialized)
      expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(40 * 1024)
      expect(handoff.handoff_compacted).toBe(true)
      expect(handoff.session_manifest).toEqual([
        expect.objectContaining({ session_id: "ses_handoff_plan", status: "completed" }),
        expect.objectContaining({ session_id: "ses_handoff_worker", status: "completed" }),
      ])
      expect(handoff.final_response).toEndWith("[Full Heavy report](/project/.opencode/reports/HEAVY_REPORT.md)")
      expect(
        handoff.final_response.match(/\[Full Heavy report\]\(\/project\/\.opencode\/reports\/HEAVY_REPORT\.md\)/g),
      ).toHaveLength(1)
      expect(handoff.final_report.council_routing).toMatchObject({ outcome: "not_triggered" })
      expect(handoff.final_response_instruction).toContain("explicitly disclose partial evidence")
    }),
  )

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
      expect(prompts.some((prompt) => !prompt.includes('"nodes"') && prompt.includes("deep finding"))).toBe(true)
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

  it.live("uses the root recursive synthesis as the final Heavy report", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const execution = yield* WorkflowExecution.make({
            workflow: "heavy",
            objective: "Investigate recursively",
            sessionID: parent.id,
            toolCallID: "call-recursive-reports",
            directory: tmp.path,
            reportDirectory: ".opencode/reports",
            maxDepth: 3,
            maxWorkflows: 8,
            delegates: {
              heavy: new Set(["heavy", "council"]),
              council: new Set(["heavy", "council"]),
            },
          })
          let plans = 0
          let branchPrompt = ""
          let rootPrompt = ""
          const titles: string[] = []
          const childID = (_parentID: SessionV2.ID, id: string) => SessionV2.ID.make(`ses_${id}`)
          const runtime: WorkflowRuntime.Interface = {
            childID,
            execution: () => execution,
            runChild: <Result extends Tool.SchemaType<any>>(input: WorkflowRuntime.ChildInput<Result>) =>
              Effect.gen(function* () {
                titles.push(input.title)
                if (input.agent === "heavy-planner") {
                  plans++
                  return Schema.decodeUnknownSync(input.result)({
                    rationale: `recursive plan ${plans}`,
                    tasks: [
                      {
                        id: plans === 1 ? "branch" : "leaf",
                        title: plans === 1 ? "Recursive branch" : "Evidence leaf",
                        objective: plans === 1 ? "Investigate one level deeper" : "Collect deep evidence",
                        capability: "read",
                        mode: plans === 1 ? "recurse" : "leaf",
                        depends_on: [],
                      },
                    ],
                  })
                }
                const sessionID = childID(input.parentID, input.id)
                if (input.agent === "heavy-reader") {
                  yield* Effect.promise(() => writeArtifact(execution, sessionID, "LEAF_ONLY_EVIDENCE"))
                  return Schema.decodeUnknownSync(input.result)(nodeResult)
                }
                if (input.title === "Heavy synthesis: Recursive branch") {
                  branchPrompt = input.prompt
                  yield* Effect.promise(() => writeArtifact(execution, sessionID, "BRANCH_FULL_SYNTHESIS"))
                  return Schema.decodeUnknownSync(input.result)({ ...nodeResult, summary: "bounded branch index" })
                }
                if (input.title === "Heavy synthesis: Heavy root") {
                  rootPrompt = input.prompt
                  yield* Effect.promise(() => writeArtifact(execution, sessionID, "ROOT_FINAL_SYNTHESIS"))
                  return Schema.decodeUnknownSync(input.result)({ ...nodeResult, summary: "bounded root index" })
                }
                return Schema.decodeUnknownSync(input.result)({ ...nodeResult, summary: "bounded root index" })
              }),
            progress: () => Effect.void,
          }

          const output = yield* HeavyWorkflow.run(
            "Investigate recursively",
            parent,
            { ...context, execution },
            {
              maxDepth: 2,
              tasksPerNode: 2,
              maxNodes: 8,
              concurrency: 2,
              childTimeoutMs: 60_000,
              onFailure: "keep",
              models: {},
            },
            runtime,
          )

          expect(branchPrompt).toContain("LEAF_ONLY_EVIDENCE")
          expect(rootPrompt).toContain("BRANCH_FULL_SYNTHESIS")
          expect(rootPrompt).not.toContain("[No durable report path was produced")
          expect(rootPrompt).toContain("at the root, the final Heavy document")
          expect(titles.filter((title) => title.startsWith("Heavy report"))).toEqual([])
          const root = output.nodes.find((node) => node.depth === 0)
          expect(root?.session_id).toContain(":synthesis")
          expect(yield* Effect.promise(() => WorkflowReport.readArtifact(root?.report_path))).toContain(
            "ROOT_FINAL_SYNTHESIS",
          )
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("loads durable Heavy dependency reports before dependent tasks", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const execution = yield* WorkflowExecution.make({
            workflow: "heavy",
            objective: "Research then decide",
            sessionID: parent.id,
            toolCallID: "call-dependency-reports",
            directory: tmp.path,
            reportDirectory: ".opencode/reports",
            maxDepth: 2,
            maxWorkflows: 8,
            delegates: {
              heavy: new Set(["heavy", "council"]),
              council: new Set(["heavy", "council"]),
            },
          })
          let dependentPrompt = ""
          const childID = (_parentID: SessionV2.ID, id: string) => SessionV2.ID.make(`ses_${id}`)
          const runtime: WorkflowRuntime.Interface = {
            childID,
            execution: () => execution,
            runChild: <Result extends Tool.SchemaType<any>>(input: WorkflowRuntime.ChildInput<Result>) =>
              Effect.gen(function* () {
                if (input.agent === "heavy-planner")
                  return Schema.decodeUnknownSync(input.result)({
                    rationale: "research before deciding",
                    tasks: [
                      {
                        id: "research",
                        title: "Research",
                        objective: "Collect complete evidence",
                        capability: "read",
                        mode: "leaf",
                        depends_on: [],
                      },
                      {
                        id: "decision",
                        title: "Decision",
                        objective: "Use the complete research",
                        capability: "read",
                        mode: "leaf",
                        depends_on: ["research"],
                      },
                    ],
                  })
                const sessionID = childID(input.parentID, input.id)
                if (input.title === "Heavy: Research")
                  yield* Effect.promise(() => writeArtifact(execution, sessionID, "DEPENDENCY_REPORT_EVIDENCE"))
                if (input.title === "Heavy: Decision") {
                  dependentPrompt = input.prompt
                  yield* Effect.promise(() => writeArtifact(execution, sessionID, "DEPENDENT_RESULT"))
                }
                return Schema.decodeUnknownSync(input.result)(nodeResult)
              }),
            progress: () => Effect.void,
          }

          yield* HeavyWorkflow.run(
            "Research then decide",
            parent,
            { ...context, execution },
            {
              maxDepth: 1,
              tasksPerNode: 2,
              maxNodes: 8,
              concurrency: 2,
              childTimeoutMs: 60_000,
              onFailure: "keep",
              models: {},
            },
            runtime,
          )

          expect(dependentPrompt).toContain("DEPENDENCY_REPORT_EVIDENCE")
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.effect("runs ready recursive and leaf read branches concurrently", () =>
    Effect.gen(function* () {
      let active = 0
      let maximum = 0
      let nestedPlanPrompt = ""
      const runtime: WorkflowRuntime.Interface = {
        childID: (_parentID, id) => SessionV2.ID.make(`ses_${id}`),
        execution: () => undefined,
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
                    mode: "leaf",
                    depends_on: [],
                  },
                ],
              })
            if (input.agent === "heavy-planner") {
              nestedPlanPrompt = input.prompt
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
            if (input.agent === "heavy-reader") {
              active++
              maximum = Math.max(maximum, active)
              yield* Effect.promise(() => Bun.sleep(20))
              active--
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
      expect(nestedPlanPrompt).toContain("Scope already owned outside this branch")
      expect(nestedPlanPrompt).toContain("Second branch")
    }),
  )

  it.effect("reviews accidental scope overlap and preserves intentional task relationships", () =>
    Effect.gen(function* () {
      const plannerPrompts: string[] = []
      let plans = 0
      const runtime = makeRuntime((input) => {
        if (input.agent !== "heavy-planner") return nodeResult
        plannerPrompts.push(input.prompt)
        plans++
        if (plans === 1)
          return {
            rationale: "Two accidentally duplicated assignments",
            tasks: [
              {
                id: "browser-one",
                title: "Browser feasibility",
                objective: "Assess browser C++ WASM WebGPU feasibility and deployment constraints",
                capability: "read",
                mode: "leaf",
                relationship: "partition",
                contribution: "Browser feasibility and deployment constraints",
                exclusions: [],
              },
              {
                id: "browser-two",
                title: "Browser feasibility review",
                objective: "Assess browser C++ WASM WebGPU feasibility and deployment constraints",
                capability: "read",
                mode: "leaf",
                relationship: "partition",
                contribution: "Browser feasibility and deployment constraints",
                exclusions: [],
              },
            ],
          }
        return {
          rationale: "Differentiate implementation facts from adversarial risk review",
          tasks: [
            {
              id: "browser-facts",
              title: "Browser implementation facts",
              objective: "Establish C++ WASM and WebGPU platform constraints",
              capability: "read",
              mode: "leaf",
              relationship: "partition",
              contribution: "A factual compatibility matrix",
              exclusions: ["Product launch risk"],
            },
            {
              id: "browser-risk",
              title: "Browser launch challenge",
              objective: "Challenge launch assumptions using the compatibility evidence",
              capability: "read",
              mode: "leaf",
              relationship: "challenge",
              contribution: "An adversarial launch-risk assessment",
              exclusions: ["Rebuilding the compatibility matrix"],
              depends_on: ["browser-facts"],
            },
          ],
        }
      })

      const output = yield* HeavyWorkflow.run(
        "Assess browser feasibility",
        parent,
        { ...context, toolCallID: "call-scope-review" },
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

      expect(plannerPrompts).toHaveLength(2)
      expect(plannerPrompts[1]).toContain("Detected conflicts")
      expect(output.nodes[0]?.plan).toEqual([
        expect.objectContaining({
          id: "browser-facts",
          relationship: "partition",
          contribution: "A factual compatibility matrix",
        }),
        expect.objectContaining({
          id: "browser-risk",
          relationship: "challenge",
          exclusions: ["Rebuilding the compatibility matrix"],
        }),
      ])
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
      expect(output.nodes[0]?.plan).toEqual([
        expect.objectContaining({ id: "one", disposition: "executed", status: "completed" }),
        expect.objectContaining({ id: "two", disposition: "executed", status: "completed" }),
        expect.objectContaining({ id: "report", disposition: "replaced" }),
        expect.objectContaining({ id: "recommendation", disposition: "replaced" }),
      ])
    }),
  )

  it.effect("executes independent gate analysis and exposes tasks omitted by breadth limits", () =>
    Effect.gen(function* () {
      const independent = yield* HeavyWorkflow.run(
        "Assess feasibility",
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
        makeRuntime((input) => {
          if (input.agent !== "heavy-planner") return nodeResult
          return {
            rationale: "Research, then independently challenge feasibility",
            tasks: [
              {
                id: "research",
                title: "Research constraints",
                objective: "Collect quantitative constraints",
                capability: "read",
                mode: "leaf",
                depends_on: [],
              },
              {
                id: "gates",
                title: "Produce an independent feasibility and MVP gate analysis",
                objective: "Evaluate the evidence independently and recommend measurable gates",
                capability: "read",
                mode: "leaf",
                depends_on: ["research"],
              },
            ],
          }
        }),
      )
      expect(independent.nodes.map((node) => node.title)).toContain(
        "Produce an independent feasibility and MVP gate analysis",
      )
      expect(independent.nodes[0]?.plan).toEqual([
        expect.objectContaining({ id: "research", disposition: "executed", status: "completed" }),
        expect.objectContaining({ id: "gates", disposition: "executed", status: "completed" }),
      ])

      const capped = yield* HeavyWorkflow.run(
        "Assess two independent constraints",
        parent,
        { ...context, toolCallID: "call-capped-plan" },
        {
          maxDepth: 1,
          tasksPerNode: 1,
          maxNodes: 8,
          concurrency: 4,
          childTimeoutMs: 60_000,
          onFailure: "keep",
          models: {},
        },
        makeRuntime((input) => {
          if (input.agent !== "heavy-planner") return nodeResult
          return {
            rationale: "Two useful investigations",
            tasks: [
              {
                id: "one",
                title: "Research first constraint",
                objective: "Research the first constraint",
                capability: "read",
                mode: "leaf",
                depends_on: [],
              },
              {
                id: "two",
                title: "Research second constraint",
                objective: "Research the second constraint",
                capability: "read",
                mode: "leaf",
                depends_on: [],
              },
            ],
          }
        }),
      )
      expect(capped.status).toBe("partial")
      expect(capped.nodes[0]?.plan).toEqual([
        expect.objectContaining({ id: "one", disposition: "executed", status: "completed" }),
        expect.objectContaining({ id: "two", disposition: "capped" }),
      ])
      expect(capped.nodes[0]?.coverage).toContainEqual(
        expect.objectContaining({
          title: "Research second constraint",
          received: false,
        }),
      )
    }),
  )

  it.effect("records why Council is unavailable when no reviewer is configured", () =>
    Effect.gen(function* () {
      const agents: string[] = []
      const runtime = makeRuntime((input) => {
        agents.push(input.agent)
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
        },
        runtime,
      )

      expect(output.council).toBeUndefined()
      expect(agents.some((agent) => agent.startsWith("council-"))).toBe(false)
      expect(output.nodes[0]?.council_routing).toMatchObject({
        mode: "auto",
        outcome: "unavailable",
      })
    }),
  )

  it.effect("automatically runs Council for a planner-identified consequential dispute", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime((input) => {
        if (input.agent === "heavy-planner")
          return {
            rationale: "The launch contract depends on two defensible concurrency interpretations",
            council: {
              recommended: true,
              reason: "Global concurrency and hotspot concurrency imply different commitments.",
              question: "Should the launch contract promise global or same-hotspot concurrency?",
              signals: ["competing_objectives", "consequential_decision", "assumption_sensitive"],
            },
            tasks: [
              {
                id: "capacity",
                title: "Capacity evidence",
                objective: "Measure the two concurrency interpretations",
                capability: "read",
                mode: "leaf",
                relationship: "partition",
                contribution: "Quantitative capacity evidence",
                exclusions: [],
              },
            ],
          }
        if (input.agent === "council-planner")
          return {
            rationale: "Debate the product commitment",
            issues: [{ id: "contract", question: "Which concurrency promise is supportable?" }],
            perspectives: [],
          }
        if (input.agent === "council-perspective")
          return {
            summary: "Choose a conditional commitment",
            issues: [
              {
                id: "issue-1",
                question: "Which concurrency promise is supportable?",
                stance: "conditional",
                rationale: "Hotspot capacity requires a benchmark",
                evidence: [],
              },
            ],
            recommendations: [],
            risks: [],
          }
        if (input.agent === "council-synthesizer")
          return {
            status: "completed",
            summary: "Promise global concurrency and gate hotspot claims",
            consensus: ["Separate the two commitments"],
            disagreements: [],
            recommendations: [],
            risks: [],
          }
        return nodeResult
      })

      const output = yield* HeavyWorkflow.run(
        "Define the 1,000-player launch contract",
        parent,
        { ...context, toolCallID: "call-auto-council" },
        {
          maxDepth: 1,
          tasksPerNode: 4,
          maxNodes: 8,
          concurrency: 4,
          childTimeoutMs: 60_000,
          onFailure: "keep",
          councilMode: "auto",
          council: {
            perspectives: 2,
            concurrency: 2,
            childTimeoutMs: 60_000,
            debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
            models: {},
          },
          models: {},
        },
        runtime,
      )

      expect(output.council?.status).toBe("completed")
      expect(output.nodes[0]?.council_routing).toEqual({
        mode: "auto",
        outcome: "triggered",
        reason: "Global concurrency and hotspot concurrency imply different commitments.",
        question: "Should the launch contract promise global or same-hotspot concurrency?",
        signals: ["competing_objectives", "consequential_decision", "assumption_sensitive"],
      })
    }),
  )

  it.effect("honors a completed worker's narrow Council request", () =>
    Effect.gen(function* () {
      const runtime = makeRuntime((input) => {
        if (input.agent === "heavy-planner")
          return {
            rationale: "Collect evidence before deciding whether debate is needed",
            tasks: [
              {
                id: "evidence",
                title: "Evidence",
                objective: "Inspect the disputed evidence",
                capability: "read",
                mode: "leaf",
              },
            ],
          }
        if (input.agent === "heavy-reader")
          return {
            ...nodeResult,
            council_request: {
              recommended: true,
              reason: "The evidence supports two defensible interpretations.",
              question: "Which interpretation should govern the recommendation?",
              signals: ["multiple_interpretations"],
            },
          }
        if (input.agent === "council-planner")
          return {
            rationale: "Compare the interpretations",
            issues: [{ id: "interpretation", question: "Which interpretation should govern?" }],
            perspectives: [],
          }
        if (input.agent === "council-perspective")
          return {
            summary: "Prefer the conditional interpretation",
            issues: [
              {
                id: "issue-1",
                question: "Which interpretation should govern?",
                stance: "conditional",
                rationale: "The evidence is incomplete",
                evidence: [],
              },
            ],
            recommendations: [],
            risks: [],
          }
        if (input.agent === "council-synthesizer")
          return {
            status: "completed",
            summary: "Use the conditional interpretation",
            consensus: [],
            disagreements: [],
            recommendations: [],
            risks: [],
          }
        return nodeResult
      })

      const output = yield* HeavyWorkflow.run(
        "Interpret disputed evidence",
        parent,
        { ...context, toolCallID: "call-worker-council" },
        {
          maxDepth: 1,
          tasksPerNode: 2,
          maxNodes: 4,
          concurrency: 2,
          childTimeoutMs: 60_000,
          onFailure: "keep",
          councilMode: "auto",
          council: {
            perspectives: 2,
            concurrency: 2,
            childTimeoutMs: 60_000,
            debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
            models: {},
          },
          models: {},
        },
        runtime,
      )

      expect(output.council?.status).toBe("completed")
      expect(output.nodes[0]?.council_routing).toMatchObject({
        outcome: "triggered",
        question: "Which interpretation should govern the recommendation?",
        signals: ["multiple_interpretations", "worker_requested"],
      })
    }),
  )

  it.effect("runs a deterministic Council review when Heavy council mode is required", () =>
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
            rationale: "challenge the evidence",
            issues: [{ id: "decision", question: "Is the recommendation sufficiently supported?" }],
            perspectives: [
              { id: "support", title: "Support", instructions: "Test the supporting evidence." },
              { id: "risk", title: "Risk", instructions: "Find unsupported assumptions." },
            ],
          }
        if (input.agent === "council-perspective")
          return {
            perspective_id: "ignored",
            summary: "Conditional support",
            issues: [
              {
                id: "issue-1",
                question: "Is the recommendation sufficiently supported?",
                stance: "conditional",
                rationale: "Validate the capacity assumptions",
                evidence: ["https://example.com/capacity"],
              },
            ],
            recommendations: ["Validate assumptions"],
            risks: ["Capacity uncertainty"],
          }
        if (input.agent === "council-synthesizer")
          return {
            status: "completed",
            summary: "Proceed after validating capacity",
            consensus: ["Validation is required"],
            disagreements: [],
            recommendations: ["Run a capacity test"],
            risks: ["Unverified estimates"],
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
          councilMode: "required",
          council: {
            perspectives: 2,
            concurrency: 2,
            childTimeoutMs: 60_000,
            debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
            models: {},
          },
          models: {},
        },
        runtime,
      )

      expect(output.council?.status).toBe("completed")
      expect(agents.filter((agent) => agent === "council-perspective")).toHaveLength(2)
      expect(prompts.find((prompt) => prompt.includes("Council review:"))).toContain(
        "Proceed after validating capacity",
      )
    }),
  )

  it.effect("reviews every recursive Heavy synthesis when Council policy is synthesis", () =>
    Effect.gen(function* () {
      let plans = 0
      let councilPlans = 0
      const runtime = makeRuntime((input) => {
        if (input.agent === "heavy-planner") {
          plans++
          return {
            rationale: `plan ${plans}`,
            tasks: [
              {
                id: plans === 1 ? "branch" : "leaf",
                title: plans === 1 ? "Recursive branch" : "Evidence leaf",
                objective: plans === 1 ? "Investigate one bounded branch" : "Collect the branch evidence",
                capability: "read",
                mode: plans === 1 ? "recurse" : "leaf",
                depends_on: [],
              },
            ],
          }
        }
        if (input.agent === "council-planner") {
          councilPlans++
          return {
            rationale: "Challenge the synthesis",
            issues: [{ id: "evidence", question: "Is the evidence sufficient?" }],
            perspectives: [],
          }
        }
        if (input.agent === "council-perspective")
          return {
            perspective_id: "ignored",
            summary: "Proceed conditionally",
            issues: [
              {
                id: "issue-1",
                question: "Is the evidence sufficient?",
                stance: "conditional",
                rationale: "Validate the assumptions",
                evidence: [],
              },
            ],
            recommendations: [],
            risks: [],
          }
        if (input.agent === "council-synthesizer")
          return {
            status: "completed",
            summary: "Proceed conditionally",
            consensus: ["Validate first"],
            disagreements: [],
            recommendations: [],
            risks: [],
          }
        return nodeResult
      })

      const output = yield* HeavyWorkflow.run(
        "Assess one recursive architecture branch",
        parent,
        context,
        {
          maxDepth: 2,
          tasksPerNode: 2,
          maxNodes: 8,
          concurrency: 2,
          childTimeoutMs: 60_000,
          onFailure: "keep",
          councilMode: "synthesis",
          council: {
            perspectives: 2,
            concurrency: 2,
            childTimeoutMs: 60_000,
            debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
            models: {},
          },
          models: {},
        },
        runtime,
      )

      expect(output.status).toBe("completed")
      expect(councilPlans).toBe(2)
      expect(output.nodes.map((node) => node.depth)).toEqual([0, 1, 2])
    }),
  )

  it.live("passes complete Heavy reports through Council and back into Heavy synthesis", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const execution = yield* WorkflowExecution.make({
            workflow: "heavy",
            objective: "Make one reviewed decision",
            sessionID: parent.id,
            toolCallID: "call-heavy-council-reports",
            directory: tmp.path,
            reportDirectory: ".opencode/reports",
            maxDepth: 3,
            maxWorkflows: 8,
            delegates: {
              heavy: new Set(["heavy", "council"]),
              council: new Set(["heavy", "council"]),
            },
          })
          let councilPlannerPrompt = ""
          let heavySynthesisPrompt = ""
          const childID = (_parentID: SessionV2.ID, id: string) => SessionV2.ID.make(`ses_${id}`)
          const runtime: WorkflowRuntime.Interface = {
            childID,
            execution: () => execution,
            runChild: <Result extends Tool.SchemaType<any>>(input: WorkflowRuntime.ChildInput<Result>) =>
              Effect.gen(function* () {
                if (input.agent === "heavy-planner")
                  return Schema.decodeUnknownSync(input.result)({
                    rationale: "collect evidence before review",
                    tasks: [
                      {
                        id: "research",
                        title: "Research",
                        objective: "Collect decision evidence",
                        capability: "read",
                        mode: "leaf",
                        depends_on: [],
                      },
                    ],
                  })
                const sessionID = childID(input.parentID, input.id)
                if (input.agent === "heavy-reader") {
                  yield* Effect.promise(() => writeArtifact(execution, sessionID, "HEAVY_FULL_EVIDENCE_FOR_COUNCIL"))
                  return Schema.decodeUnknownSync(input.result)(nodeResult)
                }
                if (input.agent === "council-planner") {
                  councilPlannerPrompt = input.prompt
                  return Schema.decodeUnknownSync(input.result)({
                    rationale: "challenge the evidence",
                    issues: [{ id: "decision", question: "Is the evidence sufficient?" }],
                    perspectives: [{ id: "risk", title: "Risk", instructions: "Find unsupported assumptions." }],
                  })
                }
                if (input.agent === "council-perspective") {
                  yield* Effect.promise(() => writeArtifact(execution, sessionID, "COUNCIL_FULL_PERSPECTIVE"))
                  return Schema.decodeUnknownSync(input.result)({
                    perspective_id: "ignored",
                    summary: "conditional",
                    issues: [
                      {
                        id: "issue-1",
                        question: "Is the evidence sufficient?",
                        stance: "conditional",
                        rationale: "verify one assumption",
                        evidence: [],
                      },
                    ],
                    recommendations: [],
                    risks: [],
                  })
                }
                if (input.agent === "council-synthesizer") {
                  yield* Effect.promise(() => writeArtifact(execution, sessionID, "COUNCIL_FULL_SYNTHESIS"))
                  return Schema.decodeUnknownSync(input.result)({
                    status: "completed",
                    summary: "conditional approval",
                    consensus: [],
                    disagreements: [],
                    recommendations: [],
                    risks: [],
                  })
                }
                if (input.title === "Heavy synthesis: Heavy root") heavySynthesisPrompt = input.prompt
                return Schema.decodeUnknownSync(input.result)(nodeResult)
              }),
            progress: () => Effect.void,
          }

          yield* HeavyWorkflow.run(
            "Make one reviewed decision",
            parent,
            { ...context, execution },
            {
              maxDepth: 1,
              tasksPerNode: 2,
              maxNodes: 8,
              concurrency: 2,
              childTimeoutMs: 60_000,
              onFailure: "keep",
              councilMode: "always",
              council: {
                perspectives: 1,
                concurrency: 1,
                childTimeoutMs: 60_000,
                debate: { mode: "off", topics: 1, participants: 1, rounds: 1 },
                models: {},
              },
              models: {},
            },
            runtime,
          )

          expect(councilPlannerPrompt).toContain("HEAVY_FULL_EVIDENCE_FOR_COUNCIL")
          expect(heavySynthesisPrompt).toContain("COUNCIL_FULL_SYNTHESIS")
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("tracks an always-on Council review as a delegated workflow", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const execution = yield* WorkflowExecution.make({
            workflow: "heavy",
            objective: "Assess the architecture",
            sessionID: parent.id,
            toolCallID: "call-tracked-council",
            directory: tmp.path,
            reportDirectory: ".opencode/reports",
            maxDepth: 3,
            maxWorkflows: 8,
            delegates: {
              heavy: new Set(["heavy", "council"]),
              council: new Set(["heavy", "council"]),
            },
          })
          const runtime = makeRuntime((input) => {
            if (input.agent === "heavy-planner")
              return {
                rationale: "collect evidence",
                tasks: [
                  {
                    id: "research",
                    title: "Research",
                    objective: "Collect evidence",
                    capability: "read",
                    mode: "leaf",
                    depends_on: [],
                  },
                ],
              }
            if (input.agent === "council-planner")
              return {
                rationale: "challenge assumptions",
                issues: [{ id: "support", question: "Is the evidence sufficient?" }],
                perspectives: [],
              }
            if (input.agent === "council-perspective")
              return {
                perspective_id: "ignored",
                summary: "Conditional",
                issues: [
                  {
                    id: "issue-1",
                    question: "Is the evidence sufficient?",
                    stance: "conditional",
                    rationale: "Validate first",
                    evidence: [],
                  },
                ],
                recommendations: [],
                risks: [],
              }
            if (input.agent === "council-synthesizer")
              return {
                status: "completed",
                summary: "Proceed conditionally",
                consensus: ["Validate first"],
                disagreements: [],
                recommendations: [],
                risks: [],
              }
            return nodeResult
          })

          const output = yield* HeavyWorkflow.run(
            "Assess the architecture",
            parent,
            { ...context, execution },
            {
              maxDepth: 1,
              tasksPerNode: 2,
              maxNodes: 4,
              concurrency: 2,
              childTimeoutMs: 60_000,
              onFailure: "keep",
              councilMode: "always",
              council: {
                perspectives: 2,
                concurrency: 2,
                childTimeoutMs: 60_000,
                debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
                models: {},
              },
              models: {},
            },
            runtime,
          )
          const delegated = yield* WorkflowExecution.manifest(execution)

          expect(output.council?.report_path).toEndWith("COUNCIL_REPORT.md")
          expect(delegated).toEqual([
            expect.objectContaining({
              workflow: "council",
              status: "partial",
              artifact_status: "missing",
              depth: 1,
            }),
          ])
          expect(yield* Effect.promise(() => Bun.file(output.council?.report_path ?? "").exists())).toBe(true)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.effect("supports reciprocal Heavy to Council to Heavy to Council recursion under one budget", () =>
    Effect.gen(function* () {
      const root = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Root objective",
        sessionID: parent.id,
        toolCallID: "call-root",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 4,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const council = yield* WorkflowExecution.delegate(root, {
        workflow: "council",
        objective: "Challenge the design",
        sessionID: SessionV2.ID.make("ses_heavy_child"),
        toolCallID: "call-council",
      })
      const heavy = yield* WorkflowExecution.delegate(council, {
        workflow: "heavy",
        objective: "Investigate the disputed point",
        sessionID: SessionV2.ID.make("ses_council_child"),
        toolCallID: "call-heavy",
      })
      const nestedCouncil = yield* WorkflowExecution.delegate(heavy, {
        workflow: "council",
        objective: "Debate the evidence gathered for the disputed point",
        sessionID: SessionV2.ID.make("ses_nested_heavy_child"),
        toolCallID: "call-nested-council",
      })
      const exhausted = yield* WorkflowExecution.delegate(root, {
        workflow: "heavy",
        objective: "Exceed the shared budget",
        sessionID: SessionV2.ID.make("ses_other_child"),
        toolCallID: "call-exhausted",
      }).pipe(Effect.flip)

      expect(exhausted.message).toBe("Workflow delegation budget exhausted")
      expect(nestedCouncil.depth).toBe(3)
      expect(WorkflowExecution.forChild(heavy, "heavy-writer").writer).not.toBe(heavy.writer)

      yield* WorkflowExecution.complete(nestedCouncil, {
        status: "completed",
        summary: "Deep Council result",
        rootSessionID: SessionV2.ID.make("ses_deep_council"),
      })
      yield* WorkflowExecution.complete(heavy, {
        status: "completed",
        summary: "Deep Heavy result",
        rootSessionID: SessionV2.ID.make("ses_nested_heavy"),
      })
      yield* WorkflowExecution.complete(council, {
        status: "partial",
        summary: "Council result with disagreement",
        rootSessionID: SessionV2.ID.make("ses_nested_council"),
      })

      expect(yield* WorkflowExecution.manifest(root)).toEqual([
        expect.objectContaining({
          workflow: "council",
          depth: 1,
          status: "partial",
          root_session_id: "ses_nested_council",
        }),
        expect.objectContaining({
          workflow: "heavy",
          depth: 2,
          status: "completed",
          root_session_id: "ses_nested_heavy",
        }),
        expect.objectContaining({
          workflow: "council",
          depth: 3,
          status: "completed",
          root_session_id: "ses_deep_council",
        }),
      ])
    }),
  )

  it.effect("prevents a read-only Research root from reaching Heavy through Council", () =>
    Effect.gen(function* () {
      const root = yield* WorkflowExecution.make({
        workflow: "research",
        access: "read",
        objective: "Investigate launch risks",
        sessionID: parent.id,
        toolCallID: "call-read-research",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 2,
        maxWorkflows: 3,
        delegates: {
          research: new Set(["research", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const council = yield* WorkflowExecution.delegate(root, {
        workflow: "council",
        objective: "Assess disputed storage tradeoffs",
        sessionID: SessionV2.ID.make("ses_research_council"),
        toolCallID: "call-research-council",
      })
      const failure = yield* WorkflowExecution.delegate(council, {
        workflow: "heavy",
        objective: "Implement a storage experiment",
        sessionID: SessionV2.ID.make("ses_research_heavy"),
        toolCallID: "call-research-heavy",
      }).pipe(Effect.flip)

      expect(WorkflowExecution.access(root)).toBe("read")
      expect(failure.message).toBe("Read-only workflow roots cannot delegate to Heavy")
    }),
  )

  it.effect("allows location readers to overlap while keeping writers exclusive", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* WorkflowExecution.makeAccessCoordinator()
        const firstStarted = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const writeStarted = yield* Deferred.make<void>()
        const first = yield* coordinator
          .withAccess(
            parent.location,
            "read",
            Deferred.succeed(firstStarted, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst))),
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(firstStarted)
        const second = yield* coordinator
          .withAccess(parent.location, "read", Deferred.succeed(secondStarted, undefined))
          .pipe(Effect.forkChild)
        yield* Effect.yieldNow
        expect(yield* Deferred.isDone(secondStarted)).toBe(true)

        const writer = yield* coordinator
          .withAccess(parent.location, "write", Deferred.succeed(writeStarted, undefined))
          .pipe(Effect.forkChild)
        yield* Effect.yieldNow
        expect(yield* Deferred.isDone(writeStarted)).toBe(false)

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        yield* Fiber.join(writer)
        expect(yield* Deferred.isDone(writeStarted)).toBe(true)
      }),
    ),
  )

  it.effect("propagates nested progress and preserves rich terminal session records at the root", () =>
    Effect.gen(function* () {
      const updates: WorkflowRuntime.Progress[] = []
      const root = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Assess the architecture",
        sessionID: parent.id,
        toolCallID: "call-session-registry",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
        onProgress: (input) =>
          Effect.sync(() => {
            updates.push(input)
          }),
      })
      const council = yield* WorkflowExecution.delegate(root, {
        workflow: "council",
        objective: "Debate the local storage choice",
        sessionID: SessionV2.ID.make("ses_heavy_synthesis"),
        toolCallID: "call-nested-progress",
      })
      const stage = WorkflowSchema.SessionStage.make({
        session_id: SessionV2.ID.make("ses_council_perspective"),
        parent_session_id: SessionV2.ID.make("ses_council_plan"),
        run_id: council.id,
        parent_run_id: council.parentID,
        workflow: "council",
        workflow_depth: council.depth,
        status: "timed_out",
        agent: "council-perspective",
        title: "Council risk perspective",
        stage: "perspective",
        issue: "storage",
        report_path: WorkflowExecution.stageReportPath(council, SessionV2.ID.make("ses_council_perspective")),
        started_at: 100,
        updated_at: 1_100,
        elapsed_ms: 1_000,
        error: "Perspective timed out",
      })
      yield* WorkflowExecution.recordStage(council, stage)
      yield* WorkflowExecution.progress(council, {
        structured: {
          workflow: "council",
          session_id: stage.session_id,
          child_status: stage.status,
        },
        text: "Council risk perspective timed out",
      })

      expect(updates).toEqual([
        expect.objectContaining({
          text: "Council risk perspective timed out",
          structured: expect.objectContaining({ session_id: "ses_council_perspective" }),
        }),
      ])
      expect(yield* WorkflowExecution.sessions(root)).toEqual([
        expect.objectContaining({
          session_id: "ses_council_perspective",
          parent_session_id: "ses_council_plan",
          run_id: council.id,
          parent_run_id: root.id,
          workflow: "council",
          workflow_depth: 1,
          status: "timed_out",
          error: "Perspective timed out",
        }),
      ])
    }),
  )

  it.effect("coordinates exact and conservative semantic Council duplicates by evidence set", () =>
    Effect.gen(function* () {
      const root = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Assess the architecture",
        sessionID: parent.id,
        toolCallID: "call-council-coordination",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        maxConcurrency: 1,
        debateDeduplication: "semantic",
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const first = yield* WorkflowExecution.claimCouncil(root, {
        objective: "Should regional shards isolate the dense player hotspot safely?",
        issueKey: "dense-hotspot-sharding",
        artifactPaths: ["/reports/server.md", "/reports/economics.md"],
      })
      const exact = yield* WorkflowExecution.claimCouncil(root, {
        objective: "Which hotspot architecture should launch?",
        issueKey: "dense-hotspot-sharding",
        artifactPaths: ["/reports/economics.md", "/reports/server.md"],
      })
      const differentEvidence = yield* WorkflowExecution.claimCouncil(root, {
        objective: "Should regional shards isolate the dense player hotspot safely?",
        issueKey: "dense-hotspot-sharding",
        artifactPaths: ["/reports/client.md"],
      })
      const semanticFirst = yield* WorkflowExecution.claimCouncil(root, {
        objective: "Should regional shards isolate the dense player hotspot safely?",
        artifactPaths: ["/reports/semantic.md"],
      })
      const semanticDuplicate = yield* WorkflowExecution.claimCouncil(root, {
        objective: "Should regional shards isolate the dense player hotspot safely today?",
        artifactPaths: ["/reports/semantic.md"],
      })
      const ownerRun = yield* WorkflowExecution.delegate(root, {
        workflow: "council",
        objective: "Resolve the dense hotspot sharding dispute",
        sessionID: SessionV2.ID.make("ses_owner_council"),
        toolCallID: "call-owner-council",
      })
      yield* WorkflowExecution.bindCouncil(root, first.claim, ownerRun.id)
      const descendantDuplicate = yield* Effect.result(
        WorkflowExecution.claimCouncil(ownerRun, {
          objective: "Which hotspot architecture should launch?",
          issueKey: "dense-hotspot-sharding",
          artifactPaths: ["/reports/economics.md", "/reports/server.md"],
        }),
      )
      const narrowerDescendant = yield* WorkflowExecution.claimCouncil(ownerRun, {
        objective: "Which consistency boundary should the hotspot migration protocol use?",
        issueKey: "hotspot-migration-consistency",
        artifactPaths: ["/reports/economics.md", "/reports/server.md"],
      })

      expect(first.owner).toBe(true)
      expect(exact.owner).toBe(false)
      expect(differentEvidence.owner).toBe(true)
      expect(semanticFirst.owner).toBe(true)
      expect(semanticDuplicate.owner).toBe(false)
      expect(Result.isFailure(descendantDuplicate)).toBe(true)
      if (Result.isFailure(descendantDuplicate))
        expect(descendantDuplicate.failure.message).toContain("materially narrower dispute")
      expect(narrowerDescendant.owner).toBe(true)

      const output = WorkflowSchema.CouncilOutput.make({
        workflow: "council",
        status: "completed",
        summary: "Use regional shards",
        root_session_id: SessionV2.ID.make("ses_council_plan"),
        synthesis_session_id: SessionV2.ID.make("ses_council_synthesis"),
        perspectives: [],
        debate: [],
        consensus: ["Use regional shards"],
        disagreements: [],
        recommendations: [],
        risks: [],
      })
      const waiter = WorkflowExecution.forChild(root, "heavy-synthesizer")
      const owner = WorkflowExecution.forChild(root, "council-synthesizer")
      const [shared] = yield* WorkflowExecution.withWorker(
        waiter,
        Effect.all(
          [
            WorkflowExecution.awaitCouncil(waiter, exact.claim),
            WorkflowExecution.withWorker(
              owner,
              Effect.yieldNow.pipe(Effect.flatMap(() => WorkflowExecution.completeCouncil(first.claim, output))),
            ),
          ],
          { concurrency: "unbounded" },
        ),
      )
      expect(shared).toBe(output)
    }),
  )

  it.effect("reuses overlapping semantic Councils before enforcing the distinct Council budget", () =>
    Effect.gen(function* () {
      const root = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Assess launch readiness",
        sessionID: parent.id,
        toolCallID: "call-council-budget",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        maxCouncils: 1,
        debateDeduplication: "semantic",
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const first = yield* WorkflowExecution.claimCouncil(root, {
        objective: "Should the regional shard architecture launch safely?",
        artifactPaths: ["/reports/server.md", "/reports/economics.md"],
      })
      const overlapping = yield* WorkflowExecution.claimCouncil(root, {
        objective: "Should regional shard architecture launch safely today?",
        artifactPaths: ["/reports/server.md", "/reports/stress.md"],
      })
      const exhausted = yield* WorkflowExecution.claimCouncil(root, {
        objective: "Should the pricing model use a subscription?",
        artifactPaths: ["/reports/pricing.md"],
      }).pipe(Effect.flip)

      expect(first.owner).toBe(true)
      expect(overlapping.owner).toBe(false)
      expect(exhausted.message).toBe("Council budget exhausted after 1 distinct invocations")
    }),
  )

  it.live("enforces one global child-session limit without deadlocking nested delegation", () =>
    Effect.gen(function* () {
      const root = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Bound the complete workflow",
        sessionID: parent.id,
        toolCallID: "call-global-concurrency",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        maxConcurrency: 2,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      let active = 0
      let maximum = 0
      yield* Effect.forEach(
        Array.from({ length: 5 }, () => WorkflowExecution.forChild(root, "heavy-reader")),
        (child) =>
          WorkflowExecution.withWorker(
            child,
            Effect.gen(function* () {
              active++
              maximum = Math.max(maximum, active)
              yield* Effect.promise(() => Bun.sleep(10))
              active--
            }),
          ),
        { concurrency: "unbounded" },
      )
      expect(maximum).toBe(2)

      const serial = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Allow reentrant delegation",
        sessionID: parent.id,
        toolCallID: "call-reentrant-concurrency",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        maxConcurrency: 1,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const outer = WorkflowExecution.forChild(serial, "heavy-reader")
      yield* WorkflowExecution.withWorker(
        outer,
        Effect.gen(function* () {
          const council = yield* WorkflowExecution.delegate(outer, {
            workflow: "council",
            objective: "Debate one bounded implementation choice",
            sessionID: SessionV2.ID.make("ses_outer_worker"),
            toolCallID: "call-nested-council",
          })
          yield* WorkflowExecution.withWorker(
            WorkflowExecution.forChild(council, "council-perspective"),
            Effect.promise(() => Bun.sleep(5)),
          )
          yield* WorkflowExecution.complete(council, {
            status: "completed",
            summary: "Nested Council completed",
            rootSessionID: SessionV2.ID.make("ses_nested_council"),
          })
        }),
      )
      expect(yield* WorkflowExecution.manifest(serial)).toEqual([
        expect.objectContaining({ workflow: "council", status: "completed" }),
      ])
    }),
  )

  it.effect("rejects delegation beyond the inherited cross-workflow depth", () =>
    Effect.gen(function* () {
      const root = yield* WorkflowExecution.make({
        workflow: "council",
        objective: "Root question",
        sessionID: parent.id,
        toolCallID: "call-root",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 1,
        maxWorkflows: 8,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const heavy = yield* WorkflowExecution.delegate(root, {
        workflow: "heavy",
        objective: "Implement the recommendation",
        sessionID: SessionV2.ID.make("ses_council_child"),
        toolCallID: "call-heavy",
      })
      const failure = yield* WorkflowExecution.delegate(heavy, {
        workflow: "council",
        objective: "Review the implementation",
        sessionID: SessionV2.ID.make("ses_heavy_child"),
        toolCallID: "call-council",
      }).pipe(Effect.flip)

      expect(failure.message).toBe("Workflow delegation depth 2 exceeds the configured maximum 1")
    }),
  )

  it.effect("rejects delegated workflows that repeat the current objective", () =>
    Effect.gen(function* () {
      const root = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Assess the complete architecture",
        sessionID: parent.id,
        toolCallID: "call-root",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const failure = yield* WorkflowExecution.delegate(root, {
        workflow: "heavy",
        objective: "  Assess the complete architecture. ",
        sessionID: SessionV2.ID.make("ses_child"),
        toolCallID: "call-copy",
      }).pipe(Effect.flip)
      const nearCopy = yield* WorkflowExecution.delegate(root, {
        workflow: "council",
        objective: "Carefully assess the complete architecture now",
        sessionID: SessionV2.ID.make("ses_child"),
        toolCallID: "call-near-copy",
      }).pipe(Effect.flip)

      expect(failure.message).toContain("strict subproblem")
      expect(nearCopy.message).toContain("strict subproblem")
    }),
  )

  it.effect("keeps unfinished delegated sessions visible in the manifest", () =>
    Effect.gen(function* () {
      const root = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Assess the architecture",
        sessionID: parent.id,
        toolCallID: "call-root",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const council = yield* WorkflowExecution.delegate(root, {
        workflow: "council",
        objective: "Debate the disputed storage choice",
        sessionID: SessionV2.ID.make("ses_child"),
        toolCallID: "call-council",
      })
      yield* WorkflowExecution.recordSession(council, SessionV2.ID.make("ses_council_plan"))
      yield* WorkflowExecution.recordSession(council, SessionV2.ID.make("ses_council_debate"))

      expect(yield* WorkflowExecution.manifest(root)).toEqual([
        expect.objectContaining({
          workflow: "council",
          status: "failed",
          root_session_id: "ses_council_plan",
          session_ids: ["ses_council_plan", "ses_council_debate"],
          summary: "Workflow ended before reaching a terminal state",
        }),
      ])
    }),
  )

  it.effect("resumes the parent lease and audits a delegated workflow failure", () =>
    Effect.gen(function* () {
      const root = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Assess the architecture",
        sessionID: parent.id,
        toolCallID: "call-delegated-failure",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        maxConcurrency: 1,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      yield* WorkflowExecution.withWorker(
        root,
        Effect.gen(function* () {
          const council = yield* WorkflowExecution.delegate(root, {
            workflow: "council",
            objective: "Challenge the disputed transport choice",
            sessionID: SessionV2.ID.make("ses_delegated_failure"),
            toolCallID: "call-failing-council",
          })
          yield* WorkflowExecution.recordSession(council, SessionV2.ID.make("ses_failing_council"))
          yield* WorkflowExecution.fail(council, "Council provider failed during debate")
        }),
      )

      expect(yield* WorkflowExecution.manifest(root)).toEqual([
        expect.objectContaining({
          workflow: "council",
          status: "failed",
          summary: "Council provider failed during debate",
          root_session_id: "ses_failing_council",
        }),
      ])
    }),
  )

  it.live("writes standalone Heavy and Council Markdown reports", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const heavyPath = path.join(tmp.path, "heavy", "HEAVY_REPORT.md")
          const heavyTracePath = path.join(tmp.path, "heavy", "HEAVY_TRACE.md")
          const councilPath = path.join(tmp.path, "council", "COUNCIL_REPORT.md")
          const councilTracePath = path.join(tmp.path, "council", "COUNCIL_TRACE.md")
          const failurePath = path.join(tmp.path, "failed", "HEAVY_REPORT.md")
          const partialPath = path.join(tmp.path, "partial", "HEAVY_REPORT.md")
          const partialTracePath = path.join(tmp.path, "partial", "HEAVY_TRACE.md")
          const artifactPath = path.join(tmp.path, "stages", "research.md")
          const failedSourcePath = path.join(tmp.path, "stages", "failed-source.md")
          const heavySynthesisPath = path.join(tmp.path, "stages", "heavy-synthesis.md")
          const councilSynthesisPath = path.join(tmp.path, "stages", "council-synthesis.md")
          const perspectivePath = path.join(tmp.path, "stages", "perspective.md")
          const debatePath = path.join(tmp.path, "stages", "debate.md")
          const nestedSynthesisPath = path.join(tmp.path, "stages", "nested-synthesis.md")
          const delegation = WorkflowSchema.Delegation.make({
            id: "run-council",
            parent_id: "run-heavy",
            parent_session_id: parent.id,
            workflow: "council",
            depth: 1,
            objective: "Review the architecture",
            status: "completed",
            summary: "Proceed with safeguards",
            root_session_id: SessionV2.ID.make("ses_council_root"),
            report_path: councilPath,
          })
          const heavy = WorkflowSchema.HeavyOutput.make({
            workflow: "heavy",
            status: "completed",
            summary: "Implemented and validated",
            root_session_id: SessionV2.ID.make("ses_heavy_root"),
            report_path: heavyPath,
            delegations: [delegation],
            nodes: [
              WorkflowSchema.HeavyNode.make({
                id: "heavy-root",
                session_id: SessionV2.ID.make("ses_heavy_synthesis"),
                planning_session_id: SessionV2.ID.make("ses_heavy_root"),
                depth: 0,
                title: "Heavy root",
                objective: "Implement the feature",
                capability: "write",
                report_path: heavySynthesisPath,
                status: "completed",
                summary: "Implemented and validated",
                decisions: ["Use inherited budgets"],
                findings: [{ claim: "Recursion is bounded", evidence: ["https://example.com/evidence"] }],
                changed_files: ["src/workflow.ts"],
                validation: ["bun test"],
                risks: ["Wide runs can be expensive"],
                follow_up: ["Monitor usage"],
                coverage: [
                  {
                    title: "Research",
                    report_path: artifactPath,
                    received: true,
                    used: ["Recursion is bounded"],
                    rejected: [],
                    unresolved: [],
                  },
                ],
              }),
              WorkflowSchema.HeavyNode.make({
                id: "heavy-research",
                parent_id: "heavy-root",
                session_id: SessionV2.ID.make("ses_heavy_research"),
                depth: 1,
                title: "Research",
                objective: "Research the implementation",
                capability: "read",
                report_path: artifactPath,
                status: "completed",
                summary: "Completed the research",
                decisions: [],
                findings: [],
                changed_files: [],
                validation: [],
                risks: [],
                follow_up: [],
              }),
              WorkflowSchema.HeavyNode.make({
                id: "heavy-recursive",
                parent_id: "heavy-root",
                session_id: SessionV2.ID.make("ses_heavy_recursive_synthesis"),
                planning_session_id: SessionV2.ID.make("ses_heavy_recursive_plan"),
                depth: 1,
                title: "Recursive investigation",
                objective: "Investigate one branch recursively",
                capability: "read",
                report_path: nestedSynthesisPath,
                status: "completed",
                summary: "Synthesized the recursive branch",
                decisions: [],
                findings: [],
                changed_files: [],
                validation: [],
                risks: [],
                follow_up: [],
              }),
            ],
          })
          const council = WorkflowSchema.CouncilOutput.make({
            workflow: "council",
            status: "completed",
            summary: "Proceed with safeguards",
            root_session_id: SessionV2.ID.make("ses_council_root"),
            synthesis_session_id: SessionV2.ID.make("ses_council_synthesis"),
            synthesis_report_path: councilSynthesisPath,
            report_path: councilPath,
            perspectives: [
              {
                perspective_id: "risk",
                session_id: SessionV2.ID.make("ses_council_risk"),
                report_path: perspectivePath,
                summary: "Analyze downside",
                issues: [],
                recommendations: [],
                risks: [],
              },
            ],
            debate: [
              {
                issue_id: "scope",
                perspective_id: "risk",
                round: 1,
                stance: "conditional",
                argument: "Proceed within a bounded scope",
                concessions: [],
                rebuttals: [],
                evidence: [],
                session_id: SessionV2.ID.make("ses_council_debate"),
                report_path: debatePath,
              },
            ],
            consensus: ["Bound recursion"],
            disagreements: [{ issue_id: "scope", question: "How wide?", positions: ["4", "8"] }],
            recommendations: ["Start conservatively"],
            risks: ["Cost"],
            coverage: [
              {
                title: "Risk perspective",
                received: true,
                used: ["Bound recursion"],
                rejected: [],
                unresolved: ["Maximum width needs measurement"],
              },
            ],
          })

          yield* Effect.promise(() =>
            Bun.write(
              artifactPath,
              "# Research\n\n## Subject-shaped evidence\n\nTHICK_HEAVY_CHILD_DETAIL\n\nVerified source: https://example.com/artifact-source.",
            ),
          )
          yield* Effect.promise(() =>
            Bun.write(
              heavySynthesisPath,
              "# Heavy synthesis\n\n## Subject-chosen outline\n\nADAPTIVE_HEAVY_MAIN_BODY\n\nEvidence: https://example.com/evidence.",
            ),
          )
          yield* Effect.promise(() =>
            Bun.write(
              councilSynthesisPath,
              "# Council synthesis\n\n## Deliberation-shaped outline\n\nADAPTIVE_COUNCIL_MAIN_BODY\n\nThe Council recommends bounded recursion. A minority asks: How wide?",
            ),
          )
          yield* Effect.promise(() =>
            Bun.write(
              perspectivePath,
              "# Risk perspective\n\n## Complete position\n\nTHICK_COUNCIL_PERSPECTIVE_DETAIL",
            ),
          )
          yield* Effect.promise(() =>
            Bun.write(debatePath, "# Scope debate\n\n## Complete exchange\n\nTHICK_COUNCIL_DEBATE_DETAIL"),
          )
          yield* Effect.promise(() =>
            Bun.write(
              nestedSynthesisPath,
              "# Recursive synthesis\n\n## Complete recursive treatment\n\nTHICK_NESTED_SYNTHESIS_DETAIL",
            ),
          )
          yield* Effect.promise(() =>
            Bun.write(failedSourcePath, "Failed to fetch https://example.com/unavailable-source during verification."),
          )
          yield* Effect.promise(() => WorkflowReport.writeCouncil("Review the architecture", council, councilPath))
          yield* Effect.promise(() =>
            WorkflowReport.writeHeavy(
              "Implement the feature",
              WorkflowSchema.HeavyOutput.make({ ...heavy, council }),
              heavyPath,
            ),
          )
          yield* Effect.promise(() =>
            WorkflowReport.writeHeavy(
              "Implement the feature with partial evidence",
              WorkflowSchema.HeavyOutput.make({
                ...heavy,
                status: "partial",
                report_path: partialPath,
                nodes: [
                  { ...heavy.nodes[0], status: "partial", risks: ["One child failed"] },
                  {
                    id: "failed-child",
                    parent_id: "heavy-root",
                    session_id: SessionV2.ID.make("ses_failed_child"),
                    depth: 1,
                    title: "Unavailable benchmark",
                    objective: "Run the unavailable benchmark",
                    capability: "read",
                    status: "failed",
                    summary: "Benchmark provider was unavailable",
                    decisions: [],
                    findings: [],
                    changed_files: [],
                    validation: [],
                    risks: ["Benchmark provider was unavailable"],
                    follow_up: ["Retry the benchmark"],
                  },
                ],
              }),
              partialPath,
            ),
          )
          yield* Effect.promise(() =>
            WorkflowReport.writeFailure("heavy", "Implement the feature", "Synthesis failed", failurePath, [
              delegation,
            ]),
          )

          const heavyReport = yield* Effect.promise(() => Bun.file(heavyPath).text())
          const heavyTrace = yield* Effect.promise(() => Bun.file(heavyTracePath).text())
          const councilReport = yield* Effect.promise(() => Bun.file(councilPath).text())
          const councilTrace = yield* Effect.promise(() => Bun.file(councilTracePath).text())
          const failureReport = yield* Effect.promise(() => Bun.file(failurePath).text())
          const partialReport = yield* Effect.promise(() => Bun.file(partialPath).text())
          const partialTrace = yield* Effect.promise(() => Bun.file(partialTracePath).text())
          expect(heavyReport).toContain("# Heavy Report")
          expect(heavyReport).not.toContain("## Delegated Workflows")
          expect(heavyReport).not.toContain("## Artifact Coverage")
          expect(heavyReport).not.toContain("## Child Report Index")
          expect(heavyReport).not.toContain("## Plan Reconciliation")
          expect(heavyReport).not.toContain("Root session:")
          expect(heavyReport).toContain("https://example.com/evidence")
          expect(heavyReport).toContain("## Main Document")
          expect(heavyReport).toContain("## Contents")
          expect(heavyReport).toContain("- [Main Document](#main-document)")
          expect(heavyReport).toContain("### Subject-chosen outline")
          expect(heavyReport).not.toContain("\n# Subject-chosen outline")
          expect(heavyReport).toContain("ADAPTIVE_HEAVY_MAIN_BODY")
          expect(heavyReport).not.toContain("## Complete Subreports")
          expect(heavyReport).not.toContain("THICK_HEAVY_CHILD_DETAIL")
          expect(heavyReport).not.toContain("THICK_NESTED_SYNTHESIS_DETAIL")
          expect(heavyReport).not.toContain("THICK_COUNCIL_PERSPECTIVE_DETAIL")
          expect(heavyReport).not.toContain("THICK_COUNCIL_DEBATE_DETAIL")
          expect(heavyReport).toContain("[Research](../stages/research.md)")
          expect(heavyReport).toContain("[Recursive investigation](../stages/nested-synthesis.md)")
          expect(heavyReport).toContain("[Council review](../council/COUNCIL_REPORT.md)")
          expect(heavyTrace).toContain("# Heavy Trace")
          expect(heavyTrace).toContain("## Delegated Workflows")
          expect(heavyTrace).toContain("COUNCIL_REPORT.md")
          expect(heavyTrace).toContain("## Artifact Coverage")
          expect(heavyTrace).toContain("- Complete: **yes**")
          expect(heavyTrace).toContain("- Unaccounted artifacts: 0")
          expect(heavyTrace).toContain("Used: Recursion is bounded")
          expect(heavyTrace).toContain("## Child Report Index")
          expect(councilReport).toContain("# Council Report")
          expect(councilReport).not.toContain("## Disagreements and Minority Positions")
          expect(councilReport).not.toContain("## Perspective Reports")
          expect(councilReport).not.toContain("## Debate")
          expect(councilReport).not.toContain("## Artifact Coverage")
          expect(councilReport).toContain("How wide?")
          expect(councilReport).not.toContain("Unresolved: Maximum width needs measurement")
          expect(councilReport).toContain("ADAPTIVE_COUNCIL_MAIN_BODY")
          expect(councilReport).not.toContain("THICK_COUNCIL_PERSPECTIVE_DETAIL")
          expect(councilReport).not.toContain("THICK_COUNCIL_DEBATE_DETAIL")
          expect(councilReport).toContain("[Perspective: risk](../stages/perspective.md)")
          expect(councilReport).toContain("[Debate: scope — risk, round 1](../stages/debate.md)")
          expect(councilTrace).toContain("# Council Trace")
          expect(councilTrace).toContain("## Disagreements and Minority Positions")
          expect(councilTrace).toContain("## Perspective Reports")
          expect(councilTrace).toContain("## Debate")
          expect(councilTrace).toContain("Unresolved: Maximum width needs measurement")
          expect(failureReport).toContain("Synthesis failed")
          expect(failureReport).toContain("COUNCIL_REPORT.md")
          expect(partialReport).not.toContain("- Status: **partial**")
          expect(partialReport).not.toContain("Unavailable benchmark")
          expect(partialTrace).toContain("- Status: **partial**")
          expect(partialTrace).toContain("Unavailable benchmark")
          expect(partialTrace).toContain("Benchmark provider was unavailable")
          expect(yield* Effect.promise(() => WorkflowReport.collectSources(heavy, [artifactPath]))).toEqual([
            "https://example.com/artifact-source",
            "https://example.com/evidence",
          ])
          const observed = WorkflowSchema.SessionStage.make({
            session_id: SessionV2.ID.make("ses_observed_sources"),
            run_id: "run-observed-sources",
            workflow: "heavy",
            workflow_depth: 0,
            status: "completed",
            agent: "heavy-reader",
            title: "Observed sources",
            stage: "execution",
            report_path: artifactPath,
            started_at: 0,
            updated_at: 1,
            elapsed_ms: 1,
            sources: [
              { url: "https://example.com/artifact-source", verification: "unverified", method: "search" },
              { url: "https://example.com/artifact-source;", verification: "verified", method: "direct" },
              { url: "https://example.com/failed-direct", verification: "failed", method: "direct" },
              { url: "https://example.com/unmentioned-search", verification: "unverified", method: "search" },
            ],
          })
          expect(
            yield* Effect.promise(() => WorkflowReport.collectSourceProvenance(heavy, [artifactPath], [observed])),
          ).toEqual([
            {
              url: "https://example.com/artifact-source",
              report_paths: [artifactPath],
              kind: "secondary",
              verification: "verified",
              direct_checks: 1,
              search_discoveries: 1,
            },
            {
              url: "https://example.com/evidence",
              report_paths: [],
              kind: "secondary",
              verification: "unverified",
            },
            {
              url: "https://example.com/failed-direct",
              report_paths: [artifactPath],
              kind: "secondary",
              verification: "failed",
              direct_checks: 1,
            },
          ])
          expect(yield* Effect.promise(() => WorkflowReport.collectSourceProvenance({}, [failedSourcePath]))).toEqual([
            {
              url: "https://example.com/unavailable-source",
              report_paths: [failedSourcePath],
              kind: "secondary",
              verification: "failed",
            },
          ])
          expect(
            WorkflowReport.extractSources({
              actualNewline: "https://example.com/actual).\n- supporting prose",
              escapedNewline: "https://example.com/escaped\\n- supporting prose",
              markdown: "[source](https://example.com/markdown).",
              emDash: "https://fs.spec.whatwg.org/—remain compatible",
              placeholder: "https://.../ses_workflow_old-report",
            }),
          ).toEqual([
            "https://example.com/actual",
            "https://example.com/escaped",
            "https://example.com/markdown",
            "https://fs.spec.whatwg.org/",
          ])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("rejects oversized prompts without truncation and audits every artifact", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          expect(yield* WorkflowReport.prompt("bounded stage", "exactly ten", 11)).toBe("exactly ten")
          const failure = yield* WorkflowReport.prompt("root synthesis", "too large", 4).pipe(Effect.flip)
          expect(failure.message).toContain("No artifact was truncated")
          expect(failure.message).toContain("add a recursive synthesis level")

          const usedPath = path.join(tmp.path, "used.md")
          const unreportedPath = path.join(tmp.path, "unreported.md")
          const missingPath = path.join(tmp.path, "missing.md")
          yield* Effect.promise(() => Bun.write(usedPath, "USED_SENTINEL"))
          yield* Effect.promise(() => Bun.write(unreportedPath, "UNREPORTED_SENTINEL"))
          const artifacts = [
            { title: "Used report", reportPath: usedPath },
            { title: "Unreported report", reportPath: unreportedPath },
            { title: "Missing report", reportPath: missingPath },
          ]
          const text = yield* Effect.promise(() => WorkflowReport.readArtifacts(artifacts))
          const coverage = yield* Effect.promise(() =>
            WorkflowReport.coverage(artifacts, [
              {
                title: "Used report",
                report_path: usedPath,
                received: true,
                used: ["USED_SENTINEL informed the recommendation"],
                rejected: ["A superseded estimate"],
                unresolved: [],
              },
              {
                title: "Used report",
                report_path: usedPath,
                received: true,
                used: ["A second report section reused the validated bound"],
                rejected: [],
                unresolved: [],
              },
            ]),
          )

          expect(text).toContain("USED_SENTINEL")
          expect(text).toContain("UNREPORTED_SENTINEL")
          expect(text).toContain("[The durable report is missing")
          expect(coverage).toEqual([
            expect.objectContaining({
              title: "Used report",
              received: true,
              used: ["USED_SENTINEL informed the recommendation", "A second report section reused the validated bound"],
              rejected: ["A superseded estimate"],
              unresolved: [],
            }),
            expect.objectContaining({
              title: "Unreported report",
              received: true,
              unresolved: ["The synthesis did not record how this artifact affected its conclusions."],
            }),
            expect.objectContaining({
              title: "Missing report",
              received: false,
              unresolved: ["The durable report was unavailable when synthesis started."],
            }),
          ])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
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

  it.effect("isolates sequential delegated Councils under one parent workflow", () =>
    Effect.gen(function* () {
      const execution = yield* WorkflowExecution.make({
        workflow: "research",
        objective: "Resolve two independent disputes",
        sessionID: parent.id,
        toolCallID: "call-research-councils",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        delegates: {
          research: new Set(["council"]),
        },
      })
      const plannerIDs: string[] = []
      const runtime = makeRuntime((input) => {
        if (input.agent === "council-planner") {
          plannerIDs.push(input.id)
          return {
            rationale: "Compare both positions",
            issues: [{ id: "decision", question: "Which option should govern?" }],
            perspectives: [
              { id: "support", title: "Support", instructions: "Defend the option." },
              { id: "challenge", title: "Challenge", instructions: "Challenge the option." },
            ],
          }
        }
        if (input.agent === "council-perspective")
          return {
            perspective_id: "position",
            summary: "Bounded position",
            issues: [],
            recommendations: [],
            risks: [],
          }
        return {
          status: "completed",
          summary: input.prompt.includes("WebTransport") ? "Use WebSocket fallback" : "Use measured memory tiers",
          consensus: [],
          disagreements: [],
          recommendations: [],
          risks: [],
          coverage: input.reportSources?.map((source) => ({
            title: source.title,
            report_path: source.reportPath,
            used: ["The synthesis incorporated this perspective."],
            rejected: [],
            unresolved: [],
          })),
        }
      })
      const first = yield* WorkflowExecution.delegate(execution, {
        workflow: "council",
        objective: "Choose WebTransport or WebSocket",
        sessionID: parent.id,
        toolCallID: "call-research-councils:transport",
      })
      const second = yield* WorkflowExecution.delegate(execution, {
        workflow: "council",
        objective: "Set the client memory budget",
        sessionID: parent.id,
        toolCallID: "call-research-councils:memory",
      })
      const settings: CouncilWorkflow.Settings = {
        perspectives: 2,
        concurrency: 2,
        childTimeoutMs: 60_000,
        debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
        models: {},
      }
      const transport = yield* CouncilWorkflow.run(
        "Should the client prefer WebTransport or retain WebSocket fallback?",
        parent,
        { ...context, execution: first },
        settings,
        runtime,
      )
      const memory = yield* CouncilWorkflow.run(
        "Which inclusive browser memory budget should govern?",
        parent,
        { ...context, execution: second },
        settings,
        runtime,
      )

      expect(new Set(plannerIDs).size).toBe(2)
      expect(transport.root_session_id).not.toBe(memory.root_session_id)
      expect(transport.synthesis_session_id).not.toBe(memory.synthesis_session_id)
      expect(transport.summary).toBe("Use WebSocket fallback")
      expect(memory.summary).toBe("Use measured memory tiers")
    }),
  )

  it.live("accepts exact Council coverage for every direct perspective report", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const execution = yield* WorkflowExecution.make({
            workflow: "research",
            objective: "Audit Council coverage",
            sessionID: parent.id,
            toolCallID: "call-council-coverage",
            directory: tmp.path,
            reportDirectory: ".opencode/reports",
            maxDepth: 3,
            maxWorkflows: 8,
            delegates: {
              research: new Set(["council"]),
            },
          })
          const artifactPaths: string[] = []
          const base = makeRuntime((input) => {
            if (input.agent === "council-planner")
              return {
                rationale: "Compare two positions.",
                issues: [{ id: "decision", question: "Which option governs?" }],
                perspectives: [
                  { id: "support", title: "Support", instructions: "Defend the option." },
                  { id: "challenge", title: "Challenge", instructions: "Challenge the option." },
                ],
              }
            if (input.agent === "council-perspective")
              return {
                perspective_id: "position",
                summary: "Bounded position",
                issues: [],
                recommendations: [],
                risks: [],
              }
            return {
              status: "completed",
              summary: "The evidence supports a conditional decision.",
              consensus: ["Proceed conditionally"],
              disagreements: [],
              recommendations: [],
              risks: [],
              coverage: input.reportSources?.map((source) => ({
                title: source.title,
                report_path: source.reportPath,
                used: ["The authored synthesis incorporated this perspective."],
                rejected: [],
                unresolved: [],
              })),
            }
          })
          const runtime: WorkflowRuntime.Interface = {
            ...base,
            runChild: <Result extends Tool.SchemaType<any>>(input: WorkflowRuntime.ChildInput<Result>) =>
              base.runChild(input).pipe(
                Effect.tap(() => {
                  if (input.agent !== "council-perspective") return Effect.void
                  return Effect.promise(async () => {
                    const reportPath = WorkflowExecution.stageReportPath(
                      execution,
                      base.childID(input.parentID, input.id),
                    )
                    await mkdir(path.dirname(reportPath), { recursive: true })
                    await Bun.write(reportPath, `# ${input.title}\n\nMaterial evidence.\n`)
                    artifactPaths.push(reportPath)
                  })
                }),
              ),
            reportCoverage: () =>
              artifactPaths.map((reportPath) => ({
                reportPath,
                disposition: "used",
                detail: "The authored synthesis incorporated this perspective.",
              })),
          }
          const output = yield* CouncilWorkflow.run(
            "Which option should govern?",
            parent,
            { ...context, execution },
            {
              perspectives: 2,
              concurrency: 2,
              childTimeoutMs: 60_000,
              debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
              models: {},
            },
            runtime,
          )

          expect(output.status).toBe("completed")
          expect(output.coverage).toHaveLength(2)
          expect(output.coverage).toEqual([
            expect.objectContaining({
              received: true,
              used: ["The authored synthesis incorporated this perspective."],
              unresolved: [],
            }),
            expect.objectContaining({
              received: true,
              used: ["The authored synthesis incorporated this perspective."],
              unresolved: [],
            }),
          ])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.effect("rejects Council synthesis coverage that names only upstream artifacts", () =>
    Effect.gen(function* () {
      const progress: Record<string, unknown>[] = []
      const execution = yield* WorkflowExecution.make({
        workflow: "council",
        objective: "Audit direct coverage",
        sessionID: parent.id,
        toolCallID: "call-council-direct-coverage",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 2,
        maxWorkflows: 4,
        delegates: {},
      })
      const runtime = makeRuntime((input) => {
        if (input.agent === "council-planner")
          return {
            rationale: "Compare both positions.",
            issues: [{ id: "decision", question: "Which position governs?" }],
            perspectives: [
              { id: "support", title: "Support", instructions: "Defend the position." },
              { id: "challenge", title: "Challenge", instructions: "Challenge the position." },
            ],
          }
        if (input.agent === "council-perspective")
          return {
            perspective_id: "position",
            summary: "Direct perspective evidence",
            issues: [],
            recommendations: [],
            risks: [],
          }
        return {
          status: "completed",
          summary: "This result should be rejected.",
          consensus: [],
          disagreements: [],
          recommendations: [],
          risks: [],
          coverage: [
            {
              title: "Upstream evidence",
              report_path: "/project/upstream-evidence.md",
              used: ["Used the upstream evidence."],
              rejected: [],
              unresolved: [],
            },
          ],
        }
      }, progress)
      const output = yield* CouncilWorkflow.run(
        "Which position governs?",
        parent,
        { ...context, execution },
        {
          perspectives: 2,
          concurrency: 2,
          childTimeoutMs: 60_000,
          debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
          models: {},
        },
        runtime,
      )

      expect(output.status).toBe("partial")
      expect(output.summary).not.toBe("This result should be rejected.")
      expect(progress).toContainEqual(
        expect.objectContaining({
          workflow: "council",
          phase: "recovering",
          stage: "synthesis",
          error: expect.stringContaining("Missing:"),
        }),
      )
    }),
  )

  it.live("passes upstream Council evidence by reference without embedding report bodies", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const reportPath = path.join(tmp.path, "upstream-evidence.md")
          yield* Effect.promise(() => Bun.write(reportPath, "# Evidence\n\nUPSTREAM_REPORT_BODY_SENTINEL\n"))
          const prompts: string[] = []
          const perspectiveSources: ReadonlyArray<WorkflowRuntime.ReportSource>[] = []
          const runtime = makeRuntime((input) => {
            prompts.push(input.prompt)
            if (input.agent === "council-planner")
              return {
                rationale: "Inspect the authorized evidence.",
                issues: [{ id: "decision", question: "Which position governs?" }],
                perspectives: [
                  { id: "support", title: "Support", instructions: "Defend the position." },
                  { id: "challenge", title: "Challenge", instructions: "Challenge the position." },
                ],
              }
            if (input.agent === "council-perspective") {
              perspectiveSources.push(input.reportSources ?? [])
              return {
                perspective_id: "position",
                summary: "Evidence-aware position",
                issues: [],
                recommendations: [],
                risks: [],
              }
            }
            return {
              status: "completed",
              summary: "Conditional conclusion",
              consensus: [],
              disagreements: [],
              recommendations: [],
              risks: [],
            }
          })
          yield* CouncilWorkflow.run(
            "Which position governs?",
            parent,
            context,
            {
              perspectives: 2,
              concurrency: 2,
              childTimeoutMs: 60_000,
              debate: { mode: "off", topics: 1, participants: 2, rounds: 1 },
              models: {},
            },
            runtime,
            [{ id: "upstream", title: "Upstream evidence", reportPath }],
          )

          expect(prompts.every((prompt) => !prompt.includes("UPSTREAM_REPORT_BODY_SENTINEL"))).toBe(true)
          expect(perspectiveSources).toEqual([
            [{ id: "upstream", title: "Upstream evidence", reportPath }],
            [{ id: "upstream", title: "Upstream evidence", reportPath }],
          ])
          expect(prompts.filter((prompt) => prompt.includes("workflow_read_reports({ all: true })"))).toHaveLength(2)
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
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

  it.live("loads Council reports through debate rounds and final synthesis", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const execution = yield* WorkflowExecution.make({
            workflow: "council",
            objective: "Debate with complete evidence",
            sessionID: parent.id,
            toolCallID: "call-council-reports",
            directory: tmp.path,
            reportDirectory: ".opencode/reports",
            maxDepth: 3,
            maxWorkflows: 8,
            delegates: {
              heavy: new Set(["heavy", "council"]),
              council: new Set(["heavy", "council"]),
            },
          })
          const firstRoundPrompts: string[] = []
          const secondRoundPrompts: string[] = []
          let synthesisPrompt = ""
          const childID = (_parentID: SessionV2.ID, id: string) => SessionV2.ID.make(`ses_${id}`)
          const runtime: WorkflowRuntime.Interface = {
            childID,
            execution: () => execution,
            runChild: <Result extends Tool.SchemaType<any>>(input: WorkflowRuntime.ChildInput<Result>) =>
              Effect.gen(function* () {
                if (input.agent === "council-planner")
                  return Schema.decodeUnknownSync(input.result)({
                    rationale: "test both sides",
                    issues: [{ id: "choice", question: "Which choice is safer?" }],
                    perspectives: [
                      { id: "support", title: "Support", instructions: "Defend the choice." },
                      { id: "oppose", title: "Oppose", instructions: "Challenge the choice." },
                    ],
                  })
                const sessionID = childID(input.parentID, input.id)
                if (input.agent === "council-perspective") {
                  const support = input.id.endsWith("perspective-1")
                  yield* Effect.promise(() =>
                    writeArtifact(
                      execution,
                      sessionID,
                      support ? "PERSPECTIVE_SUPPORT_FULL" : "PERSPECTIVE_OPPOSE_FULL",
                    ),
                  )
                  return Schema.decodeUnknownSync(input.result)({
                    perspective_id: "ignored",
                    summary: support ? "support" : "oppose",
                    issues: [
                      {
                        id: "issue-1",
                        question: "Which choice is safer?",
                        stance: support ? "support" : "oppose",
                        rationale: "bounded position",
                        evidence: [],
                      },
                    ],
                    recommendations: [],
                    risks: [],
                  })
                }
                if (input.agent === "council-debater") {
                  const round = input.id.includes(":2:") ? 2 : 1
                  const prompts = round === 1 ? firstRoundPrompts : secondRoundPrompts
                  prompts.push(input.prompt)
                  yield* Effect.promise(() =>
                    writeArtifact(execution, sessionID, `DEBATE_ROUND_${round}_FULL_${input.id}`),
                  )
                  return Schema.decodeUnknownSync(input.result)({
                    issue_id: "issue-1",
                    perspective_id: "ignored",
                    round,
                    stance: "conditional",
                    argument: `bounded round ${round}`,
                    concessions: [],
                    rebuttals: [],
                    evidence: [],
                  })
                }
                synthesisPrompt = input.prompt
                return Schema.decodeUnknownSync(input.result)({
                  status: "completed",
                  summary: "complete synthesis",
                  consensus: [],
                  disagreements: [],
                  recommendations: [],
                  risks: [],
                })
              }),
            progress: () => Effect.void,
          }

          yield* CouncilWorkflow.run(
            "Which choice is safer?",
            parent,
            { ...context, execution, agent: AgentV2.ID.make("council") },
            {
              perspectives: 2,
              concurrency: 2,
              childTimeoutMs: 60_000,
              debate: { mode: "always", topics: 1, participants: 2, rounds: 2 },
              models: {},
            },
            runtime,
          )

          expect(firstRoundPrompts).toHaveLength(2)
          expect(firstRoundPrompts.every((prompt) => prompt.includes("PERSPECTIVE_SUPPORT_FULL"))).toBe(true)
          expect(firstRoundPrompts.every((prompt) => prompt.includes("PERSPECTIVE_OPPOSE_FULL"))).toBe(true)
          expect(secondRoundPrompts).toHaveLength(2)
          expect(secondRoundPrompts.every((prompt) => prompt.includes("DEBATE_ROUND_1_FULL"))).toBe(true)
          expect(synthesisPrompt).toContain("PERSPECTIVE_SUPPORT_FULL")
          expect(synthesisPrompt).toContain("PERSPECTIVE_OPPOSE_FULL")
          expect(synthesisPrompt).toContain("DEBATE_ROUND_1_FULL")
          expect(synthesisPrompt).toContain("DEBATE_ROUND_2_FULL")
          expect(synthesisPrompt).toContain("authored Council document")
          expect(synthesisPrompt).toContain("never paste whole participant reports together")
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
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
      const execution = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Time out visibly",
        sessionID: parent.id,
        toolCallID: "call-timed-child",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const dependencies = Layer.mergeAll(
        Layer.mock(EventV2.Service, {
          publish: (definition, data) =>
            Effect.succeed({
              id: EventV2.ID.create(),
              type: definition.type,
              data,
            } as EventV2.Payload<typeof definition>),
        }),
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
          progress: {
            context: { ...context, execution },
            workflow: "heavy",
            phase: "executing",
            stage: "execution",
          },
        }),
      ).pipe(Effect.provide(WorkflowRuntime.layer.pipe(Layer.provide(dependencies))), Effect.flip, Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust(1_000)
      const failure = yield* Fiber.join(fiber)

      expect(failure).toBeInstanceOf(Tool.Failure)
      expect(failure.message).toBe("Timed child timed out after 1000 ms")
      expect(yield* Ref.get(interrupts)).toBe(1)
      expect(yield* Ref.get(createdModel)).toBe(parent.model)
      expect(yield* WorkflowExecution.sessions(execution)).toEqual([
        expect.objectContaining({
          status: "timed_out",
          agent: "heavy-reader",
          stage: "execution",
          error: "Timed child timed out after 1000 ms",
        }),
      ])
    }),
  )

  it.live("persists detailed stage reports outside the bounded terminal result", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const progressUpdates: WorkflowRuntime.Progress[] = []
          const execution = yield* WorkflowExecution.make({
            workflow: "heavy",
            objective: "Research the implementation",
            sessionID: parent.id,
            toolCallID: "call-report-root",
            directory: tmp.path,
            reportDirectory: ".opencode/reports",
            maxDepth: 3,
            maxWorkflows: 8,
            delegates: {
              heavy: new Set(["heavy", "council"]),
              council: new Set(["heavy", "council"]),
            },
            onProgress: (input) =>
              Effect.sync(() => {
                progressUpdates.push(input)
              }),
          })
          const tools: Record<string, Tool.AnyTool> = {}
          let prompt = ""
          let reportPath = ""
          const detailedReport = `${"é".repeat(18_000)}${"🙂".repeat(1_000)}`
          const childID = SessionV2.ID.make("ses_report_child")
          const toolContext: Tool.Context = {
            sessionID: childID,
            agent: AgentV2.ID.make("heavy-reader"),
            assistantMessageID: SessionMessage.ID.make("msg_report_child"),
            toolCallID: "call-report-child",
          }
          const dependencies = Layer.mergeAll(
            Layer.mock(EventV2.Service, {
              publish: (definition, data) =>
                Effect.succeed({
                  id: EventV2.ID.create(),
                  type: definition.type,
                  data,
                } as EventV2.Payload<typeof definition>),
            }),
            Layer.mock(SessionV2.Service, {
              create: (input) =>
                Effect.succeed(
                  SessionV2.Info.make({
                    ...parent,
                    id: input.id ?? childID,
                    parentID: input.parentID,
                    title: input.title ?? "Report child",
                    agent: input.agent,
                    model: input.model,
                  }),
                ),
              messages: () => Effect.succeed([]),
              prompt: (input) =>
                Effect.sync(() => {
                  prompt = input.prompt.text
                  return SessionInput.Admitted.make({
                    admittedSeq: 0,
                    id: input.id ?? SessionMessage.ID.make("msg_report_child"),
                    sessionID: input.sessionID,
                    prompt: { text: input.prompt.text },
                    delivery: input.delivery ?? "steer",
                    timeCreated: DateTime.makeUnsafe(0),
                  })
                }),
              resume: () =>
                Effect.gen(function* () {
                  yield* Tool.settle(
                    tools.workflow_report,
                    LLMEvent.toolCall({
                      id: "call-report",
                      name: "workflow_report",
                      input: {
                        title: "Detailed evidence",
                        content: detailedReport,
                        coverage: [
                          {
                            report_path: "/not-authorized",
                            disposition: "used",
                            detail: "",
                          },
                        ],
                      },
                    }),
                    toolContext,
                  ).pipe(Effect.orDie)
                  yield* Tool.settle(
                    tools.workflow_result,
                    LLMEvent.toolCall({
                      id: "call-result",
                      name: "workflow_result",
                      input: { summary: "Compact index" },
                    }),
                    toolContext,
                  ).pipe(Effect.orDie)
                  return undefined
                }),
              interrupt: () => Effect.void,
              revert: {
                stage: () => Effect.die("unused"),
                clear: () => Effect.die("unused"),
                commit: () => Effect.die("unused"),
              },
            }),
            Layer.mock(SessionTools.Service, {
              register: (_sessionID, registered) =>
                Effect.sync(() => {
                  Object.assign(tools, registered)
                }),
              entries: () => new Map(),
            }),
          )

          const result = yield* WorkflowRuntime.Service.use((runtime) =>
            Effect.gen(function* () {
              reportPath = WorkflowExecution.stageReportPath(execution, runtime.childID(parent.id, "report-child"))
              return yield* runtime.runChild({
                id: "report-child",
                parentID: parent.id,
                location: { directory: AbsolutePath.make(tmp.path) },
                title: "Report child",
                agent: AgentV2.ID.make("heavy-reader"),
                timeoutMs: 1_000,
                prompt: "Research",
                result: Schema.Struct({ summary: Schema.String }),
                progress: {
                  context: { ...context, execution },
                  workflow: "heavy",
                  phase: "executing",
                  stage: "execution",
                },
              })
            }),
          ).pipe(Effect.provide(WorkflowRuntime.layer.pipe(Layer.provide(dependencies))))
          const report = yield* Effect.promise(() => Bun.file(reportPath).text())

          expect(result.summary).toBe("Compact index")
          expect(prompt).toContain("Use workflow_report one or more times")
          expect(report).toContain(detailedReport)
          expect(report).not.toContain("�")
          expect(progressUpdates.map((update) => update.structured.child_status)).toEqual([
            "queued",
            "running",
            "completed",
          ])
          expect(yield* WorkflowExecution.sessions(execution)).toEqual([
            expect.objectContaining({
              session_id: expect.stringContaining("ses_workflow_"),
              parent_session_id: parent.id,
              run_id: execution.id,
              workflow: "heavy",
              workflow_depth: 0,
              status: "completed",
              agent: "heavy-reader",
              stage: "execution",
              report_path: reportPath,
            }),
          ])
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("restricts durable report reads and records section-level source coverage", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const execution = yield* WorkflowExecution.make({
            workflow: "heavy",
            objective: "Author from durable sources",
            sessionID: parent.id,
            toolCallID: "call-report-sources",
            directory: tmp.path,
            reportDirectory: ".opencode/reports",
            maxDepth: 3,
            maxWorkflows: 8,
            delegates: {
              heavy: new Set(["heavy", "council"]),
              council: new Set(["heavy", "council"]),
            },
          })
          const firstPath = path.join(tmp.path, "first-source.md")
          const secondPath = path.join(tmp.path, "second-source.md")
          yield* Effect.promise(() => Bun.write(firstPath, "# First source\n\nFIRST_SOURCE_DETAIL\n"))
          yield* Effect.promise(() => Bun.write(secondPath, "# Second source\n\nSECOND_SOURCE_DETAIL\n"))
          const tools: Record<string, Tool.AnyTool> = {}
          const childID = SessionV2.ID.make("ses_report_sources")
          const toolContext: Tool.Context = {
            sessionID: childID,
            agent: AgentV2.ID.make("heavy-synthesizer"),
            assistantMessageID: SessionMessage.ID.make("msg_report_sources"),
            toolCallID: "call-report-sources-child",
          }
          const dependencies = Layer.mergeAll(
            Layer.mock(EventV2.Service, {
              publish: (definition, data) =>
                Effect.succeed({
                  id: EventV2.ID.create(),
                  type: definition.type,
                  data,
                } as EventV2.Payload<typeof definition>),
            }),
            Layer.mock(SessionV2.Service, {
              create: (input) =>
                Effect.succeed(
                  SessionV2.Info.make({
                    ...parent,
                    id: input.id ?? childID,
                    parentID: input.parentID,
                    title: input.title ?? "Final report author",
                    agent: input.agent,
                    model: input.model,
                  }),
                ),
              messages: () => Effect.succeed([]),
              prompt: (input) =>
                Effect.succeed(
                  SessionInput.Admitted.make({
                    admittedSeq: 0,
                    id: input.id ?? SessionMessage.ID.make("msg_report_sources"),
                    sessionID: input.sessionID,
                    prompt: { text: input.prompt.text },
                    delivery: input.delivery ?? "steer",
                    timeCreated: DateTime.makeUnsafe(0),
                  }),
                ),
              resume: () =>
                Effect.gen(function* () {
                  const denied = yield* Effect.result(
                    Tool.settle(
                      tools.workflow_read_reports,
                      LLMEvent.toolCall({
                        id: "call-read-denied",
                        name: "workflow_read_reports",
                        input: { artifact_ids: ["not-authorized"] },
                      }),
                      toolContext,
                    ),
                  )
                  if (Result.isSuccess(denied)) throw new Error("Unauthorized report read unexpectedly succeeded")
                  expect(denied.failure.message).toContain("Unauthorized workflow report reference")
                  const read = yield* Tool.settle(
                    tools.workflow_read_reports,
                    LLMEvent.toolCall({
                      id: "call-read-sources",
                      name: "workflow_read_reports",
                      input: { all: true },
                    }),
                    toolContext,
                  ).pipe(Effect.orDie)
                  expect(read.structured).toEqual({
                    reports: [
                      {
                        artifact_id: "first",
                        title: "First source",
                        report_path: firstPath,
                        content: "# First source\n\nFIRST_SOURCE_DETAIL\n",
                      },
                      {
                        artifact_id: "second",
                        title: "Second source",
                        report_path: secondPath,
                        content: "# Second source\n\nSECOND_SOURCE_DETAIL\n",
                      },
                    ],
                  })
                  const deniedCoverage = yield* Effect.result(
                    Tool.settle(
                      tools.workflow_report,
                      LLMEvent.toolCall({
                        id: "call-report-denied-coverage",
                        name: "workflow_report",
                        input: {
                          title: "Unauthorized section",
                          content: "SHOULD_NOT_WRITE",
                          coverage: [
                            {
                              report_path: path.join(tmp.path, "not-authorized.md"),
                              disposition: "used",
                              detail: "This path was not supplied to the author.",
                            },
                          ],
                        },
                      }),
                      toolContext,
                    ),
                  )
                  if (Result.isSuccess(deniedCoverage))
                    throw new Error("Unauthorized report coverage unexpectedly succeeded")
                  expect(deniedCoverage.failure.message).toContain("Unauthorized workflow report coverage path")
                  yield* Tool.settle(
                    tools.workflow_report,
                    LLMEvent.toolCall({
                      id: "call-report-section",
                      name: "workflow_report",
                      input: {
                        title: "Integrated analysis",
                        content:
                          "# Duplicate document title\n\nOpening.\n\n## Material detail\n\n```md\n# Literal heading\n## Literal subheading\n```",
                        coverage: [
                          {
                            report_path: firstPath,
                            disposition: "used",
                            detail: "FIRST_SOURCE_DETAIL supports the opening.",
                          },
                          {
                            report_path: secondPath,
                            disposition: "rejected",
                            detail: "SECOND_SOURCE_DETAIL was superseded by the first source.",
                          },
                        ],
                      },
                    }),
                    toolContext,
                  ).pipe(Effect.orDie)
                  yield* Tool.settle(
                    tools.workflow_result,
                    LLMEvent.toolCall({
                      id: "call-report-sources-result",
                      name: "workflow_result",
                      input: { summary: "Integrated both sources" },
                    }),
                    toolContext,
                  ).pipe(Effect.orDie)
                }),
              interrupt: () => Effect.void,
              revert: {
                stage: () => Effect.die("unused"),
                clear: () => Effect.die("unused"),
                commit: () => Effect.die("unused"),
              },
            }),
            Layer.mock(SessionTools.Service, {
              register: (_sessionID, registered) =>
                Effect.sync(() => {
                  Object.assign(tools, registered)
                }),
              entries: () => new Map(),
            }),
          )

          const tracked = yield* WorkflowRuntime.Service.use((runtime) =>
            Effect.gen(function* () {
              const sessionID = runtime.childID(parent.id, "report-sources")
              const result = yield* runtime.runChild({
                id: "report-sources",
                parentID: parent.id,
                location: { directory: AbsolutePath.make(tmp.path) },
                title: "Final report author",
                agent: AgentV2.ID.make("heavy-synthesizer"),
                timeoutMs: 1_000,
                prompt: "Read and integrate the sources.",
                result: Schema.Struct({ summary: Schema.String }),
                reportSources: [
                  { id: "first", title: "First source", reportPath: firstPath },
                  { id: "second", title: "Second source", reportPath: secondPath },
                ],
                reportContentFirst: false,
                reportReadMode: "artifacts",
                progress: {
                  context: { ...context, execution },
                  workflow: "heavy",
                  phase: "reporting",
                  stage: "report",
                },
              })
              return {
                result,
                reportPath: WorkflowExecution.stageReportPath(execution, sessionID),
                reads: runtime.reportReads?.(sessionID),
                coverage: runtime.reportCoverage?.(sessionID),
              }
            }),
          ).pipe(Effect.provide(WorkflowRuntime.layer.pipe(Layer.provide(dependencies))))
          const report = yield* Effect.promise(() => Bun.file(tracked.reportPath).text())

          expect(tracked.result.summary).toBe("Integrated both sources")
          expect(tracked.reads).toEqual([firstPath, secondPath])
          expect(tracked.coverage).toEqual([
            {
              reportPath: firstPath,
              disposition: "used",
              detail: "FIRST_SOURCE_DETAIL supports the opening.",
            },
            {
              reportPath: secondPath,
              disposition: "rejected",
              detail: "SECOND_SOURCE_DETAIL was superseded by the first source.",
            },
          ])
          expect(report).toContain("# Final report author")
          expect(report).toContain("## Integrated analysis")
          expect(report).not.toContain("SHOULD_NOT_WRITE")
          expect(report).not.toContain("# Duplicate document title")
          expect(report).toContain("### Material detail")
          expect(report).toContain("# Literal heading")
          expect(report).toContain("## Literal subheading")
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("retries transient finalization and recovers structured output from a durable report", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.gen(function* () {
          const execution = yield* WorkflowExecution.make({
            workflow: "heavy",
            objective: "Recover durable research",
            sessionID: parent.id,
            toolCallID: "call-report-recovery",
            directory: tmp.path,
            reportDirectory: ".opencode/reports",
            maxDepth: 3,
            maxWorkflows: 8,
            delegates: {
              heavy: new Set(["heavy", "council"]),
              council: new Set(["heavy", "council"]),
            },
          })
          const tools: Record<string, Tool.AnyTool> = {}
          const prompts: string[] = []
          let resumes = 0
          const childID = SessionV2.ID.make("ses_recovery_child")
          const toolContext: Tool.Context = {
            sessionID: childID,
            agent: AgentV2.ID.make("heavy-reader"),
            assistantMessageID: SessionMessage.ID.make("msg_recovery_child"),
            toolCallID: "call-recovery-child",
          }
          const dependencies = Layer.mergeAll(
            Layer.mock(EventV2.Service, {
              publish: (definition, data) =>
                Effect.succeed({
                  id: EventV2.ID.create(),
                  type: definition.type,
                  data,
                } as EventV2.Payload<typeof definition>),
            }),
            Layer.mock(SessionV2.Service, {
              create: (input) =>
                Effect.succeed(
                  SessionV2.Info.make({
                    ...parent,
                    id: input.id ?? childID,
                    parentID: input.parentID,
                    title: input.title ?? "Recovery child",
                    agent: input.agent,
                    model: input.model,
                  }),
                ),
              messages: () => Effect.succeed([]),
              prompt: (input) =>
                Effect.sync(() => {
                  prompts.push(input.prompt.text)
                  return SessionInput.Admitted.make({
                    admittedSeq: prompts.length - 1,
                    id: input.id ?? SessionMessage.ID.make("msg_recovery_child"),
                    sessionID: input.sessionID,
                    prompt: { text: input.prompt.text },
                    delivery: input.delivery ?? "steer",
                    timeCreated: DateTime.makeUnsafe(0),
                  })
                }),
              resume: () =>
                Effect.gen(function* () {
                  resumes++
                  if (resumes === 1)
                    yield* Tool.settle(
                      tools.workflow_report,
                      LLMEvent.toolCall({
                        id: "call-recovery-report",
                        name: "workflow_report",
                        input: {
                          title: "Recovered evidence",
                          content: "The durable analysis supports the recovered conclusion.",
                        },
                      }),
                      toolContext,
                    ).pipe(Effect.orDie)
                  if (resumes < 3)
                    return yield* Effect.fail(
                      new LLMError({
                        module: "workflow-test",
                        method: "stream",
                        reason: new TransportReason({ message: "HTTP transport failed: connection reset" }),
                      }),
                    )
                  yield* Tool.settle(
                    tools.workflow_result,
                    LLMEvent.toolCall({
                      id: "call-recovered-result",
                      name: "workflow_result",
                      input: { summary: "Recovered conclusion" },
                    }),
                    toolContext,
                  ).pipe(Effect.orDie)
                  return undefined
                }),
              interrupt: () => Effect.void,
              revert: {
                stage: () => Effect.die("unused"),
                clear: () => Effect.die("unused"),
                commit: () => Effect.die("unused"),
              },
            }),
            Layer.mock(SessionTools.Service, {
              register: (_sessionID, registered) =>
                Effect.sync(() => {
                  Object.assign(tools, registered)
                }),
              entries: () => new Map(),
            }),
          )

          const result = yield* WorkflowRuntime.Service.use((runtime) =>
            runtime.runChild({
              id: "recovery-child",
              parentID: parent.id,
              location: { directory: AbsolutePath.make(tmp.path) },
              title: "Recovery child",
              agent: AgentV2.ID.make("heavy-reader"),
              timeoutMs: 5_000,
              finalizationRetries: 1,
              prompt: "Research durably",
              result: Schema.Struct({ summary: Schema.String }),
              progress: {
                context: { ...context, execution },
                workflow: "heavy",
                phase: "executing",
                stage: "execution",
              },
            }),
          ).pipe(Effect.provide(WorkflowRuntime.layer.pipe(Layer.provide(dependencies))))

          expect(result.summary).toBe("Recovered conclusion")
          expect(resumes).toBe(3)
          expect(prompts).toHaveLength(2)
          expect(prompts[1]).toContain("Recover the interrupted workflow finalization")
          expect(prompts[1]).toContain("The durable analysis supports the recovered conclusion.")
          const stages = yield* WorkflowExecution.sessions(execution)
          expect(stages).toEqual([
            expect.objectContaining({
              status: "completed",
              recovery_attempts: 2,
            }),
          ])
          expect(stages[0]?.activity).toBeUndefined()
        }),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("recovers a structured result after a successful empty provider turn", () =>
    Effect.gen(function* () {
      const execution = yield* WorkflowExecution.make({
        workflow: "research",
        objective: "Recover an empty planner turn",
        sessionID: parent.id,
        toolCallID: "call-empty-result-recovery",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        delegates: {
          research: new Set(["council"]),
        },
      })
      const tools: Record<string, Tool.AnyTool> = {}
      const prompts: string[] = []
      let resumes = 0
      const childID = SessionV2.ID.make("ses_empty_result_recovery")
      const dependencies = Layer.mergeAll(
        Layer.mock(EventV2.Service, {
          publish: (definition, data) =>
            Effect.succeed({
              id: EventV2.ID.create(),
              type: definition.type,
              data,
            } as EventV2.Payload<typeof definition>),
        }),
        Layer.mock(SessionV2.Service, {
          create: (input) =>
            Effect.succeed(
              SessionV2.Info.make({
                ...parent,
                id: input.id ?? childID,
                parentID: input.parentID,
                title: input.title ?? "Empty result recovery",
                agent: input.agent,
                model: input.model,
              }),
            ),
          messages: () => Effect.succeed([]),
          prompt: (input) =>
            Effect.sync(() => {
              prompts.push(input.prompt.text)
              return SessionInput.Admitted.make({
                admittedSeq: prompts.length - 1,
                id: input.id ?? SessionMessage.ID.make("msg_empty_result_recovery"),
                sessionID: input.sessionID,
                prompt: { text: input.prompt.text },
                delivery: input.delivery ?? "steer",
                timeCreated: DateTime.makeUnsafe(0),
              })
            }),
          resume: () =>
            Effect.gen(function* () {
              resumes++
              if (resumes === 1) return
              yield* Tool.settle(
                tools.workflow_result,
                LLMEvent.toolCall({
                  id: "call-empty-result",
                  name: "workflow_result",
                  input: { summary: "Recovered without repeating work" },
                }),
                {
                  ...context,
                  sessionID: childID,
                  assistantMessageID: SessionMessage.ID.make("msg_empty_result_recovery"),
                },
              ).pipe(Effect.orDie)
            }),
          interrupt: () => Effect.void,
          revert: {
            stage: () => Effect.die("unused"),
            clear: () => Effect.die("unused"),
            commit: () => Effect.die("unused"),
          },
        }),
        Layer.mock(SessionTools.Service, {
          register: (_sessionID, registered) =>
            Effect.sync(() => {
              Object.assign(tools, registered)
            }),
          entries: () => new Map(),
        }),
      )

      const result = yield* WorkflowRuntime.Service.use((runtime) =>
        runtime.runChild({
          id: "empty-result-recovery",
          parentID: parent.id,
          location: parent.location,
          title: "Empty result recovery",
          agent: AgentV2.ID.make("research-planner"),
          timeoutMs: 5_000,
          prompt: "Define the contract",
          result: Schema.Struct({ summary: Schema.String }),
          report: false,
          progress: {
            context: { ...context, execution },
            workflow: "research",
            phase: "contract",
            stage: "planning",
          },
        }),
      ).pipe(Effect.provide(WorkflowRuntime.layer.pipe(Layer.provide(dependencies))))

      expect(result.summary).toBe("Recovered without repeating work")
      expect(resumes).toBe(2)
      expect(prompts).toHaveLength(2)
      expect(prompts[1]).toContain("existing reasoning")
      expect(yield* WorkflowExecution.sessions(execution)).toEqual([
        expect.objectContaining({
          status: "completed",
          recovery_attempts: 1,
        }),
      ])
    }),
  )

  it.effect("gives recursive work inside a writer its own serialized writer lease", () =>
    Effect.gen(function* () {
      const execution = yield* WorkflowExecution.make({
        workflow: "heavy",
        objective: "Root objective",
        sessionID: parent.id,
        toolCallID: "call-root",
        directory: "/project",
        reportDirectory: ".opencode/reports",
        maxDepth: 3,
        maxWorkflows: 8,
        delegates: {
          heavy: new Set(["heavy", "council"]),
          council: new Set(["heavy", "council"]),
        },
      })
      const registered = yield* Deferred.make<void>()
      const dependencies = Layer.mergeAll(
        Layer.mock(EventV2.Service, {
          publish: (definition, data) =>
            Effect.succeed({
              id: EventV2.ID.create(),
              type: definition.type,
              data,
            } as EventV2.Payload<typeof definition>),
        }),
        Layer.mock(SessionV2.Service, {
          create: (input) =>
            Effect.succeed(
              SessionV2.Info.make({
                ...parent,
                id: input.id ?? SessionV2.ID.make("ses_workflow_child"),
                parentID: input.parentID,
                title: input.title ?? "Workflow child",
                agent: input.agent,
                model: input.model,
              }),
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
          interrupt: () => Effect.void,
          revert: {
            stage: () => Effect.die("unused"),
            clear: () => Effect.die("unused"),
            commit: () => Effect.die("unused"),
          },
        }),
        Layer.mock(SessionTools.Service, {
          register: () => Deferred.succeed(registered, undefined),
          entries: () => new Map(),
        }),
      )

      yield* WorkflowRuntime.Service.use((runtime) =>
        Effect.gen(function* () {
          const fiber = yield* runtime
            .runChild({
              id: "locked-child",
              parentID: parent.id,
              location: parent.location,
              title: "Writer child",
              agent: AgentV2.ID.make("heavy-writer"),
              model: parent.model,
              timeoutMs: 1_000,
              prompt: "Implement",
              result: Schema.Struct({ summary: Schema.String }),
              progress: {
                context: { ...context, execution },
                workflow: "heavy",
                phase: "executing",
                stage: "execution",
              },
            })
            .pipe(Effect.flip, Effect.forkChild)
          yield* Deferred.await(registered)
          const inherited = runtime.execution(runtime.childID(parent.id, "locked-child"))
          expect(inherited?.id).toBe(execution.id)
          expect(inherited?.writer).not.toBe(execution.writer)
          if (!inherited) throw new Error("Workflow execution was not inherited")
          yield* TestClock.adjust(750)
          const delegated = yield* WorkflowExecution.delegate(inherited, {
            workflow: "council",
            objective: "Debate one implementation tradeoff",
            sessionID: runtime.childID(parent.id, "locked-child"),
            toolCallID: "call-nested-council",
          })
          yield* TestClock.adjust(5_000)
          expect(fiber.pollUnsafe()).toBeUndefined()
          yield* WorkflowExecution.complete(delegated, {
            status: "completed",
            summary: "The tradeoff was resolved",
            rootSessionID: SessionV2.ID.make("ses_nested_council"),
          })
          yield* TestClock.adjust(250)
          yield* Fiber.join(fiber)
          expect(runtime.execution(runtime.childID(parent.id, "locked-child"))).toBeUndefined()
        }),
      ).pipe(Effect.provide(WorkflowRuntime.layer.pipe(Layer.provide(dependencies))))
    }),
  )
})

function makeRuntime(
  resolve: (input: WorkflowRuntime.ChildInput<Tool.SchemaType<any>>) => unknown,
  checkpoints: Record<string, unknown>[] = [],
): WorkflowRuntime.Interface {
  return {
    childID: (_parentID, id) => SessionV2.ID.make(`ses_${id}`),
    execution: () => undefined,
    runChild: <Result extends Tool.SchemaType<any>>(input: WorkflowRuntime.ChildInput<Result>) =>
      Effect.suspend(() => {
        const result = resolve(input)
        if (result instanceof Tool.Failure) return Effect.fail(result)
        return Effect.gen(function* () {
          const decoded = Schema.decodeUnknownSync(input.result)(result)
          const failure = input.validateResult?.(decoded)
          if (failure) return yield* new Tool.Failure({ message: failure })
          return decoded
        })
      }),
    progress: (_context, structured) =>
      Effect.sync(() => {
        checkpoints.push(structured)
      }),
  }
}

function coveredDeliverables(input: WorkflowRuntime.ChildInput<Tool.SchemaType<any>>) {
  const match = input.prompt.match(/Contract deliverables:\n(\[[\s\S]*?\])\n\nWave:/)
  const deliverables = match ? (JSON.parse(match[1]) as ReadonlyArray<string>) : []
  return deliverables.map((deliverable) => ({
    deliverable,
    status: "covered" as const,
    reason: "The completed evidence tasks cover this contract deliverable.",
  }))
}

function researchSettings(): ResearchWorkflow.Settings {
  return {
    effort: "deep",
    capability: "read",
    minDepth: 2,
    maxDepth: 2,
    maxBranchesPerNode: 4,
    minEvidencePerBranch: 2,
    tasksPerWave: 4,
    maxWaves: 3,
    maxNodes: 16,
    concurrency: 4,
    childTimeoutMs: 60_000,
    debateSensitivity: "balanced",
    maxDebatesPerNode: 1,
    minimumReportWords: 1_200,
    onFailure: "keep",
    models: {},
  }
}

function researchBranch(summary: string) {
  return {
    status: "completed" as const,
    summary,
    claims: [],
    evidence: [],
    gaps: [],
    disputes: [],
    assumptions: [],
    conclusions: [],
    recommendations: [],
    limitations: [],
  }
}

async function writeArtifact(execution: WorkflowExecution.Context, sessionID: SessionV2.ID, content: string) {
  const reportPath = WorkflowExecution.stageReportPath(execution, sessionID)
  await mkdir(path.dirname(reportPath), { recursive: true })
  await Bun.write(reportPath, `# Test report\n\n${content}\n`)
}
