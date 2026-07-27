export * as StudioWorkflow from "./studio"

import { Effect } from "effect"
import { AgentV2 } from "../agent"
import { SessionSchema } from "../session/schema"
import { Hash } from "../util/hash"
import { WorkflowExecution } from "./execution"
import { WorkflowReport } from "./report"
import { WorkflowRuntime } from "./runtime"
import { WorkflowSchema } from "./schema"

export interface Settings {
  readonly concepts: number
  readonly concurrency: number
  readonly childTimeoutMs: number
  readonly finalizationRetries?: number
  readonly maxPromptBytes?: number
  readonly minimumReportWords: number
  readonly models: {
    readonly planner?: string
    readonly creator?: string
    readonly critic?: string
    readonly director?: string
  }
}

export function run(
  objective: string,
  parent: SessionSchema.Info,
  context: WorkflowRuntime.RunContext,
  settings: Settings,
  runtime: WorkflowRuntime.Interface,
) {
  return Effect.gen(function* () {
    const runID = `studio:${Hash.fast(`${context.execution?.id ?? context.toolCallID}:${objective}`).slice(0, 12)}`
    const planID = `${runID}:plan`
    const rootSessionID = runtime.childID(parent.id, planID)
    yield* runtime.progress(
      context,
      {
        workflow: "studio",
        phase: "planning",
        session_id: rootSessionID,
        root_session_id: rootSessionID,
      },
      "Studio is interpreting the creative brief",
    )
    const planned = yield* WorkflowReport.prompt(
      "Studio brief",
      planPrompt(objective, settings.concepts),
      settings.maxPromptBytes,
    )
      .pipe(
        Effect.flatMap((prompt) =>
          runtime.runChild({
            id: planID,
            parentID: parent.id,
            location: parent.location,
            title: "Studio brief",
            agent: AgentV2.ID.make("studio-planner"),
            model: WorkflowRuntime.resolveModel(parent.model, settings.models.planner),
            timeoutMs: settings.childTimeoutMs,
            finalizationRetries: settings.finalizationRetries,
            maxPromptBytes: settings.maxPromptBytes,
            result: WorkflowSchema.StudioPlanSubmission,
            report: false,
            prompt,
            progress: {
              context,
              workflow: "studio",
              phase: "planning",
              stage: "brief",
              details: {
                node_id: runID,
                node_depth: 0,
              },
            },
          }),
        ),
      )
      .pipe(
        Effect.map((plan) => ({ plan, failure: undefined as string | undefined })),
        Effect.catch((error) =>
          runtime
            .progress(
              context,
              {
                workflow: "studio",
                phase: "recovering",
                stage: "brief",
                session_id: rootSessionID,
                root_session_id: rootSessionID,
                error: error.message,
              },
              `Studio brief failed; using a general creative contract: ${error.message}`,
            )
            .pipe(Effect.as({ plan: fallbackPlan(objective), failure: error.message })),
        ),
      )
    const plan = normalizePlan(planned.plan, objective, settings.concepts)
    const conceptSessionIDs = plan.concepts.map((concept) =>
      runtime.childID(rootSessionID, `${runID}:concept:${concept.id}`),
    )
    yield* runtime.progress(
      context,
      {
        workflow: "studio",
        phase: "creating",
        session_id: rootSessionID,
        session_ids: conceptSessionIDs,
        root_session_id: rootSessionID,
        total: plan.concepts.length,
      },
      `Studio is developing ${plan.concepts.length} distinct concepts`,
    )
    const conceptResults = yield* Effect.forEach(
      plan.concepts,
      (spec) => {
        const id = `${runID}:concept:${spec.id}`
        const sessionID = runtime.childID(rootSessionID, id)
        return WorkflowReport.prompt(
          `Studio concept ${spec.title}`,
          conceptPrompt(objective, plan, spec),
          settings.maxPromptBytes,
        )
          .pipe(
            Effect.flatMap((prompt) =>
              runtime.runChild({
                id,
                parentID: rootSessionID,
                location: parent.location,
                title: `Studio: ${spec.title}`,
                agent: AgentV2.ID.make("studio-creator"),
                model: WorkflowRuntime.resolveModel(parent.model, settings.models.creator),
                timeoutMs: settings.childTimeoutMs,
                finalizationRetries: settings.finalizationRetries,
                maxPromptBytes: settings.maxPromptBytes,
                result: WorkflowSchema.StudioConceptSubmission,
                validateResult: (result) => validateConcept(plan.deliverables, result),
                prompt,
                progress: {
                  context,
                  workflow: "studio",
                  phase: "creating",
                  stage: "concept",
                  details: {
                    node_id: spec.id,
                    parent_node_id: runID,
                    node_depth: 1,
                  },
                },
              }),
            ),
          )
          .pipe(
            Effect.map((result) => ({
              result: normalizeConcept(
                result,
                spec,
                plan.deliverables,
                sessionID,
                context.execution ? WorkflowExecution.stageReportPath(context.execution, sessionID) : undefined,
              ),
            })),
            Effect.catch((error) =>
              runtime
                .progress(
                  context,
                  {
                    workflow: "studio",
                    phase: "failed",
                    stage: "concept",
                    session_id: sessionID,
                    root_session_id: rootSessionID,
                    concept_id: spec.id,
                    error: error.message,
                  },
                  `Studio concept ${spec.title} failed: ${error.message}`,
                )
                .pipe(Effect.as({ error: error.message })),
            ),
          )
      },
      { concurrency: settings.concurrency },
    )
    const concepts = conceptResults.flatMap((item) => ("result" in item ? [item.result] : []))
    const conceptFailures = conceptResults.flatMap((item) => ("error" in item ? [item.error] : []))
    const conceptArtifacts = concepts.map((concept) => ({
      id: `concept-${concept.concept_id}`,
      title: `Concept: ${concept.title}`,
      reportPath: concept.report_path,
    }))
    const critiqueID = `${runID}:critique`
    const critiqueSessionID = runtime.childID(rootSessionID, critiqueID)
    yield* runtime.progress(
      context,
      {
        workflow: "studio",
        phase: "critiquing",
        session_id: critiqueSessionID,
        root_session_id: rootSessionID,
      },
      "Studio is comparing brief fit, completeness, and distinctness",
    )
    const critiqued = yield* WorkflowReport.prompt(
      "Studio critique",
      critiquePrompt(objective, plan, concepts, conceptArtifacts, conceptFailures),
      settings.maxPromptBytes,
    )
      .pipe(
        Effect.flatMap((prompt) =>
          runtime.runChild({
            id: critiqueID,
            parentID: rootSessionID,
            location: parent.location,
            title: "Studio critique",
            agent: AgentV2.ID.make("studio-critic"),
            model: WorkflowRuntime.resolveModel(parent.model, settings.models.critic),
            timeoutMs: settings.childTimeoutMs,
            finalizationRetries: settings.finalizationRetries,
            maxPromptBytes: settings.maxPromptBytes,
            result: WorkflowSchema.StudioCritiqueSubmission,
            validateResult: (result) =>
              validateCritique(
                concepts,
                conceptArtifacts,
                result,
                runtime.reportReads?.(critiqueSessionID) ?? [],
                context.execution !== undefined,
              ),
            reportSources: reportSources(conceptArtifacts),
            reportReadMode: "artifacts",
            prompt,
            progress: {
              context,
              workflow: "studio",
              phase: "critiquing",
              stage: "critique",
              details: {
                node_id: critiqueID,
                parent_node_id: runID,
                node_depth: 1,
              },
            },
          }),
        ),
      )
      .pipe(
        Effect.map((result) => ({ result, failure: undefined as string | undefined })),
        Effect.catch((error) =>
          runtime
            .progress(
              context,
              {
                workflow: "studio",
                phase: "recovering",
                stage: "critique",
                session_id: critiqueSessionID,
                root_session_id: rootSessionID,
                error: error.message,
              },
              `Studio critique failed; preserving the developed concepts: ${error.message}`,
            )
            .pipe(Effect.as({ result: fallbackCritique(concepts, error.message), failure: error.message })),
        ),
      )
    const critique = WorkflowSchema.StudioCritique.make({
      ...normalizeCritique(critiqued.result, concepts),
      session_id: critiqueSessionID,
      report_path: context.execution
        ? WorkflowExecution.stageReportPath(context.execution, critiqueSessionID)
        : undefined,
    })
    const critiqueReportPath = critique.report_path
    const critiqueReportAvailable =
      critiqueReportPath && (yield* Effect.promise(() => Bun.file(critiqueReportPath).exists()))
    const artifacts = [
      ...conceptArtifacts,
      ...(critiqueReportAvailable
        ? [
            {
              id: "studio-critique",
              title: "Comparative critique",
              reportPath: critiqueReportPath,
            },
          ]
        : []),
    ]
    const synthesisID = `${runID}:director`
    const synthesisSessionID = runtime.childID(rootSessionID, synthesisID)
    yield* runtime.progress(
      context,
      {
        workflow: "studio",
        phase: "directing",
        session_id: synthesisSessionID,
        root_session_id: rootSessionID,
      },
      "Studio is authoring the final creative document",
    )
    const directed = yield* WorkflowReport.prompt(
      "Studio direction",
      directionPrompt(objective, plan, concepts, critique, artifacts, conceptFailures),
      settings.maxPromptBytes,
    )
      .pipe(
        Effect.flatMap((prompt) =>
          runtime.runChild({
            id: synthesisID,
            parentID: rootSessionID,
            location: parent.location,
            title: "Studio direction",
            agent: AgentV2.ID.make("studio-director"),
            model: WorkflowRuntime.resolveModel(parent.model, settings.models.director),
            timeoutMs: settings.childTimeoutMs,
            finalizationRetries: settings.finalizationRetries,
            maxPromptBytes: settings.maxPromptBytes,
            result: WorkflowSchema.StudioSynthesisSubmission,
            validateResult: (result) =>
              validateSynthesis(
                plan,
                concepts,
                artifacts,
                result,
                runtime.reportReads?.(synthesisSessionID) ?? [],
                context.execution !== undefined,
              ),
            reportSources: reportSources(artifacts),
            reportPath: context.execution?.reportPath,
            reportMode: "document",
            reportReadMode: "artifacts",
            prompt,
            progress: {
              context,
              workflow: "studio",
              phase: "directing",
              stage: "direction",
              details: {
                node_id: synthesisID,
                parent_node_id: runID,
                node_depth: 1,
              },
            },
          }),
        ),
      )
      .pipe(
        Effect.map((result) => ({ result, failure: undefined as string | undefined })),
        Effect.catch((error) =>
          runtime
            .progress(
              context,
              {
                workflow: "studio",
                phase: "recovering",
                stage: "direction",
                session_id: synthesisSessionID,
                root_session_id: rootSessionID,
                error: error.message,
              },
              `Studio direction failed; preserving concepts and critique: ${error.message}`,
            )
            .pipe(
              Effect.as({
                result: fallbackSynthesis(plan, concepts, error.message),
                failure: error.message,
              }),
            ),
        ),
      )
    const synthesisCoverage = yield* Effect.promise(() =>
      artifactCoverage(
        artifacts,
        directed.result.coverage ?? [],
        runtime.reportReads?.(synthesisSessionID) ?? [],
        context.execution !== undefined,
      ),
    )
    const synthesis = WorkflowSchema.StudioSynthesis.make({
      ...normalizeSynthesis(directed.result, plan, concepts),
      coverage: synthesisCoverage,
    })
    const missingCoverage = context.execution ? WorkflowReport.unaccountedCoverage(synthesisCoverage).length : 0
    const incompleteDeliverables = synthesis.deliverable_coverage.filter((item) => item.status !== "complete").length
    const status =
      concepts.length === 0
        ? "failed"
        : planned.failure ||
            conceptFailures.length > 0 ||
            concepts.some((concept) => concept.status !== "completed") ||
            critiqued.failure ||
            critique.status !== "completed" ||
            directed.failure ||
            missingCoverage > 0 ||
            incompleteDeliverables > 0
          ? "partial"
          : synthesis.status
    const reportPath = context.execution?.reportPath
    const evaluation = yield* Effect.promise(() =>
      evaluate(plan, concepts, critique, synthesis, reportPath, settings.minimumReportWords),
    )
    return WorkflowSchema.StudioOutput.make({
      workflow: "studio",
      status: context.execution && status === "completed" && !evaluation.standalone_pass ? "partial" : status,
      summary: synthesis.summary,
      root_session_id: rootSessionID,
      critique_session_id: critiqueSessionID,
      synthesis_session_id: synthesisSessionID,
      synthesis_report_path: reportPath,
      report_path: reportPath,
      plan,
      concepts,
      critique,
      synthesis,
      evaluation,
    })
  })
}

export async function evaluate(
  plan: WorkflowSchema.StudioPlan,
  concepts: ReadonlyArray<WorkflowSchema.StudioConcept>,
  critique: WorkflowSchema.StudioCritique,
  synthesis: WorkflowSchema.StudioSynthesis,
  reportPath: string | undefined,
  minimumReportWords: number,
  diagnostics?: {
    readonly sessions?: ReadonlyArray<WorkflowSchema.SessionStage>
    readonly delegations?: ReadonlyArray<WorkflowSchema.Delegation>
    readonly usage?: WorkflowSchema.Usage
  },
) {
  const report = reportPath && (await Bun.file(reportPath).exists()) ? await Bun.file(reportPath).text() : ""
  const words = report.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0
  const sections = report.match(/^#{1,6}\s+\S+/gm)?.length ?? 0
  const preserved = new Set(synthesis.preserved_concept_ids)
  const sessions = diagnostics?.sessions ?? []
  const delegations = diagnostics?.delegations ?? []
  const deliverables = synthesis.deliverable_coverage
  const coverageComplete =
    WorkflowReport.unaccountedCoverage(synthesis.coverage ?? []).length === 0 &&
    deliverables.length === plan.deliverables.length &&
    deliverables.every((item) => item.status !== "missing") &&
    concepts.every((concept) => preserved.has(concept.concept_id))
  return WorkflowSchema.StudioEvaluation.make({
    report_words: words,
    report_sections: sections,
    standalone_pass: words >= minimumReportWords && coverageComplete,
    concepts_planned: plan.concepts.length,
    concepts_completed: concepts.filter((concept) => concept.status !== "failed").length,
    concepts_preserved: concepts.filter((concept) => preserved.has(concept.concept_id)).length,
    concepts_distinct: critique.assessments.filter((assessment) => assessment.distinctive_elements.length > 0).length,
    deliverables_total: plan.deliverables.length,
    deliverables_complete: deliverables.filter((item) => item.status === "complete").length,
    deliverables_partial: deliverables.filter((item) => item.status === "partial").length,
    deliverables_missing: deliverables.filter((item) => item.status === "missing").length,
    coverage_complete: coverageComplete,
    total_sessions: sessions.length,
    failed_sessions: sessions.filter((session) => session.status !== "completed").length,
    delegated_workflows: delegations.length,
    research_invocations: delegations.filter((delegation) => delegation.workflow === "research").length,
    tool_calls: sessions.reduce((total, session) => total + (session.tool_calls ?? 0), 0),
    tool_errors: sessions.reduce((total, session) => total + (session.tool_errors ?? 0), 0),
    usage: diagnostics?.usage,
  })
}

const defaultConcepts = [
  {
    id: "essential",
    title: "Essential interpretation",
    mandate:
      "Find the clearest, most coherent form of the brief and make every component reinforce one strong promise.",
    differentiators: ["clarity", "coherence", "economy"],
    exclusions: ["ornament without consequence"],
  },
  {
    id: "transformative",
    title: "Transformative interpretation",
    mandate: "Change the underlying structure or causal mechanism while still satisfying every explicit requirement.",
    differentiators: ["structural departure", "new causal logic", "high contrast"],
    exclusions: ["surface-only novelty"],
  },
  {
    id: "plural",
    title: "Plural interpretation",
    mandate:
      "Build a flexible concept whose tensions and variants create meaningful choice without losing a recognizable core.",
    differentiators: ["productive tension", "range", "adaptability"],
    exclusions: ["an incoherent collection of unrelated ideas"],
  },
  {
    id: "counterpoint",
    title: "Counterpoint interpretation",
    mandate:
      "Challenge the most likely default assumption and develop the strongest credible alternative around that inversion.",
    differentiators: ["assumption reversal", "surprise", "critical contrast"],
    exclusions: ["contrarianism without practical value"],
  },
  {
    id: "experiential",
    title: "Experiential interpretation",
    mandate: "Organize the concept around the audience's sequence of discovery, emotion, and participation.",
    differentiators: ["experience arc", "participation", "emotional logic"],
    exclusions: ["a static premise with no lived progression"],
  },
  {
    id: "systemic",
    title: "Systemic interpretation",
    mandate:
      "Make the requested parts operate as one generative system with explicit rules, consequences, and evolution.",
    differentiators: ["interlocking mechanics", "emergence", "long-term development"],
    exclusions: ["isolated components that do not affect one another"],
  },
] satisfies ReadonlyArray<WorkflowSchema.StudioConceptSpec>

function fallbackPlan(objective: string) {
  return WorkflowSchema.StudioPlan.make({
    rationale: "A compact creative contract preserves divergence while covering the explicit brief.",
    objective,
    deliverables: [
      "A complete response to the explicit creative brief",
      "Concrete details for every requested component",
      "Material tradeoffs and unresolved choices",
    ],
    constraints: [],
    assumptions: [],
    choice_points: [],
    concepts: [],
  })
}

function normalizePlan(plan: WorkflowSchema.StudioPlan, objective: string, count: number) {
  const proposed = plan.concepts.filter(
    (concept, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.title.trim().toLowerCase() === concept.title.trim().toLowerCase() ||
          candidate.mandate.trim().toLowerCase() === concept.mandate.trim().toLowerCase(),
      ) === index,
  )
  const concepts = [
    ...proposed,
    ...defaultConcepts.filter((candidate) =>
      proposed.every((concept) => concept.title.trim().toLowerCase() !== candidate.title.toLowerCase()),
    ),
  ]
    .slice(0, count)
    .map((concept, index) => WorkflowSchema.StudioConceptSpec.make({ ...concept, id: `concept-${index + 1}` }))
  return WorkflowSchema.StudioPlan.make({
    ...plan,
    objective: plan.objective.trim() || objective,
    deliverables:
      plan.deliverables.length > 0
        ? plan.deliverables
        : ["A complete response to the explicit creative brief", "Concrete details for every requested component"],
    concepts,
  })
}

function normalizeConcept(
  result: WorkflowSchema.StudioConceptResult,
  spec: WorkflowSchema.StudioConceptSpec,
  deliverables: ReadonlyArray<string>,
  sessionID: SessionSchema.ID,
  reportPath: string | undefined,
) {
  return WorkflowSchema.StudioConcept.make({
    ...result,
    concept_id: spec.id,
    title: spec.title,
    deliverables: deliverables.map(
      (deliverable) =>
        result.deliverables.find((item) => sameText(item.deliverable, deliverable)) ?? {
          deliverable,
          content: "This required deliverable was not represented in the compact concept index.",
        },
    ),
    session_id: sessionID,
    report_path: reportPath,
  })
}

function normalizeCritique(
  result: WorkflowSchema.StudioCritiqueResult,
  concepts: ReadonlyArray<WorkflowSchema.StudioConcept>,
) {
  return WorkflowSchema.StudioCritiqueResult.make({
    ...result,
    assessments: concepts.map(
      (concept) =>
        result.assessments.find((assessment) => assessment.concept_id === concept.concept_id) ?? {
          concept_id: concept.concept_id,
          disposition: "hold",
          strengths: [],
          weaknesses: ["The critique did not assess this concept."],
          missing_deliverables: [],
          overlaps: [],
          distinctive_elements: [],
        },
    ),
  })
}

function normalizeSynthesis(
  result: WorkflowSchema.StudioSynthesis,
  plan: WorkflowSchema.StudioPlan,
  concepts: ReadonlyArray<WorkflowSchema.StudioConcept>,
) {
  return WorkflowSchema.StudioSynthesis.make({
    ...result,
    preserved_concept_ids: Array.from(
      new Set([...result.preserved_concept_ids, ...concepts.map((concept) => concept.concept_id)]),
    ),
    deliverable_coverage: plan.deliverables.map(
      (deliverable) =>
        result.deliverable_coverage.find((coverage) => sameText(coverage.deliverable, deliverable)) ?? {
          deliverable,
          status: "missing",
          concept_ids: [],
          limitations: ["The director did not account for this required deliverable."],
        },
    ),
  })
}

function fallbackCritique(concepts: ReadonlyArray<WorkflowSchema.StudioConcept>, error: string) {
  return WorkflowSchema.StudioCritiqueResult.make({
    status: concepts.length > 0 ? "partial" : "failed",
    summary: `Comparative critique failed, so the developed concepts are preserved without a reliable ranking: ${error}`,
    assessments: concepts.map((concept) => ({
      concept_id: concept.concept_id,
      disposition: "hold",
      strengths: concept.differentiators,
      weaknesses: ["No completed cross-concept critique is available."],
      missing_deliverables: [],
      overlaps: [],
      distinctive_elements: [],
    })),
    cross_concept_patterns: [],
    missing_requirements: [],
    recommendations: ["Review the preserved concepts directly before choosing among them."],
  })
}

function fallbackSynthesis(
  plan: WorkflowSchema.StudioPlan,
  concepts: ReadonlyArray<WorkflowSchema.StudioConcept>,
  error: string,
) {
  return WorkflowSchema.StudioSynthesis.make({
    status: concepts.length > 0 ? "partial" : "failed",
    summary: `Final direction failed, so the completed concepts remain available without a director-authored synthesis: ${error}`,
    recommended_concept_ids: [],
    preserved_concept_ids: concepts.map((concept) => concept.concept_id),
    deliverable_coverage: plan.deliverables.map((deliverable) => ({
      deliverable,
      status: concepts.some((concept) => concept.deliverables.some((item) => sameText(item.deliverable, deliverable)))
        ? "partial"
        : "missing",
      concept_ids: concepts.flatMap((concept) =>
        concept.deliverables.some((item) => sameText(item.deliverable, deliverable)) ? [concept.concept_id] : [],
      ),
      limitations: ["The final director document was not completed."],
    })),
    decisions: [],
    tradeoffs: concepts.flatMap((concept) => concept.tradeoffs),
    next_choices: ["Choose among the preserved concepts after reviewing their durable dossiers."],
  })
}

function validateConcept(deliverables: ReadonlyArray<string>, result: WorkflowSchema.StudioConceptResult) {
  const missing = deliverables.filter(
    (deliverable) => !result.deliverables.some((item) => sameText(item.deliverable, deliverable)),
  )
  const duplicate = result.deliverables.find(
    (item, index, all) => all.findIndex((candidate) => sameText(candidate.deliverable, item.deliverable)) !== index,
  )
  if (missing.length === 0 && !duplicate) return
  return [
    ...(missing.length > 0 ? [`Missing required deliverables: ${missing.join(", ")}`] : []),
    ...(duplicate ? [`Duplicate deliverable: ${duplicate.deliverable}`] : []),
  ].join(". ")
}

function validateCritique(
  concepts: ReadonlyArray<WorkflowSchema.StudioConcept>,
  artifacts: ReadonlyArray<WorkflowReport.Artifact>,
  result: WorkflowSchema.StudioCritiqueResult,
  reads: ReadonlyArray<string>,
  requireReports: boolean,
) {
  const missing = concepts.filter(
    (concept) => !result.assessments.some((assessment) => assessment.concept_id === concept.concept_id),
  )
  if (missing.length > 0)
    return `Studio critique must assess every completed concept. Missing: ${missing
      .map((concept) => concept.concept_id)
      .join(", ")}`
  return validateArtifactUse(artifacts, result.coverage ?? [], reads, requireReports, "Studio critique")
}

function validateSynthesis(
  plan: WorkflowSchema.StudioPlan,
  concepts: ReadonlyArray<WorkflowSchema.StudioConcept>,
  artifacts: ReadonlyArray<WorkflowReport.Artifact>,
  result: WorkflowSchema.StudioSynthesis,
  reads: ReadonlyArray<string>,
  requireReports: boolean,
) {
  const missingDeliverables = plan.deliverables.filter(
    (deliverable) => !result.deliverable_coverage.some((coverage) => sameText(coverage.deliverable, deliverable)),
  )
  if (missingDeliverables.length > 0)
    return `Studio direction must account for every brief deliverable. Missing: ${missingDeliverables.join(", ")}`
  const missingConcepts = concepts.filter((concept) => !result.preserved_concept_ids.includes(concept.concept_id))
  if (missingConcepts.length > 0)
    return `Studio direction must preserve every materially developed option. Missing: ${missingConcepts
      .map((concept) => concept.concept_id)
      .join(", ")}`
  return validateArtifactUse(artifacts, result.coverage ?? [], reads, requireReports, "Studio direction")
}

function validateArtifactUse(
  artifacts: ReadonlyArray<WorkflowReport.Artifact>,
  coverage: ReadonlyArray<WorkflowSchema.ArtifactCoverage>,
  reads: ReadonlyArray<string>,
  required: boolean,
  stage: string,
) {
  if (!required) return
  const unread = artifacts.filter((artifact) => artifact.reportPath && !reads.includes(artifact.reportPath))
  if (unread.length > 0)
    return `${stage} must read every authorized report. Unread: ${unread.map((item) => item.title).join(", ")}`
  const missing = artifacts.filter(
    (artifact) =>
      artifact.reportPath &&
      !coverage.some(
        (entry) =>
          (entry.artifact_id === artifact.id || entry.report_path === artifact.reportPath) &&
          entry.used.length + entry.rejected.length + entry.unresolved.length > 0,
      ),
  )
  if (missing.length === 0) return
  return `${stage} must record one substantive disposition for every authorized report. Missing: ${missing
    .map((item) => item.title)
    .join(", ")}`
}

async function artifactCoverage(
  artifacts: ReadonlyArray<WorkflowReport.Artifact>,
  submitted: ReadonlyArray<WorkflowSchema.ArtifactCoverage>,
  reads: ReadonlyArray<string>,
  requireReports: boolean,
) {
  return WorkflowReport.coverage(
    artifacts,
    artifacts.map((artifact) => {
      const explicit = submitted.find(
        (item) =>
          (artifact.id !== undefined && item.artifact_id === artifact.id) || item.report_path === artifact.reportPath,
      )
      return WorkflowSchema.ArtifactCoverage.make({
        artifact_id: artifact.id,
        title: artifact.title,
        report_path: artifact.reportPath,
        received: true,
        used: explicit?.used ?? [],
        rejected: explicit?.rejected ?? [],
        unresolved: [
          ...(explicit?.unresolved ?? []),
          ...(requireReports && artifact.reportPath && !reads.includes(artifact.reportPath)
            ? ["The final report author did not read this artifact."]
            : []),
        ],
      })
    }),
  )
}

function reportSources(artifacts: ReadonlyArray<WorkflowReport.Artifact>) {
  return artifacts.flatMap((artifact) =>
    artifact.id && artifact.reportPath
      ? [{ id: artifact.id, title: artifact.title, reportPath: artifact.reportPath }]
      : [],
  )
}

function planPrompt(objective: string, concepts: number) {
  return `Interpret this request as a creative brief:

${objective}

Infer the concrete deliverables the final response must contain, the explicit constraints, unavoidable assumptions, and the choices the user has left open. Then define exactly ${concepts} materially distinct concept mandates.

Distinctness must come from structure, causal logic, audience experience, operating rules, values, or another consequential axis—not merely tone, names, styling, or perspective labels. Each mandate must still cover the complete brief. State what makes each route different and what it must avoid so the routes do not converge.

This is domain-general creative planning. Do not research, inspect the workspace, answer the brief, rank concepts, or import a stock domain template. Call workflow_result exactly once with the compact creative contract.`
}

function conceptPrompt(objective: string, plan: WorkflowSchema.StudioPlan, concept: WorkflowSchema.StudioConceptSpec) {
  return `Develop one complete creative concept.

Original brief:
${objective}

Creative contract:
${JSON.stringify(
  {
    objective: plan.objective,
    deliverables: plan.deliverables,
    constraints: plan.constraints,
    assumptions: plan.assumptions,
    choice_points: plan.choice_points,
  },
  undefined,
  2,
)}

Your concept mandate:
${JSON.stringify(concept, undefined, 2)}

Fully instantiate every contract deliverable under its exact wording. Be concrete enough that the user can imagine, compare, or continue developing the result. Invent coherent details where the brief invites invention; expose consequential open choices instead of hiding them. Make the mandate's causal and experiential differences visible throughout the concept, not just in its title.

Do not browse, research, convene Council, delegate creative judgment, or claim that an invention is globally unprecedented. The durable workflow_report must be a self-contained concept dossier rather than a process note. Then call workflow_result with the exact concept ID, one compact entry for every deliverable, differentiators, honest tradeoffs, risks, and open choices.`
}

function critiquePrompt(
  objective: string,
  plan: WorkflowSchema.StudioPlan,
  concepts: ReadonlyArray<WorkflowSchema.StudioConcept>,
  artifacts: ReadonlyArray<WorkflowReport.Artifact>,
  failures: ReadonlyArray<string>,
) {
  return `Compare developed creative concepts without prematurely collapsing them.

Original brief:
${objective}

Creative contract:
${JSON.stringify(plan, undefined, 2)}

Completed concept indexes:
${JSON.stringify(
  concepts.map((concept) => ({
    concept_id: concept.concept_id,
    title: concept.title,
    pitch: concept.pitch,
    deliverables: concept.deliverables,
    differentiators: concept.differentiators,
    tradeoffs: concept.tradeoffs,
    risks: concept.risks,
    open_choices: concept.open_choices,
  })),
  undefined,
  2,
)}

Authorized concept artifacts:
${JSON.stringify(
  artifacts.map((artifact) => ({ artifact_id: artifact.id, title: artifact.title, available: !!artifact.reportPath })),
  undefined,
  2,
)}

Concept failures:
${JSON.stringify(failures, undefined, 2)}

Read every authorized concept artifact with workflow_read_reports({ all: true }). Audit each concept for brief fit, concrete completeness, internal coherence, meaningful distinctness, hidden convergence, and useful tradeoffs. Preserve the strongest exclusive elements of weaker concepts. Do not choose a single winner or rewrite the concepts.

Do not browse or perform general evidence gathering. You may call research_run at most once only when a narrow external factual, legal, scientific, or cultural uncertainty could materially invalidate the comparison and Studio has been explicitly configured to allow Research. Give Research that strict uncertainty, never the creative brief or a creative choice. Never call Heavy, Council, or Studio.

Write a complete comparative critique with workflow_report. In workflow_result, assess every exact concept ID and record a substantive used, rejected, or unresolved disposition for every available concept report.`
}

function directionPrompt(
  objective: string,
  plan: WorkflowSchema.StudioPlan,
  concepts: ReadonlyArray<WorkflowSchema.StudioConcept>,
  critique: WorkflowSchema.StudioCritique,
  artifacts: ReadonlyArray<WorkflowReport.Artifact>,
  failures: ReadonlyArray<string>,
) {
  return `Author the final standalone creative document.

Original brief:
${objective}

Creative contract:
${JSON.stringify(plan, undefined, 2)}

Completed concept indexes:
${JSON.stringify(
  concepts.map((concept) => ({
    concept_id: concept.concept_id,
    title: concept.title,
    pitch: concept.pitch,
    deliverables: concept.deliverables,
    differentiators: concept.differentiators,
    tradeoffs: concept.tradeoffs,
    risks: concept.risks,
    open_choices: concept.open_choices,
  })),
  undefined,
  2,
)}

Comparative critique:
${JSON.stringify(critique, undefined, 2)}

Authorized creative artifacts:
${JSON.stringify(
  artifacts.map((artifact) => ({ artifact_id: artifact.id, title: artifact.title, available: !!artifact.reportPath })),
  undefined,
  2,
)}

Failed concept sessions:
${JSON.stringify(failures, undefined, 2)}

Read every authorized artifact with workflow_read_reports({ all: true }). Write for the user, not for the workflow. The final Markdown must stand alone and must not mention agents, sessions, tools, artifact IDs, report paths, or the orchestration process.

Preserve every materially developed option as an intelligible alternative. Reconstruct its important concrete content rather than pointing elsewhere. Explain the consequential differences, tradeoffs, and open choices. You may recommend one option or a combination when the brief supports it, but make that recommendation conditional and do not erase viable alternatives. Choose an outline native to this brief rather than a stock creative template.

Use workflow_report once to write the complete document. Then call workflow_result with every completed concept ID in preserved_concept_ids, an entry using the exact wording of every contract deliverable, and a substantive coverage disposition for every available creative artifact. Do not delegate or research during final direction.`
}

function sameText(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}
