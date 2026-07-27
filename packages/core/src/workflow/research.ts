export * as ResearchWorkflow from "./research"

import { Effect, Ref } from "effect"
import { AgentV2 } from "../agent"
import { SessionSchema } from "../session/schema"
import { Tool } from "../tool/tool"
import { Hash } from "../util/hash"
import { CouncilWorkflow } from "./council"
import { WorkflowExecution } from "./execution"
import { WorkflowReport } from "./report"
import { WorkflowRuntime } from "./runtime"
import { WorkflowSchema } from "./schema"

export interface Settings {
  readonly effort: "standard" | "deep" | "frontier"
  readonly capability: WorkflowSchema.Capability
  readonly minDepth: number
  readonly maxDepth: number
  readonly maxBranchesPerNode: number
  readonly minEvidencePerBranch: number
  readonly tasksPerWave: number
  readonly maxWaves: number
  readonly maxNodes: number
  readonly concurrency: number
  readonly childTimeoutMs: number
  readonly maxTimeMs?: number
  readonly maxTokens?: number
  readonly debateSensitivity: "off" | "low" | "balanced" | "high"
  readonly maxDebatesPerNode: number
  readonly freshnessDays?: number
  readonly minimumReportWords: number
  readonly finalizationRetries?: number
  readonly maxPromptBytes?: number
  readonly onFailure: "keep" | "stop"
  readonly council?: CouncilWorkflow.Settings
  readonly models: {
    readonly planner?: string
    readonly worker?: string
    readonly writer?: string
    readonly assessor?: string
    readonly synthesizer?: string
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
    const budgetAllocated = Math.max(0, settings.maxNodes - 1)
    const remaining = yield* Ref.make(budgetAllocated)
    const cache = yield* Ref.make<ReadonlyMap<string, CachedArtifact>>(new Map())
    const startedAt = Date.now()
    const root = yield* executeNode({
      id: `research-${Hash.fast(context.toolCallID).slice(0, 12)}`,
      title: "Research root",
      objective,
      depth: 0,
      parentID: parent.id,
      rootObjective: objective,
      inheritedContext: [],
      inheritedArtifacts: [],
      parent,
      context,
      settings,
      runtime,
      remaining,
      budgetAllocated,
      cache,
      startedAt,
    })
    const councils = mergeCouncilReviews(root.councils)
    const rawGraph = graphFrom(root.ledgers, root.nodes, councils)
    const graph = canonicalGraphFrom(root.result, rawGraph, root.nodes, councils)
    const evaluation = yield* Effect.promise(() => evaluate(root.nodes, graph, councils, settings.minimumReportWords))
    const status =
      root.nodes.some((node) => node.result.status === "failed") || root.failures.length > 0
        ? root.result.status === "failed"
          ? "failed"
          : "partial"
        : root.nodes.some((node) => node.result.status === "partial")
          ? "partial"
          : root.result.status
    return WorkflowSchema.ResearchOutput.make({
      workflow: "research",
      status,
      summary: root.result.summary,
      root_session_id: root.planningSessionID,
      nodes: root.nodes,
      raw_graph: rawGraph,
      graph,
      evaluation,
      councils,
    })
  })
}

type ExecuteNodeInput = {
  readonly id: string
  readonly parentNodeID?: string
  readonly title: string
  readonly objective: string
  readonly depth: number
  readonly parentID: SessionSchema.ID
  readonly rootObjective: string
  readonly inheritedContext: ReadonlyArray<string>
  readonly inheritedArtifacts: ReadonlyArray<InheritedArtifact>
  readonly parent: SessionSchema.Info
  readonly context: WorkflowRuntime.RunContext
  readonly settings: Settings
  readonly runtime: WorkflowRuntime.Interface
  readonly remaining: Ref.Ref<number>
  readonly budgetAllocated: number
  readonly cache: Ref.Ref<ReadonlyMap<string, CachedArtifact>>
  readonly startedAt: number
}

type NodeExecution = {
  readonly planningSessionID: SessionSchema.ID
  readonly result: WorkflowSchema.ResearchBranchResult
  readonly nodes: ReadonlyArray<WorkflowSchema.ResearchNode>
  readonly councils: ReadonlyArray<WorkflowSchema.ResearchCouncilReview>
  readonly failures: ReadonlyArray<string>
  readonly ledgers: ReadonlyArray<WorkflowSchema.ResearchBranchResult>
}

type CompletedTask = {
  readonly task: WorkflowSchema.ResearchTask
  readonly result: WorkflowSchema.ResearchBranchResult
  readonly nodes: ReadonlyArray<WorkflowSchema.ResearchNode>
  readonly councils: ReadonlyArray<WorkflowSchema.ResearchCouncilReview>
  readonly sessionID: SessionSchema.ID
  readonly reportPath?: string
  readonly nodeID?: string
  readonly ledgers: ReadonlyArray<WorkflowSchema.ResearchBranchResult>
  readonly artifactID?: string
  readonly reused: boolean
  readonly reservedSubtreeSlots?: number
}

type TaskExecution = Omit<CompletedTask, "task">

type ScheduledTask = {
  readonly task: WorkflowSchema.ResearchTask
  readonly reservedSubtreeSlots: number
}

type CachedArtifact = {
  readonly id: string
  readonly result: WorkflowSchema.ResearchBranchResult
  readonly sessionID: SessionSchema.ID
  readonly reportPath?: string
}

type InheritedArtifact = {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly reportPath?: string
}

type WaveState = {
  readonly waves: ReadonlyArray<WorkflowSchema.ResearchWave>
  readonly completed: ReadonlyMap<string, CompletedTask>
  readonly nodes: ReadonlyArray<WorkflowSchema.ResearchNode>
  readonly councils: ReadonlyArray<WorkflowSchema.ResearchCouncilReview>
  readonly failures: ReadonlyArray<string>
}

const executeNode = Effect.fn("ResearchWorkflow.executeNode")(function* (input: ExecuteNodeInput) {
  const planID = `${input.id}:contract`
  const planningSessionID = input.runtime.childID(input.parentID, planID)
  yield* input.runtime.progress(
    input.context,
    {
      workflow: "research",
      phase: "contract",
      depth: input.depth,
      node: input.id,
      session_id: planningSessionID,
    },
    `Research is defining the contract for ${input.title}`,
  )
  const planned = yield* WorkflowReport.prompt(
    `Research contract for ${input.title}`,
    contractPrompt(input),
    input.settings.maxPromptBytes,
  ).pipe(
    Effect.flatMap((prompt) =>
      input.runtime.runChild({
        id: planID,
        parentID: input.parentID,
        location: input.parent.location,
        title: `Research contract: ${input.title}`,
        agent: AgentV2.ID.make("research-planner"),
        model: WorkflowRuntime.resolveModel(input.parent.model, input.settings.models.planner),
        timeoutMs: input.settings.childTimeoutMs,
        finalizationRetries: input.settings.finalizationRetries,
        maxPromptBytes: input.settings.maxPromptBytes,
        result: WorkflowSchema.ResearchContractSubmission,
        reportSources: input.inheritedArtifacts.flatMap((artifact) =>
          artifact.reportPath ? [{ id: artifact.id, title: artifact.title, reportPath: artifact.reportPath }] : [],
        ),
        report: false,
        reportReadMode: "artifacts",
        prompt,
        progress: {
          context: input.context,
          workflow: "research",
          phase: "contract",
          stage: "planning",
          details: {
            node_id: input.id,
            parent_node_id: input.parentNodeID,
            node_depth: input.depth,
            capability: input.settings.capability,
          },
        },
      }),
    ),
    Effect.map((contract) => ({ contract, failure: undefined as string | undefined })),
    Effect.catch((error) =>
      input.runtime
        .progress(
          input.context,
          {
            workflow: "research",
            phase: "recovering",
            stage: "planning",
            depth: input.depth,
            node: input.id,
            session_id: planningSessionID,
            error: error.message,
          },
          `Research contract failed for ${input.title}; investigating directly: ${error.message}`,
        )
        .pipe(
          Effect.as({
            contract: WorkflowSchema.ResearchContract.make({
              rationale: `Contract generation failed; investigate the objective directly: ${error.message}`,
              objective: input.objective,
              deliverables: ["A standalone evidence-backed answer"],
              assumptions: [],
              unknowns: [input.objective],
              falsifiers: [],
              flat_rationale: "Contract planning failed, so the fallback branch stays atomic.",
              tasks: [
                {
                  id: "fallback",
                  title: input.title,
                  question: input.objective,
                  priority: "critical",
                  role: "evidence",
                  mode: "leaf",
                  depends_on: [],
                  rationale: "Direct fallback investigation",
                  expected_evidence: [],
                  decomposition_reason: "A single direct task is the safest recovery after planning failure.",
                },
              ],
            }),
            failure: error.message,
          }),
        ),
    ),
  )
  const plannedTasks =
    planned.contract.tasks.length > 0
      ? planned.contract.tasks
      : [
          WorkflowSchema.ResearchTask.make({
            id: "fallback",
            title: input.title,
            question: input.objective,
            priority: "critical",
            role: "evidence",
            mode: "leaf",
            depends_on: [],
            rationale: "The planner supplied no task, so investigate the bounded branch directly.",
            expected_evidence: [],
            decomposition_reason: "Direct evidence fallback for an empty contract.",
          }),
        ]
  const normalizedTasks = normalizeTasks(
    auditContractTasks(WorkflowSchema.ResearchContract.make({ ...planned.contract, tasks: plannedTasks }), input),
    input,
    1,
    new Map(),
  )
  const contract = WorkflowSchema.ResearchContract.make({
    ...planned.contract,
    objective: input.objective,
    tasks:
      normalizedTasks.length > 0
        ? normalizedTasks
        : [
            WorkflowSchema.ResearchTask.make({
              id: `${input.id}.w1.1`,
              title: input.title,
              question: input.objective,
              priority: "critical",
              role: "evidence",
              mode: "leaf",
              depends_on: [],
              rationale: "Investigate the branch directly after unusable planned tasks were removed.",
              expected_evidence: [],
              decomposition_reason: "Direct evidence fallback after plan normalization.",
            }),
          ],
  })
  const explored = yield* runWaves(
    1,
    contract.tasks,
    {
      waves: [],
      completed: new Map(),
      nodes: [],
      councils: [],
      failures: planned.failure ? [planned.failure] : [],
    },
    contract,
    input,
    planningSessionID,
  )
  const councils = mergeCouncilReviews([
    ...explored.councils,
    ...(yield* reviewDisputes(
      input,
      planningSessionID,
      explored.waves.flatMap((wave) => wave.assessment.disputes),
      explored.completed,
    )),
  ])
  const reviewed = { ...explored, councils } satisfies WaveState
  const budgetUnused = yield* Ref.get(input.remaining)
  const artifacts = unique(
    [
      ...input.inheritedArtifacts.map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        reportPath: artifact.reportPath,
      })),
      ...Array.from(reviewed.completed.values(), (item) => ({
        id: item.artifactID ?? item.task.id,
        title: item.task.title,
        reportPath: item.reportPath,
      })),
      ...reviewed.councils
        .filter((review) => review.node_id === input.id)
        .map((review) => ({
          id: `council-${review.dispute_id}`,
          title: `Council: ${review.question}`,
          reportPath: review.output.report_path ?? review.output.synthesis_report_path,
        })),
    ],
    (artifact) => artifact.id,
  )
  const synthesisID = input.runtime.childID(planningSessionID, `${input.id}:synthesis`)
  const synthesisSkipped = input.depth > 0 && explored.completed.size === 0
  yield* input.runtime.progress(
    input.context,
    {
      workflow: "research",
      phase: synthesisSkipped ? "failed" : "synthesizing",
      depth: input.depth,
      node: input.id,
      session_id: synthesisID,
      artifacts: artifacts.length,
    },
    synthesisSkipped
      ? `Research branch ${input.title} has no evidence to synthesize`
      : input.depth === 0
        ? "Research root is authoring the standalone report"
        : `Research is synthesizing branch ${input.title}`,
  )
  const synthesized = yield* synthesisSkipped
    ? Effect.succeed({
        result: fallbackSynthesis([], "The recursive branch produced no local evidence."),
        failure: "The recursive branch produced no local evidence.",
      })
    : WorkflowReport.prompt(
        `Research synthesis for ${input.title}`,
        synthesisPrompt(input, contract, reviewed, artifacts),
        input.settings.maxPromptBytes,
      ).pipe(
        Effect.flatMap((prompt) =>
          input.runtime.runChild({
            id: `${input.id}:synthesis`,
            parentID: planningSessionID,
            location: input.parent.location,
            title: input.depth === 0 ? "Research final synthesis" : `Research synthesis: ${input.title}`,
            agent: AgentV2.ID.make("research-synthesizer"),
            model: WorkflowRuntime.resolveModel(input.parent.model, input.settings.models.synthesizer),
            timeoutMs: input.settings.childTimeoutMs,
            finalizationRetries: input.settings.finalizationRetries,
            maxPromptBytes: input.settings.maxPromptBytes,
            result: WorkflowSchema.ResearchBranchSubmission,
            reportSources: artifacts.flatMap((artifact) =>
              artifact.reportPath ? [{ id: artifact.id, title: artifact.title, reportPath: artifact.reportPath }] : [],
            ),
            reportPath: input.depth === 0 ? input.context.execution?.reportPath : undefined,
            reportMode: input.depth === 0 ? "document" : "sections",
            reportContentFirst: true,
            reportReadMode: "artifacts",
            prompt,
            progress: {
              context: input.context,
              workflow: "research",
              phase: "synthesizing",
              stage: "synthesis",
              details: {
                node_id: input.id,
                parent_node_id: input.parentNodeID,
                node_depth: input.depth,
                capability: input.settings.capability,
              },
            },
          }),
        ),
        Effect.map((result) => ({ result, failure: undefined as string | undefined })),
        Effect.catch((error) =>
          input.runtime
            .progress(
              input.context,
              {
                workflow: "research",
                phase: "recovering",
                stage: "synthesis",
                depth: input.depth,
                node: input.id,
                session_id: synthesisID,
                error: error.message,
              },
              `Research synthesis failed for ${input.title}; preserving branch reports: ${error.message}`,
            )
            .pipe(
              Effect.as({
                result: fallbackSynthesis(Array.from(reviewed.completed.values()), error.message),
                failure: error.message,
              }),
            ),
        ),
      )
  const reportPath = synthesisSkipped
    ? undefined
    : input.depth === 0
      ? input.context.execution?.reportPath
      : input.context.execution
        ? WorkflowExecution.stageReportPath(input.context.execution, synthesisID)
        : undefined
  const coverage = yield* Effect.promise(() =>
    synthesisCoverage(artifacts, synthesized.result.coverage ?? [], input.runtime.reportReads?.(synthesisID) ?? []),
  )
  const quality = yield* Effect.promise(() =>
    validateDocument(
      reportPath,
      input.depth === 0 ? input.settings.minimumReportWords : Math.min(500, input.settings.minimumReportWords),
    ),
  )
  const deliverableIssues = validateDeliverables(contract, synthesized.result)
  const incompleteCoverage = input.context.execution ? WorkflowReport.unaccountedCoverage(coverage).length > 0 : false
  const result = scopeResult(
    WorkflowSchema.ResearchBranchResult.make({
      ...synthesized.result,
      coverage,
      limitations: [...synthesized.result.limitations, ...quality, ...deliverableIssues],
      status:
        synthesized.failure ||
        reviewed.failures.length > 0 ||
        incompleteCoverage ||
        quality.length > 0 ||
        deliverableIssues.length > 0 ||
        Array.from(reviewed.completed.values()).some((item) => item.result.status !== "completed")
          ? synthesized.result.status === "failed"
            ? "failed"
            : "partial"
          : synthesized.result.status,
    }),
    input.id,
    input.depth === 0 ? undefined : reportPath,
  )
  const node = WorkflowSchema.ResearchNode.make({
    id: input.id,
    parent_id: input.parentNodeID,
    depth: input.depth,
    title: input.title,
    objective: input.objective,
    planning_session_id: planningSessionID,
    synthesis_session_id: synthesisID,
    synthesis_status: synthesisSkipped ? "skipped" : synthesized.failure ? "failed" : "completed",
    report_path: reportPath,
    budget_allocated: input.budgetAllocated,
    budget_unused: budgetUnused,
    contract,
    waves: reviewed.waves,
    result,
  })
  return {
    planningSessionID,
    result,
    nodes: [node, ...reviewed.nodes],
    councils: reviewed.councils,
    failures: [...reviewed.failures, ...(synthesized.failure ? [synthesized.failure] : [])],
    ledgers: [result, ...Array.from(reviewed.completed.values()).flatMap((item) => item.ledgers)],
  } satisfies NodeExecution
})

const runWaves = Effect.fn("ResearchWorkflow.runWaves")(function* (
  number: number,
  proposed: ReadonlyArray<WorkflowSchema.ResearchTask>,
  state: WaveState,
  contract: WorkflowSchema.ResearchContract,
  input: ExecuteNodeInput,
  parentID: SessionSchema.ID,
): Effect.fn.Return<WaveState> {
  const budget = yield* budgetReason(input)
  if (budget || proposed.length === 0 || number > input.settings.maxWaves) {
    if (state.waves.length === 0 && budget)
      return {
        ...state,
        failures: [...state.failures, budget.detail],
      }
    return state
  }
  const reserved = yield* Ref.modify(input.remaining, (remaining) => {
    const allocation = scheduleWaveTasks(proposed, remaining, input)
    return [allocation, remaining - allocation.consumed] as const
  })
  const capped = reserved.capped
  if (reserved.tasks.length === 0)
    return {
      ...state,
      failures: [...state.failures, "Research node budget exhausted before another evidence task could start."],
    }
  yield* input.runtime.progress(
    input.context,
    {
      workflow: "research",
      phase: "wave",
      depth: input.depth,
      node: input.id,
      wave: number,
      tasks: reserved.tasks.length,
    },
    `Research is running evidence wave ${number} with ${reserved.tasks.length} task(s)`,
  )
  const executed = yield* executeWave(reserved.tasks, state.completed, input, parentID, number)
  const completed = new Map([...state.completed, ...executed.map((item) => [item.task.id, item] as const)])
  const artifacts = Array.from(completed.values(), (item) => ({
    id: item.artifactID ?? item.task.id,
    title: item.task.title,
    reportPath: item.reportPath,
  }))
  const assessmentID = `${input.id}:assessment:${number}`
  const assessmentSessionID = input.runtime.childID(parentID, assessmentID)
  const remainingTaskSlots = yield* Ref.get(input.remaining)
  const assessment = yield* WorkflowReport.prompt(
    `Research assessment wave ${number}`,
    assessmentPrompt(input, contract, number, completed, capped, remainingTaskSlots),
    input.settings.maxPromptBytes,
  ).pipe(
    Effect.flatMap((prompt) =>
      input.runtime.runChild({
        id: assessmentID,
        parentID,
        location: input.parent.location,
        title: `Research assessment: wave ${number}`,
        agent: AgentV2.ID.make("research-assessor"),
        model: WorkflowRuntime.resolveModel(input.parent.model, input.settings.models.assessor),
        timeoutMs: input.settings.childTimeoutMs,
        finalizationRetries: input.settings.finalizationRetries,
        maxPromptBytes: input.settings.maxPromptBytes,
        result: WorkflowSchema.ResearchAssessmentSubmission,
        reportSources: artifacts.flatMap((artifact) =>
          artifact.reportPath ? [{ id: artifact.id, title: artifact.title, reportPath: artifact.reportPath }] : [],
        ),
        report: false,
        reportReadMode: "artifacts",
        prompt,
        progress: {
          context: input.context,
          workflow: "research",
          phase: "assessing",
          stage: "assessment",
          details: {
            node_id: input.id,
            parent_node_id: input.parentNodeID,
            node_depth: input.depth,
            round: number,
          },
        },
      }),
    ),
    Effect.map((result) => ({ result, failure: undefined as string | undefined })),
    Effect.catch((error) =>
      Effect.succeed({
        result: WorkflowSchema.ResearchAssessment.make({
          decision: "stop",
          stop_reason: "blocked",
          rationale: `Assessment failed, so no unsupported follow-up wave will be launched: ${error.message}`,
          information_gain: "low",
          coverage: "incomplete",
          addressed_gap_ids: [],
          tasks: [],
          disputes: [],
          deferred_validations: [],
          deliverable_coverage: contract.deliverables.map((deliverable) => ({
            deliverable,
            status: "missing",
            reason: "The assessment failed before contract coverage could be evaluated.",
          })),
        }),
        failure: error.message,
      }),
    ),
  )
  const assessed = enforceDeliverableGate(assessment.result, contract, input, number, remainingTaskSlots)
  const nextTasks = normalizeTasks(auditTasks(assessed.tasks, input, false), input, number + 1, completed)
  const exhausted = yield* budgetReason(input)
  const slotsExhausted = remainingTaskSlots === 0
  const stopCode =
    (assessment.failure ? "blocked" : undefined) ??
    (input.settings.onFailure === "stop" && executed.some((item) => item.result.status === "failed")
      ? "blocked"
      : undefined) ??
    exhausted?.code ??
    (capped.length > 0 ? "budget_exhausted" : undefined) ??
    (slotsExhausted && nextTasks.length > 0 ? "budget_exhausted" : undefined) ??
    (assessed.decision === "stop"
      ? (assessed.stop_reason ?? "evidence_saturated")
      : assessed.information_gain === "low"
        ? "low_information_gain"
        : nextTasks.length === 0
          ? "evidence_saturated"
          : number >= input.settings.maxWaves
            ? "budget_exhausted"
            : undefined)
  const stopReason =
    assessment.failure ??
    (input.settings.onFailure === "stop" && executed.some((item) => item.result.status === "failed")
      ? "The configured stop-on-failure policy halted adaptive research after a failed evidence task."
      : undefined) ??
    exhausted?.detail ??
    (capped.length > 0 ? `${capped.length} task(s) exceeded the remaining node budget.` : undefined) ??
    (slotsExhausted && nextTasks.length > 0
      ? "The local subtree exhausted its allocated evidence-task slots."
      : undefined) ??
    (assessed.decision === "stop"
      ? assessed.rationale
      : assessed.information_gain === "low"
        ? "The assessor projected low information gain from another wave."
        : nextTasks.length === 0
          ? "The assessor supplied no novel evidence task."
          : number >= input.settings.maxWaves
            ? `Reached workflows.research.max_waves (${input.settings.maxWaves}).`
            : undefined)
  const taskRecords = executed.map((item) =>
    WorkflowSchema.ResearchTaskRecord.make({
      id: item.task.id,
      title: item.task.title,
      question: item.task.question,
      priority: item.task.priority,
      role: item.task.role,
      mode: item.task.mode,
      depends_on: item.task.depends_on,
      status: item.result.status,
      session_id: item.sessionID,
      report_path: item.reportPath,
      node_id: item.nodeID,
      artifact_id: item.artifactID,
      reused: item.reused,
      reserved_subtree_slots: item.reservedSubtreeSlots,
      decomposition_reason: item.task.decomposition_reason ?? item.task.rationale,
    }),
  )
  const wave = WorkflowSchema.ResearchWave.make({
    number,
    rationale:
      number === 1 ? "Initial research contract" : (state.waves.at(-1)?.assessment.rationale ?? "Follow-up gaps"),
    tasks: taskRecords,
    assessment_session_id: assessmentSessionID,
    assessment: assessed,
    stop_code: stopCode,
    stop_reason: stopReason,
  })
  const next = {
    waves: [...state.waves, wave],
    completed,
    nodes: [...state.nodes, ...executed.flatMap((item) => item.nodes)],
    councils: mergeCouncilReviews([...state.councils, ...executed.flatMap((item) => item.councils)]),
    failures: [
      ...state.failures,
      ...executed.flatMap((item) => (item.result.status === "failed" ? [item.result.summary] : [])),
      ...(assessment.failure ? [assessment.failure] : []),
      ...(capped.length > 0 ? [`${capped.length} research task(s) were capped by the node budget.`] : []),
    ],
  } satisfies WaveState
  if (stopReason) return next
  return yield* runWaves(number + 1, nextTasks, next, contract, input, parentID)
})

function enforceDeliverableGate(
  assessment: WorkflowSchema.ResearchAssessment,
  contract: WorkflowSchema.ResearchContract,
  input: ExecuteNodeInput,
  wave: number,
  remainingTaskSlots: number,
) {
  const uncovered = contract.deliverables.filter((deliverable) => {
    const coverage = assessment.deliverable_coverage.find((item) => equivalentQuestion(item.deliverable, deliverable))
    return !coverage || coverage.status === "partial" || coverage.status === "missing"
  })
  if (uncovered.length === 0 || remainingTaskSlots === 0 || wave >= input.settings.maxWaves) return assessment
  const tasks = unique(
    [
      ...assessment.tasks,
      ...uncovered.map((deliverable, index) =>
        WorkflowSchema.ResearchTask.make({
          id: `deliverable-${wave + 1}-${index + 1}`,
          title: `Complete contract deliverable: ${deliverableTitle(deliverable)}`,
          question: `What additional evidence and analysis is required to fully answer this still-uncovered contract deliverable: ${deliverable}`,
          priority: "critical",
          role: "evidence",
          mode: "leaf",
          depends_on: [],
          rationale: "The engine does not allow synthesis while a desk-researchable contract deliverable is missing.",
          expected_evidence: [`Direct support for the contract deliverable: ${deliverable}`],
          subquestions: [],
          evidence_methods: ["Targeted source discovery or direct inspection", "Explicit gap closure"],
          exclusions: ["Final report authorship"],
          decision_relevance: `Without this work, the final report would omit the contract deliverable: ${deliverable}`,
          decomposition_reason: "A bounded completion task closes one explicitly identified deliverable gap.",
        }),
      ),
    ],
    (task) => task.id,
  ).slice(0, Math.min(input.settings.tasksPerWave, remainingTaskSlots))
  if (tasks.length === 0) return assessment
  return WorkflowSchema.ResearchAssessment.make({
    ...assessment,
    decision: "continue",
    stop_reason: undefined,
    rationale: `${assessment.rationale} The engine overrode the stop decision because ${uncovered.length} desk-researchable contract deliverable(s) remain uncovered.`,
    information_gain: assessment.information_gain === "low" ? "medium" : assessment.information_gain,
    coverage: "incomplete",
    tasks,
  })
}

function deliverableTitle(deliverable: string) {
  const structured = deliverable.match(/^title:\s*(.+?)(?:\s+[—-]\s+contents:|$)/i)?.[1]
  const title = (structured ?? deliverable).replace(/\s+/g, " ").trim()
  return title.length <= 120 ? title : `${title.slice(0, 117).trimEnd()}...`
}

function scheduleWaveTasks(
  proposed: ReadonlyArray<WorkflowSchema.ResearchTask>,
  remaining: number,
  input: ExecuteNodeInput,
) {
  const selected = proposed.slice(0, remaining)
  const recursive = selected
    .filter((task) => task.role === "recursive" && input.depth + 1 < input.settings.maxDepth)
    .sort(
      (left, right) =>
        researchPriority(right.priority) - researchPriority(left.priority) ||
        proposed.indexOf(left) - proposed.indexOf(right),
    )
  const availableForSubtrees = Math.max(0, remaining - selected.length)
  const admitted = recursive.slice(0, Math.floor(availableForSubtrees / input.settings.minEvidencePerBranch))
  const minimumReserved = admitted.length * input.settings.minEvidencePerBranch
  const bonus = availableForSubtrees - minimumReserved
  const reservations = new Map(
    admitted.map((task, index) => [
      task.id,
      input.settings.minEvidencePerBranch +
        Math.floor(bonus / admitted.length) +
        (index < bonus % admitted.length ? 1 : 0),
    ]),
  )
  const tasks = selected.map((task): ScheduledTask => {
    const reservedSubtreeSlots = reservations.get(task.id) ?? 0
    if (task.role !== "recursive" || reservedSubtreeSlots > 0) return { task, reservedSubtreeSlots }
    return {
      task: WorkflowSchema.ResearchTask.make({
        ...task,
        role: task.depends_on.length > 0 ? "critic" : "evidence",
        mode: "leaf",
        decomposition_reason: `The local subtree budget could not reserve the configured minimum of ${input.settings.minEvidencePerBranch} evidence task(s), so this branch was executed directly.`,
      }),
      reservedSubtreeSlots,
    }
  })
  return {
    tasks,
    capped: proposed.slice(selected.length),
    consumed: selected.length + Array.from(reservations.values()).reduce((total, value) => total + value, 0),
  }
}

const executeWave = Effect.fn("ResearchWorkflow.executeWave")(function* (
  pending: ReadonlyArray<ScheduledTask>,
  previous: ReadonlyMap<string, CompletedTask>,
  input: ExecuteNodeInput,
  parentID: SessionSchema.ID,
  wave: number,
): Effect.fn.Return<ReadonlyArray<CompletedTask>> {
  const execute = (
    remaining: ReadonlyArray<ScheduledTask>,
    completed: ReadonlyMap<string, CompletedTask>,
    results: ReadonlyArray<CompletedTask>,
  ): Effect.Effect<ReadonlyArray<CompletedTask>> =>
    Effect.gen(function* () {
      if (remaining.length === 0) return results
      const ready = remaining.filter((item) => item.task.depends_on.every((dependency) => completed.has(dependency)))
      if (ready.length === 0) {
        yield* Ref.update(
          input.remaining,
          (available) => available + remaining.reduce((total, item) => total + item.reservedSubtreeSlots, 0),
        )
        return [
          ...results,
          ...remaining.map((item) =>
            failedTask(
              item.task,
              input,
              parentID,
              wave,
              "Research task dependencies could not be satisfied",
              undefined,
              item.reservedSubtreeSlots,
            ),
          ),
        ]
      }
      const current = yield* Effect.forEach(ready, (task) => executeTask(task, completed, input, parentID, wave), {
        concurrency: input.settings.capability === "write" ? 1 : input.settings.concurrency,
      })
      return yield* execute(
        remaining.filter((task) => !ready.includes(task)),
        new Map([...completed, ...current.map((item) => [item.task.id, item] as const)]),
        [...results, ...current],
      )
    })
  return yield* execute(pending, previous, [])
})

const executeTask = Effect.fn("ResearchWorkflow.executeTask")(function* (
  scheduled: ScheduledTask,
  completed: ReadonlyMap<string, CompletedTask>,
  input: ExecuteNodeInput,
  parentID: SessionSchema.ID,
  wave: number,
) {
  const task = scheduled.task
  const dependencies = task.depends_on.flatMap((dependency) => {
    const item = completed.get(dependency)
    return item ? [item] : []
  })
  const inheritedArtifacts = unique(
    [
      ...input.inheritedArtifacts,
      ...dependencies.map((dependency) => ({
        id: dependency.artifactID ?? dependency.task.id,
        title: dependency.task.title,
        summary: dependency.result.summary,
        reportPath: dependency.reportPath,
      })),
    ],
    (artifact) => artifact.id,
  )
  const recurse =
    task.role === "recursive" &&
    scheduled.reservedSubtreeSlots >= input.settings.minEvidencePerBranch &&
    input.depth + 1 < input.settings.maxDepth
  const artifactID = `research-artifact-${Hash.fast(
    JSON.stringify({
      question: task.question.trim().toLowerCase(),
      role: task.role,
      dependencies: dependencies.map((dependency) => dependency.artifactID ?? dependency.task.id),
      expectedEvidence: task.expected_evidence,
      capability: input.settings.capability,
      freshnessDays: input.settings.freshnessDays,
    }),
  )}`
  const id = `${task.id}:work`
  const sessionID = recurse
    ? input.runtime.childID(parentID, `${task.id}:contract`)
    : input.runtime.childID(parentID, id)
  const cached = recurse ? undefined : (yield* Ref.get(input.cache)).get(artifactID)
  if (cached) {
    const result = scopeResult(cached.result, task.id, cached.reportPath)
    yield* input.runtime.progress(
      input.context,
      {
        workflow: "research",
        phase: "reusing",
        stage: "evidence",
        depth: input.depth + 1,
        node: task.id,
        session_id: cached.sessionID,
        artifact_id: artifactID,
      },
      `Research reused content-addressed evidence for ${task.title}`,
    )
    return {
      task,
      result,
      nodes: [],
      councils: [],
      sessionID: cached.sessionID,
      reportPath: cached.reportPath,
      ledgers: [result],
      artifactID,
      reused: true,
      reservedSubtreeSlots: scheduled.reservedSubtreeSlots,
    } satisfies CompletedTask
  }
  const childRemaining = recurse ? yield* Ref.make(scheduled.reservedSubtreeSlots) : undefined
  const execution: Effect.Effect<TaskExecution, Tool.Failure> = recurse
    ? executeNode({
        ...input,
        id: task.id,
        parentNodeID: input.id,
        title: task.title,
        objective: task.question,
        depth: input.depth + 1,
        parentID,
        inheritedContext: [...input.inheritedContext, ...dependencies.map((dependency) => dependency.result.summary)],
        inheritedArtifacts,
        remaining: childRemaining!,
        budgetAllocated: scheduled.reservedSubtreeSlots,
      }).pipe(
        Effect.map((result) => ({
          result: result.result,
          nodes: result.nodes,
          councils: result.councils,
          sessionID: result.planningSessionID,
          reportPath: result.nodes[0]?.report_path,
          nodeID: result.nodes[0]?.id,
          ledgers: result.ledgers,
          reused: false,
          reservedSubtreeSlots: scheduled.reservedSubtreeSlots,
        })),
        Effect.ensuring(
          Ref.get(childRemaining!).pipe(
            Effect.flatMap((unused) => Ref.update(input.remaining, (remaining) => remaining + unused)),
          ),
        ),
      )
    : WorkflowReport.prompt(
        `Research evidence task ${task.title}`,
        workerPrompt(input, task, dependencies, wave),
        input.settings.maxPromptBytes,
      ).pipe(
        Effect.flatMap((prompt) =>
          input.runtime.runChild({
            id,
            parentID,
            location: input.parent.location,
            title: task.role === "critic" ? `Research critique: ${task.title}` : `Research: ${task.title}`,
            agent: AgentV2.ID.make(
              task.role === "critic"
                ? "research-critic"
                : input.settings.capability === "write"
                  ? "research-writer"
                  : "research-reader",
            ),
            model: WorkflowRuntime.resolveModel(
              input.parent.model,
              task.role === "critic" || input.settings.capability !== "write"
                ? input.settings.models.worker
                : input.settings.models.writer,
            ),
            timeoutMs: input.settings.childTimeoutMs,
            finalizationRetries: input.settings.finalizationRetries,
            maxPromptBytes: input.settings.maxPromptBytes,
            result: WorkflowSchema.ResearchBranchSubmission,
            reportSources: inheritedArtifacts.flatMap((artifact) =>
              artifact.reportPath ? [{ id: artifact.id, title: artifact.title, reportPath: artifact.reportPath }] : [],
            ),
            reportContentFirst: true,
            reportReadMode: "artifacts",
            prompt,
            progress: {
              context: input.context,
              workflow: "research",
              phase: "investigating",
              stage: "evidence",
              details: {
                node_id: task.id,
                parent_node_id: input.id,
                node_depth: input.depth + 1,
                capability: input.settings.capability,
                depends_on: task.depends_on,
                round: wave,
              },
            },
          }),
        ),
        Effect.flatMap((result) =>
          Effect.gen(function* () {
            const reportPath = input.context.execution
              ? WorkflowExecution.stageReportPath(input.context.execution, sessionID)
              : undefined
            if (result.status === "completed")
              yield* Ref.update(input.cache, (cache) =>
                new Map(cache).set(artifactID, {
                  id: artifactID,
                  result,
                  sessionID,
                  reportPath,
                }),
              )
            const scoped = scopeResult(result, task.id, reportPath)
            return {
              result: scoped,
              nodes: [] as ReadonlyArray<WorkflowSchema.ResearchNode>,
              councils: [] as ReadonlyArray<WorkflowSchema.ResearchCouncilReview>,
              sessionID,
              reportPath,
              ledgers: [scoped],
              artifactID,
              reused: false,
              reservedSubtreeSlots: scheduled.reservedSubtreeSlots,
            }
          }),
        ),
      )
  return yield* execution.pipe(
    Effect.map((result) => ({
      task,
      ...result,
    })),
    Effect.catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      return input.runtime
        .progress(
          input.context,
          {
            workflow: "research",
            phase: "failed",
            stage: "evidence",
            depth: input.depth + 1,
            node: task.id,
            session_id: sessionID,
            error: message,
          },
          `Research task ${task.title} failed: ${message}`,
        )
        .pipe(Effect.as(failedTask(task, input, parentID, wave, message, sessionID, scheduled.reservedSubtreeSlots)))
    }),
  )
})

const reviewDisputes = Effect.fn("ResearchWorkflow.reviewDisputes")(function* (
  input: ExecuteNodeInput,
  parentID: SessionSchema.ID,
  disputes: ReadonlyArray<WorkflowSchema.ResearchDispute>,
  completed: ReadonlyMap<string, CompletedTask>,
) {
  if (!input.settings.council || input.settings.debateSensitivity === "off") return []
  const selected = clusterDisputes(
    unique(
      disputes.filter((dispute) => debateEligible(dispute, input.settings.debateSensitivity)),
      (dispute) => dispute.id,
    ),
  )
    .sort((left, right) => disputeClusterRank(right) - disputeClusterRank(left))
    .slice(0, input.settings.maxDebatesPerNode)
  return yield* Effect.forEach(
    selected,
    (disputes) => {
      const profile = disputes.some((dispute) => dispute.debate_profile === "full") ? "full" : "compact"
      const question = councilQuestion(disputes)
      return reviewWithCouncil(input, parentID, disputes, completed, profile).pipe(
        Effect.map((output) =>
          WorkflowSchema.ResearchCouncilReview.make({
            dispute_id: `${input.id}:${disputes[0].id}`,
            dispute_ids: Array.from(new Set(disputes.map((dispute) => `${input.id}:${dispute.id}`))),
            node_id: input.id,
            question,
            profile,
            output,
          }),
        ),
        Effect.catch((error) =>
          input.runtime
            .progress(
              input.context,
              {
                workflow: "research",
                phase: "recovering",
                stage: "council",
                depth: input.depth,
                node: input.id,
                error: error.message,
              },
              `Research Council review failed for ${question}: ${error.message}`,
            )
            .pipe(Effect.as(undefined)),
        ),
      )
    },
    { concurrency: 1 },
  ).pipe(Effect.map((reviews) => reviews.filter((review) => review !== undefined)))
})

const reviewWithCouncil = Effect.fn("ResearchWorkflow.reviewWithCouncil")(function* (
  input: ExecuteNodeInput,
  parentID: SessionSchema.ID,
  disputes: ReadonlyArray<WorkflowSchema.ResearchDispute>,
  completed: ReadonlyMap<string, CompletedTask>,
  profile: "compact" | "full",
) {
  const artifacts = Array.from(completed.values(), (item) => ({
    id: item.artifactID ?? item.task.id,
    title: item.task.title,
    reportPath: item.reportPath,
  }))
  const question = councilQuestion(disputes)
  const prompt = `Resolve ${disputes.length === 1 ? "one consequential evidence dispute" : "a cluster of related consequential evidence disputes"} discovered by an adaptive Research assessment.

Root objective:
${input.rootObjective}

Disputes:
${JSON.stringify(disputes, undefined, 2)}

Deliberation profile: ${profile}
Authorized evidence artifact inventory:
${JSON.stringify(
  artifacts.map((artifact) => ({
    artifact_id: artifact.id,
    title: artifact.title,
    available: artifact.reportPath !== undefined,
  })),
  undefined,
  2,
)}

Debate the competing claims, source quality, assumptions, and consequences. Distinguish facts, estimates, and judgments. Preserve minority positions and state what evidence would change the conclusion. ${
    profile === "compact"
      ? "Use two focused perspectives and one debate round; this is a bounded judgment review, not a new research program."
      : "Use the configured full deliberation because the ledger contains genuinely competing evidence."
  }`
  const parent = {
    ...input.parent,
    id: parentID,
    parentID: input.parent.id,
    title: `Research Council: ${question}`,
  }
  const rootExecution = input.context.execution
  const settings =
    profile === "full"
      ? input.settings.council!
      : {
          ...input.settings.council!,
          perspectives: 2,
          concurrency: Math.min(2, input.settings.council!.concurrency),
          debate: {
            mode: "always" as const,
            topics: Math.min(disputes.length, input.settings.council!.debate.topics),
            participants: 2,
            rounds: 1,
          },
        }
  if (!rootExecution)
    return yield* CouncilWorkflow.run(prompt, parent, input.context, settings, input.runtime, artifacts)
  const artifactPaths = artifacts.flatMap((artifact) => (artifact.reportPath ? [artifact.reportPath] : []))
  const issueKey = `${input.id}:${disputes.map((dispute) => dispute.id).join("+")}`
  const coordination = yield* WorkflowExecution.claimCouncil(rootExecution, {
    objective: question,
    issueKey,
    artifactPaths,
  })
  if (!coordination.owner) return yield* WorkflowExecution.awaitCouncil(rootExecution, coordination.claim)
  const execution = yield* WorkflowExecution.delegate(rootExecution, {
    workflow: "council",
    objective: question,
    sessionID: parentID,
    toolCallID: `${input.context.toolCallID}:${Hash.fast(issueKey)}:council`,
  }).pipe(Effect.tapError((error) => WorkflowExecution.failCouncil(rootExecution, coordination.claim, error)))
  yield* WorkflowExecution.bindCouncil(execution, coordination.claim, execution.id)
  return yield* CouncilWorkflow.run(
    prompt,
    parent,
    { ...input.context, execution },
    settings,
    input.runtime,
    artifacts,
  ).pipe(
    Effect.flatMap((result) =>
      Effect.gen(function* () {
        const delegations = yield* WorkflowExecution.manifest(execution)
        const sessions = yield* WorkflowExecution.sessions(execution)
        const sources = yield* Effect.promise(() =>
          WorkflowReport.collectSourceProvenance(
            result,
            [
              result.synthesis_report_path,
              ...result.perspectives.map((perspective) => perspective.report_path),
              ...result.debate.map((contribution) => contribution.report_path),
              ...delegations.map((delegation) => delegation.report_path),
            ],
            sessions,
          ),
        )
        const output = WorkflowSchema.CouncilOutput.make({
          ...result,
          ...WorkflowReport.health(result.status, sessions, result.coverage ?? [], sources),
          final_response: yield* Effect.promise(() => WorkflowReport.readArtifact(result.synthesis_report_path)),
          usage: WorkflowReport.aggregateUsage(sessions),
          timing: WorkflowExecution.timing(execution),
          report_path: execution.reportPath,
          source_manifest: sources.map((source) => source.url),
          source_provenance: sources,
          session_manifest: sessions,
          delegations,
        })
        yield* Effect.tryPromise({
          try: () => WorkflowReport.writeCouncil(question, output, execution.reportPath),
          catch: (error) =>
            new Tool.Failure({
              message: `Failed to write Research Council report: ${
                error instanceof Error ? error.message : String(error)
              }`,
            }),
        })
        yield* WorkflowExecution.complete(execution, {
          status: output.status,
          executionStatus: output.execution_status,
          artifactStatus: output.artifact_status,
          evidenceStatus: output.evidence_status,
          summary: output.summary,
          rootSessionID: output.root_session_id,
        })
        yield* WorkflowExecution.completeCouncil(coordination.claim, output)
        return output
      }),
    ),
    Effect.catch((error) =>
      Effect.gen(function* () {
        const message = error instanceof Error ? error.message : String(error)
        yield* WorkflowExecution.fail(execution, message)
        yield* WorkflowExecution.failCouncil(execution, coordination.claim, new Tool.Failure({ message }))
        yield* Effect.promise(() =>
          WorkflowReport.writeFailure("council", question, message, execution.reportPath).catch(() => undefined),
        )
        return yield* Effect.fail(error instanceof Error ? error : new Error(message))
      }),
    ),
  )
})

function normalizeTasks(
  tasks: ReadonlyArray<WorkflowSchema.ResearchTask>,
  input: ExecuteNodeInput,
  wave: number,
  previous: ReadonlyMap<string, CompletedTask>,
) {
  const previousTasks = Array.from(previous.values())
  const selected = tasks
    .filter((task) => !reportOnly(task))
    .filter(
      (task, index, all) =>
        all.findIndex((candidate) => equivalentQuestion(candidate.question, task.question)) === index &&
        !previousTasks.some((item) => equivalentQuestion(item.task.question, task.question)),
    )
    .slice(0, input.settings.tasksPerWave)
  const ids = new Map(selected.map((task, index) => [task.id, `${input.id}.w${wave}.${index + 1}`]))
  const previousIDs = new Map(
    previousTasks.flatMap((item) => [
      [item.task.id, item.task.id] as const,
      ...(item.artifactID ? ([[item.artifactID, item.task.id]] as const) : []),
    ]),
  )
  return selected.map((task, index) => {
    const boundedRole =
      task.role === "recursive" && input.depth + 1 >= input.settings.maxDepth
        ? task.depends_on.length > 0
          ? "critic"
          : "evidence"
        : task.role
    const role =
      boundedRole === "critic" &&
      (requiresSourceDiscovery(task) || (task.depends_on.length === 0 && input.inheritedArtifacts.length === 0))
        ? "evidence"
        : boundedRole
    return WorkflowSchema.ResearchTask.make({
      ...task,
      id: `${input.id}.w${wave}.${index + 1}`,
      role,
      mode: role === "recursive" ? "recurse" : "leaf",
      decomposition_reason:
        boundedRole === "critic" && role === "evidence"
          ? requiresSourceDiscovery(task)
            ? "This task requires fresh source discovery, so it was converted from artifact-bound criticism to direct evidence."
            : "No upstream artifact was available, so this task was converted from criticism to direct evidence."
          : task.decomposition_reason,
      depends_on: task.depends_on.flatMap((dependency) => {
        const id = ids.get(dependency) ?? previousIDs.get(dependency)
        return [id ?? dependency]
      }),
    })
  })
}

function requiresSourceDiscovery(task: WorkflowSchema.ResearchTask) {
  return /\b(fresh|latest|new sources?|source discovery|web search|external sources?|provider pricing|price sheet|compatibility data|authoritative documentation|current\s+(?:provider\s+)?(?:pricing|prices|compatibility|limits|availability|law|regulation|data|documentation|market|versions?))\b/i.test(
    [
      task.title,
      task.question,
      task.rationale,
      task.decision_relevance,
      ...task.expected_evidence,
      ...(task.evidence_methods ?? []),
    ]
      .filter((item) => item !== undefined)
      .join(" "),
  )
}

function auditContractTasks(contract: WorkflowSchema.ResearchContract, input: ExecuteNodeInput) {
  const audited = auditTasks(
    contract.tasks,
    input,
    input.depth === 0 &&
      (contract.tasks.length >= 3 ||
        contract.deliverables.length >= 3 ||
        contract.unknowns.length >= 3 ||
        contract.tasks.some((task) => leafAuditReasons(task, input).length > 0)),
  )
  if (input.depth === 0) return audited
  return audited.map((task) => {
    if (task.role !== "recursive") return task
    return WorkflowSchema.ResearchTask.make({
      ...task,
      role: task.depends_on.length > 0 ? "critic" : "evidence",
      mode: "leaf",
      decomposition_reason:
        "Nested contracts begin with direct evidence or criticism; another recursive level must be earned by the post-wave assessor.",
    })
  })
}

function auditTasks(
  tasks: ReadonlyArray<WorkflowSchema.ResearchTask>,
  input: ExecuteNodeInput,
  enforceDepthFloor: boolean,
) {
  if (input.depth + 1 >= input.settings.maxDepth) return tasks
  const explicit = tasks.filter((task) => task.role === "recursive")
  const broad =
    input.settings.effort === "standard" ? [] : tasks.filter((task) => leafAuditReasons(task, input).length > 0)
  const floor =
    enforceDepthFloor && input.depth + 1 < input.settings.minDepth && explicit.length === 0 && broad.length === 0
      ? [
          [...tasks].sort(
            (left, right) =>
              researchPriority(right.priority) - researchPriority(left.priority) ||
              right.expected_evidence.length - left.expected_evidence.length,
          )[0],
        ].filter((task) => task !== undefined)
      : []
  const promoted = new Set(
    unique([...explicit, ...broad, ...floor], (task) => task.id)
      .sort(
        (left, right) =>
          researchPriority(right.priority) - researchPriority(left.priority) ||
          leafAuditReasons(right, input).length - leafAuditReasons(left, input).length,
      )
      .slice(0, input.settings.maxBranchesPerNode)
      .map((task) => task.id),
  )
  return tasks.map((task) => {
    if (!promoted.has(task.id)) {
      if (task.role !== "recursive") return task
      return WorkflowSchema.ResearchTask.make({
        ...task,
        role: task.depends_on.length > 0 ? "critic" : "evidence",
        mode: "leaf",
        decomposition_reason: `The recursive-branch cap (${input.settings.maxBranchesPerNode}) kept this task direct at the current node.`,
      })
    }
    const reasons = leafAuditReasons(task, input)
    return WorkflowSchema.ResearchTask.make({
      ...task,
      role: "recursive",
      mode: "recurse",
      decomposition_reason:
        task.role === "recursive"
          ? (task.decomposition_reason ?? task.rationale)
          : reasons.length > 0
            ? `Leaf audit promoted this compound task: ${reasons.join("; ")}.`
            : `The configured minimum useful evidence depth (${input.settings.minDepth}) requires this highest-priority branch to decompose locally.`,
    })
  })
}

function leafAuditReasons(task: WorkflowSchema.ResearchTask, input: ExecuteNodeInput) {
  return [
    ...((task.subquestions?.length ?? 0) >= 3
      ? [`${task.subquestions!.length} independently answerable subquestions`]
      : []),
    ...(input.depth === 0 && (task.subquestions?.length ?? 0) >= 2 && task.expected_evidence.length >= 3
      ? [
          `${task.subquestions!.length} independent root questions spanning ${task.expected_evidence.length} evidence families`,
        ]
      : []),
  ]
}

function researchPriority(priority: WorkflowSchema.ResearchPriority) {
  if (priority === "critical") return 3
  if (priority === "material") return 2
  return 1
}

function scopeResult(result: WorkflowSchema.ResearchBranchResult, prefix: string, reportPath?: string) {
  const claims = new Map(result.claims.map((claim) => [claim.id, `${prefix}:${claim.id}`]))
  const evidence = new Map(result.evidence.map((item) => [item.id, `${prefix}:${item.id}`]))
  const gaps = new Map(result.gaps.map((gap) => [gap.id, `${prefix}:${gap.id}`]))
  const disputes = new Map(result.disputes.map((dispute) => [dispute.id, `${prefix}:${dispute.id}`]))
  return WorkflowSchema.ResearchBranchResult.make({
    ...result,
    claims: result.claims.map((claim) => ({
      ...claim,
      id: claims.get(claim.id)!,
      evidence_ids: claim.evidence_ids.map((id) => evidence.get(id) ?? id),
      contradicts: claim.contradicts.map((id) => claims.get(id) ?? id),
      resolves_gap_ids: claim.resolves_gap_ids?.map((id) => gaps.get(id) ?? id),
      resolves_dispute_ids: claim.resolves_dispute_ids?.map((id) => disputes.get(id) ?? id),
    })),
    evidence: result.evidence.map((item) => ({
      ...item,
      id: evidence.get(item.id)!,
      claim_ids: item.claim_ids.map((id) => claims.get(id) ?? id),
      report_path: item.report_path ?? reportPath,
    })),
    gaps: result.gaps.map((gap) => ({ ...gap, id: gaps.get(gap.id)! })),
    disputes: result.disputes.map((dispute) => ({
      ...dispute,
      id: disputes.get(dispute.id)!,
      claim_ids: dispute.claim_ids.map((id) => claims.get(id) ?? id),
    })),
    ...(result.deliverable_coverage
      ? {
          deliverable_coverage: result.deliverable_coverage.map((item) => ({
            ...item,
            claim_ids: item.claim_ids.map((id) => claims.get(id) ?? id),
          })),
        }
      : {}),
  })
}

function graphFrom(
  ledgers: ReadonlyArray<WorkflowSchema.ResearchBranchResult>,
  nodes: ReadonlyArray<WorkflowSchema.ResearchNode>,
  councils: ReadonlyArray<WorkflowSchema.ResearchCouncilReview>,
) {
  const councilReviews = new Map(
    councils.flatMap((review) => (review.dispute_ids ?? [review.dispute_id]).map((disputeID) => [disputeID, review])),
  )
  return WorkflowSchema.ResearchGraph.make({
    claims: unique(
      ledgers.flatMap((ledger) => ledger.claims),
      (claim) => claim.id,
    ),
    evidence: unique(
      ledgers.flatMap((ledger) => ledger.evidence),
      (evidence) => evidence.id,
    ),
    gaps: unique(
      ledgers.flatMap((ledger) => ledger.gaps),
      (gap) => gap.id,
    ),
    disputes: unique(
      [
        ...ledgers.flatMap((ledger) => ledger.disputes),
        ...nodes.flatMap((node) =>
          node.waves.flatMap((wave) =>
            wave.assessment.disputes.map((dispute) =>
              WorkflowSchema.ResearchDispute.make({
                ...dispute,
                id: dispute.id.startsWith(`${node.id}:`) ? dispute.id : `${node.id}:${dispute.id}`,
              }),
            ),
          ),
        ),
      ],
      (dispute) => dispute.id,
    ).map((dispute) => {
      const review = councilReviews.get(dispute.id)
      if (!review) return dispute
      return WorkflowSchema.ResearchDispute.make({
        ...dispute,
        status: "debated",
        council_report_path: review.output.report_path ?? review.output.synthesis_report_path,
      })
    }),
    assumptions: Array.from(new Set(ledgers.flatMap((ledger) => ledger.assumptions))),
  })
}

export function canonicalGraphFrom(
  root: WorkflowSchema.ResearchBranchResult,
  raw: WorkflowSchema.ResearchGraph,
  nodes: ReadonlyArray<WorkflowSchema.ResearchNode>,
  councils: ReadonlyArray<WorkflowSchema.ResearchCouncilReview>,
) {
  const rawClaims = new Map(raw.claims.map((claim) => [claim.id, claim]))
  const rawEvidence = new Map(raw.evidence.map((evidence) => [evidence.id, evidence]))
  const resolvedDisputes = new Map(
    root.claims.flatMap((claim) =>
      (claim.resolves_dispute_ids ?? []).map((disputeID) => [disputeID, claim.id] as const),
    ),
  )
  const resolvedGaps = new Set(root.claims.flatMap((claim) => claim.resolves_gap_ids ?? []))
  const assessed = nodes.flatMap((node) =>
    node.waves.flatMap((wave) =>
      wave.assessment.disputes.map((dispute) =>
        WorkflowSchema.ResearchDispute.make({
          ...dispute,
          id: dispute.id.startsWith(`${node.id}:`) ? dispute.id : `${node.id}:${dispute.id}`,
        }),
      ),
    ),
  )
  const disputes = [...root.disputes, ...assessed]
    .filter(
      (dispute, index, all) =>
        all.findIndex((candidate) => equivalentQuestion(candidate.question, dispute.question)) === index,
    )
    .map((dispute) => {
      const resolvedBy = resolvedDisputes.get(dispute.id)
      if (resolvedBy)
        return WorkflowSchema.ResearchDispute.make({
          ...dispute,
          status: "resolved",
          resolution: dispute.resolution ?? `Resolved by canonical claim ${resolvedBy}.`,
        })
      const review = councils.find(
        (candidate) =>
          (candidate.dispute_ids ?? [candidate.dispute_id]).includes(dispute.id) ||
          equivalentQuestion(candidate.question, dispute.question),
      )
      if (!review) return dispute
      const resolution = [...review.output.consensus, ...review.output.recommendations].join(" ")
      return WorkflowSchema.ResearchDispute.make({
        ...dispute,
        status: review.output.status === "completed" && resolution ? "resolved" : "debated",
        resolution: resolution || dispute.resolution,
        council_report_path: review.output.report_path ?? review.output.synthesis_report_path,
      })
    })
  const contested = new Set(
    disputes
      .filter((dispute) => dispute.status === "open" || dispute.status === "debated")
      .flatMap((dispute) => dispute.claim_ids),
  )
  const claims = root.claims.map((claim) => {
    const derived = Array.from(
      new Set([
        ...(claim.derived_from_claim_ids ?? []).filter((claimID) => rawClaims.has(claimID)),
        ...claim.evidence_ids.filter((id) => !rawEvidence.has(id) && rawClaims.has(id)),
      ]),
    )
    const evidence = Array.from(
      new Set([
        ...claim.evidence_ids.filter((id) => rawEvidence.has(id)),
        ...derived.flatMap((claimID) => transitiveEvidence(claimID, rawClaims, rawEvidence)),
      ]),
    )
    return WorkflowSchema.ResearchClaim.make({
      ...claim,
      status: claim.status === "supported" && evidence.length === 0 ? "uncertain" : claim.status,
      evidence_ids: evidence,
      derived_from_claim_ids: derived,
    })
  })
  const evidenceIDs = new Set(claims.flatMap((claim) => claim.evidence_ids))
  const rootReportPath = nodes.find((node) => node.depth === 0)?.report_path
  const retainedEvidence = unique(
    [...root.evidence, ...raw.evidence.filter((evidence) => evidenceIDs.has(evidence.id))],
    (evidence) => evidence.id,
  ).filter(
    (evidence) => evidence.url !== undefined || rootReportPath === undefined || evidence.report_path !== rootReportPath,
  )
  const retainedEvidenceIDs = new Set(retainedEvidence.map((evidence) => evidence.id))
  const canonicalClaims = claims.map((claim) => {
    const evidence = claim.evidence_ids.filter((evidenceID) => retainedEvidenceIDs.has(evidenceID))
    return WorkflowSchema.ResearchClaim.make({
      ...claim,
      status: claim.status === "supported" && evidence.length === 0 ? "uncertain" : claim.status,
      evidence_ids: evidence,
    })
  })
  const canonicalClaimsByEvidence = new Map<string, ReadonlyArray<string>>()
  canonicalClaims.forEach((claim) =>
    claim.evidence_ids.forEach((evidenceID) =>
      canonicalClaimsByEvidence.set(evidenceID, [...(canonicalClaimsByEvidence.get(evidenceID) ?? []), claim.id]),
    ),
  )
  return WorkflowSchema.ResearchGraph.make({
    claims: canonicalClaims.map((claim) =>
      contested.has(claim.id) || claim.contradicts.length > 0
        ? WorkflowSchema.ResearchClaim.make({ ...claim, status: claim.status === "refuted" ? "refuted" : "contested" })
        : claim,
    ),
    evidence: retainedEvidence.map((evidence) =>
      WorkflowSchema.ResearchEvidence.make({
        ...evidence,
        claim_ids: Array.from(new Set([...evidence.claim_ids, ...(canonicalClaimsByEvidence.get(evidence.id) ?? [])])),
      }),
    ),
    gaps: root.gaps
      .filter(
        (gap, index, all) =>
          all.findIndex((candidate) => equivalentQuestion(candidate.question, gap.question)) === index,
      )
      .map((gap) =>
        resolvedGaps.has(gap.id) ? WorkflowSchema.ResearchGap.make({ ...gap, status: "addressed" }) : gap,
      ),
    disputes,
    assumptions: Array.from(new Set(root.assumptions)),
  })
}

function transitiveEvidence(
  claimID: string,
  claims: ReadonlyMap<string, WorkflowSchema.ResearchClaim>,
  evidence: ReadonlyMap<string, WorkflowSchema.ResearchEvidence>,
  visited: ReadonlySet<string> = new Set(),
): ReadonlyArray<string> {
  if (visited.has(claimID)) return []
  const claim = claims.get(claimID)
  if (!claim) return []
  const next = new Set([...visited, claimID])
  return [
    ...claim.evidence_ids.filter((id) => evidence.has(id)),
    ...claim.evidence_ids
      .filter((id) => !evidence.has(id) && claims.has(id))
      .flatMap((id) => transitiveEvidence(id, claims, evidence, next)),
    ...(claim.derived_from_claim_ids ?? []).flatMap((id) => transitiveEvidence(id, claims, evidence, next)),
  ]
}

export function reconcileEvidence(
  graph: WorkflowSchema.ResearchGraph,
  sources: ReadonlyArray<WorkflowSchema.SourceReference>,
) {
  const byURL = new Map(sources.map((source) => [evidenceURLKey(source.url), source]))
  const evidence = graph.evidence.map((item) => {
    if (!item.url) {
      if (item.source_type !== "primary" && item.source_type !== "secondary") return item
      return WorkflowSchema.ResearchEvidence.make({ ...item, verification: "unverified" })
    }
    return WorkflowSchema.ResearchEvidence.make({
      ...item,
      verification: byURL.get(evidenceURLKey(item.url))?.verification ?? "unverified",
    })
  })
  return WorkflowSchema.ResearchGraph.make({
    ...graph,
    evidence,
  })
}

function evidenceURLKey(value: string) {
  if (!URL.canParse(value)) return value
  const url = new URL(value)
  url.hash = ""
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "")
  return url.href
}

function fallbackSynthesis(children: ReadonlyArray<CompletedTask>, error: string) {
  return WorkflowSchema.ResearchBranchResult.make({
    status: children.length > 0 ? "partial" : "failed",
    summary:
      children
        .filter((child) => child.result.status !== "failed")
        .map((child) => child.result.summary)
        .join("\n\n") || "Research could not produce a branch synthesis.",
    claims: children.flatMap((child) => child.result.claims),
    evidence: children.flatMap((child) => child.result.evidence),
    gaps: children.flatMap((child) => child.result.gaps),
    disputes: children.flatMap((child) => child.result.disputes),
    assumptions: Array.from(new Set(children.flatMap((child) => child.result.assumptions))),
    conclusions: children.flatMap((child) => child.result.conclusions),
    recommendations: children.flatMap((child) => child.result.recommendations),
    limitations: [...children.flatMap((child) => child.result.limitations), `Research synthesis failed: ${error}`],
  })
}

function failedTask(
  task: WorkflowSchema.ResearchTask,
  input: ExecuteNodeInput,
  parentID: SessionSchema.ID,
  wave: number,
  message: string,
  sessionID = input.runtime.childID(parentID, `${task.id}:work`),
  reservedSubtreeSlots = 0,
): CompletedTask {
  const result = WorkflowSchema.ResearchBranchResult.make({
    status: "failed",
    summary: message,
    claims: [],
    evidence: [],
    gaps: [
      {
        id: `${task.id}:failure`,
        question: task.question,
        priority: task.priority,
        status: "open",
        reason: message,
      },
    ],
    disputes: [],
    assumptions: [],
    conclusions: [],
    recommendations: [],
    limitations: [`Wave ${wave}: ${message}`],
  })
  return {
    task,
    sessionID,
    result,
    nodes: [],
    councils: [],
    ledgers: [result],
    reused: false,
    reservedSubtreeSlots,
  }
}

async function synthesisCoverage(
  artifacts: ReadonlyArray<WorkflowReport.Artifact>,
  submitted: ReadonlyArray<WorkflowSchema.ArtifactCoverage>,
  reads: ReadonlyArray<string>,
) {
  const coverage = await WorkflowReport.coverage(
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
          ...(artifact.reportPath && !reads.includes(artifact.reportPath)
            ? ["The final report author did not read this artifact."]
            : []),
        ],
      })
    }),
  )
  return coverage
}

const budgetReason = Effect.fn("ResearchWorkflow.budgetReason")(function* (input: ExecuteNodeInput) {
  if (input.settings.maxTimeMs && Date.now() - input.startedAt >= input.settings.maxTimeMs)
    return {
      code: "budget_exhausted" as const,
      detail: `Research wall-clock budget of ${input.settings.maxTimeMs} ms was exhausted.`,
    }
  if (!input.settings.maxTokens || !input.context.execution) return undefined
  const sessions = yield* WorkflowExecution.sessions(input.context.execution)
  const tokens = sessions.reduce(
    (total, session) =>
      total + (session.usage?.input ?? 0) + (session.usage?.output ?? 0) + (session.usage?.reasoning ?? 0),
    0,
  )
  if (tokens < input.settings.maxTokens) return undefined
  return {
    code: "budget_exhausted" as const,
    detail: `Research child-session token budget of ${input.settings.maxTokens} was exhausted.`,
  }
})

function debateEligible(dispute: WorkflowSchema.ResearchDispute, sensitivity: Settings["debateSensitivity"]) {
  if (sensitivity === "off") return false
  if (sensitivity === "low") return dispute.consequential && dispute.priority === "critical"
  if (sensitivity === "balanced") return dispute.consequential && dispute.priority !== "background"
  return dispute.consequential || dispute.priority !== "background"
}

function clusterDisputes(disputes: ReadonlyArray<WorkflowSchema.ResearchDispute>) {
  return disputes.reduce<Array<Array<WorkflowSchema.ResearchDispute>>>((clusters, dispute) => {
    const related = clusters.filter((cluster) => cluster.some((candidate) => relatedDisputes(candidate, dispute)))
    if (related.length === 0) return [...clusters, [dispute]]
    return [...clusters.filter((cluster) => !related.includes(cluster)), [...related.flat(), dispute]]
  }, [])
}

function disputeClusterRank(disputes: ReadonlyArray<WorkflowSchema.ResearchDispute>) {
  const priority = Math.max(
    ...disputes.map((dispute) => (dispute.priority === "critical" ? 3 : dispute.priority === "material" ? 2 : 1)),
  )
  return priority * 100 + (disputes.some((dispute) => dispute.debate_profile === "full") ? 10 : 0) + disputes.length
}

function mergeCouncilReviews(reviews: ReadonlyArray<WorkflowSchema.ResearchCouncilReview>) {
  return reviews.reduce<Array<WorkflowSchema.ResearchCouncilReview>>((current, review) => {
    const key = review.output.report_path ?? review.output.synthesis_report_path ?? review.output.root_session_id
    const index = current.findIndex(
      (candidate) =>
        (candidate.output.report_path ?? candidate.output.synthesis_report_path ?? candidate.output.root_session_id) ===
        key,
    )
    if (index < 0) return [...current, review]
    return current.map((candidate, candidateIndex) => {
      if (candidateIndex !== index) return candidate
      const questions = [candidate.question, review.question].filter(
        (question, questionIndex, all) => all.findIndex((item) => equivalentQuestion(item, question)) === questionIndex,
      )
      return WorkflowSchema.ResearchCouncilReview.make({
        ...candidate,
        dispute_ids: Array.from(
          new Set([
            ...(candidate.dispute_ids ?? [candidate.dispute_id]),
            ...(review.dispute_ids ?? [review.dispute_id]),
          ]),
        ),
        question:
          questions.length === 1
            ? questions[0]
            : [
                "Resolve these related consequential disputes together:",
                ...questions.map((item, i) => `${i + 1}. ${item}`),
              ].join("\n"),
        profile: candidate.profile === "full" || review.profile === "full" ? "full" : "compact",
      })
    })
  }, [])
}

function relatedDisputes(left: WorkflowSchema.ResearchDispute, right: WorkflowSchema.ResearchDispute) {
  if (left.claim_ids.some((claimID) => right.claim_ids.includes(claimID))) return true
  const words = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(
          (word) =>
            word.length > 2 &&
            ![
              "are",
              "can",
              "does",
              "for",
              "how",
              "into",
              "one",
              "only",
              "reported",
              "should",
              "that",
              "the",
              "these",
              "this",
              "use",
              "whether",
              "with",
            ].includes(word),
        ),
    )
  const leftWords = words(left.question)
  const rightWords = words(right.question)
  const shared = Array.from(leftWords).filter((word) => rightWords.has(word)).length
  return shared >= 2 && shared / Math.min(leftWords.size, rightWords.size) >= 0.35
}

function councilQuestion(disputes: ReadonlyArray<WorkflowSchema.ResearchDispute>) {
  const questions = disputes
    .map((dispute) => dispute.question)
    .filter((question, index, all) => all.findIndex((candidate) => equivalentQuestion(candidate, question)) === index)
  if (questions.length === 1) return questions[0]
  return [
    "Resolve these related consequential disputes together:",
    ...questions.map((question, index) => `${index + 1}. ${question}`),
  ].join("\n")
}

function reportOnly(task: WorkflowSchema.ResearchTask) {
  return /\b(?:write|draft|assemble|compile|produce|create|synthesi[sz]e|summari[sz]e)\b.*\b(?:final )?(?:report|answer|document|summary)\b/i.test(
    `${task.title} ${task.question}`,
  )
}

function equivalentQuestion(left: string, right: string) {
  const words = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length > 2),
    )
  const leftWords = words(left)
  const rightWords = words(right)
  if (leftWords.size === 0 || rightWords.size === 0) return left.trim() === right.trim()
  const shared = Array.from(leftWords).filter((word) => rightWords.has(word)).length
  return shared / Math.min(leftWords.size, rightWords.size) >= 0.9
}

function unique<Value>(values: ReadonlyArray<Value>, key: (value: Value) => string) {
  return values.filter((value, index, all) => all.findIndex((candidate) => key(candidate) === key(value)) === index)
}

function contractPrompt(input: ExecuteNodeInput) {
  return `Define a bounded research contract and the first adaptive evidence wave.

Root objective:
${input.rootObjective}

Current branch:
${input.objective}

Branch depth: ${input.depth} of ${input.settings.maxDepth}
Effort: ${input.settings.effort}
Target useful evidence depth for complex plans: ${input.settings.minDepth}
Maximum recursive branches at this node: ${input.settings.maxBranchesPerNode}
Allocated evidence-task slots for this subtree: ${input.budgetAllocated}
Minimum child evidence slots required to recurse: ${input.settings.minEvidencePerBranch}
Maximum tasks in this wave: ${input.settings.tasksPerWave}
Requested source freshness: ${input.settings.freshnessDays ? `${input.settings.freshnessDays} days when fresher evidence exists` : "no fixed age; assess freshness explicitly"}
Capability: ${input.settings.capability}

Inherited branch context:
${input.inheritedContext.join("\n\n") || "(none)"}

Authorized upstream artifact inventory:
${JSON.stringify(
  input.inheritedArtifacts.map((artifact) => ({
    artifact_id: artifact.id,
    title: artifact.title,
    summary: artifact.summary,
    available: artifact.reportPath !== undefined,
  })),
  undefined,
  2,
)}

${
  input.inheritedArtifacts.some((artifact) => artifact.reportPath)
    ? "Read all authorized upstream reports with workflow_read_reports({ all: true }) before planning this dependent branch. Never transcribe opaque artifact IDs. They are context for decomposition, not an invitation to repeat their research."
    : ""
}

Turn the objective into an explicit contract: deliverables, assumptions, important unknowns, and observations that could falsify the likely answer. Then select first-wave questions with the highest expected information gain. Use primary and authoritative evidence where possible.

Depth is epistemic, not a session-count target. An evidence task is valid when it has one decision or claim family, one bounded output, and no independently consumable subproblem. It may and usually should triangulate that claim with multiple evidence methods. Use a recursive branch only when independent subquestions need their own outputs and later synthesis. For a broad root objective, prefer three to five domain branches that each plan themselves instead of assigning giant cross-domain leaves.

Assign one explicit role to every task:
- evidence: acquire or calculate new evidence for one bounded claim family;
- critic: read declared upstream artifacts and challenge, compare, verify, or integrate them without new source discovery;
- recursive: create a child contract only for a genuinely compound domain.

Critic tasks must use depends_on when they examine work from this wave. ${
    input.depth === 0
      ? "The root may launch recursive domain branches in its initial wave."
      : "This nested contract must begin with evidence or critic tasks. A later assessor may earn another recursive level after inspecting the first evidence wave."
  }

For every task provide:
- subquestions: independently answerable questions inside the assignment; an atomic task should have at most one;
- evidence_methods: source, calculation, observation, experiment, or comparison methods; multiple methods do not by themselves make a task recursive;
- exclusions: adjacent topics owned elsewhere;
- decision_relevance: exactly what conclusion or choice this work could change;
- decomposition_reason: why the task is atomic or recursive.

Use depends_on whenever a task must read another task before it can do honest work. Integration, economic modeling, verification, and adversarial challenge tasks must not run concurrently with evidence they are supposed to examine. Refer to declared task IDs exactly. Prefer placing a cross-domain challenge after the domain branches it tests.

Classify every task with role "evidence", "critic", or "recursive". Legacy mode "atomic"/"leaf" and "compound"/"recurse" remain accepted, but role is authoritative. A flat_rationale is useful audit context but does not waive the configured depth target or leaf audit.

Include a challenge or verification task when a central conclusion could otherwise rest on one source or assumption. If that challenge needs the other reports, make it dependent instead of pretending it can verify work that does not yet exist.

Do not create a task to write, assemble, or summarize the final report; the node synthesizer owns that work. Do not research while planning.

Submit the bounded contract through workflow_result.`
}

function workerPrompt(
  input: ExecuteNodeInput,
  task: WorkflowSchema.ResearchTask,
  dependencies: ReadonlyArray<CompletedTask>,
  wave: number,
) {
  return `${task.role === "critic" ? "Critically examine upstream research" : "Investigate one evidence question"} for an adaptive Research workflow.

Root objective:
${input.rootObjective}

Assigned question:
${task.question}

Wave: ${wave}
Priority: ${task.priority}
Role: ${task.role}
Why it matters: ${task.rationale}
Expected evidence:
${JSON.stringify(task.expected_evidence, undefined, 2)}

Inherited context:
${input.inheritedContext.join("\n\n") || "(none)"}

Dependency inventory:
${JSON.stringify(
  dependencies.map((dependency) => ({
    artifact_id: dependency.artifactID ?? dependency.task.id,
    title: dependency.task.title,
    summary: dependency.result.summary,
    report_available: dependency.reportPath !== undefined,
  })),
  undefined,
  2,
)}

Inherited upstream artifact inventory:
${JSON.stringify(
  input.inheritedArtifacts.map((artifact) => ({
    artifact_id: artifact.id,
    title: artifact.title,
    summary: artifact.summary,
    report_available: artifact.reportPath !== undefined,
  })),
  undefined,
  2,
)}

${
  task.role === "critic"
    ? "This is an artifact-bound critique. Read the authorized reports, but do not search the web, inspect unrelated workspace material, or acquire substitute evidence."
    : input.settings.capability === "write"
      ? "You may inspect and mutate the workspace when the assigned question requires an experiment or implementation. Preserve unrelated changes and validate mutations."
      : "This is read-only research. Inspect deeply, but do not mutate the workspace."
}

Read all authorized dependency reports with workflow_read_reports({ all: true }) before reaching conclusions. Never transcribe opaque artifact IDs. Do not claim to challenge, compare, or integrate an upstream investigation from its title or summary alone.

Stay inside the assigned contribution:
- Decision relevance: ${task.decision_relevance ?? task.rationale}
- Subquestions: ${JSON.stringify(task.subquestions ?? [], undefined, 2)}
- Evidence methods: ${JSON.stringify(task.evidence_methods ?? [], undefined, 2)}
- Exclusions: ${JSON.stringify(task.exclusions ?? [], undefined, 2)}

Build an evidence ledger, not just prose:
- atomic claims, each labeled fact, inference, estimate, or recommendation;
- confidence and support status;
- evidence entries linked to claim IDs and labeled support, challenge, or context;
- exact source URLs, source type, verification state, freshness dates when known, and limitations;
- contradiction edges between incompatible claims;
- open gaps and explicit disputes, including whether they are consequential.

Use only the normalized source_type values primary, secondary, observation, calculation, artifact, or unknown, and verification values verified, unverified, failed, or not_applicable. A URL is verified only if you successfully inspected it or a successful lookup returned it. Calculations, observations, and repository artifacts may use not_applicable verification. Never turn an estimate into a fact. Preserve the complete analysis with workflow_report and submit only the structured ledger through workflow_result.`
}

function assessmentPrompt(
  input: ExecuteNodeInput,
  contract: WorkflowSchema.ResearchContract,
  wave: number,
  completed: ReadonlyMap<string, CompletedTask>,
  capped: ReadonlyArray<WorkflowSchema.ResearchTask>,
  remainingTaskSlots: number,
) {
  return `Assess an adaptive research wave and decide whether another wave has enough expected information gain.

Root objective:
${input.rootObjective}

Current branch:
${input.objective}

Contract deliverables:
${JSON.stringify(contract.deliverables, undefined, 2)}

Wave: ${wave} of ${input.settings.maxWaves}
Remaining task slots after this wave: ${remainingTaskSlots}
Available capability: ${input.settings.capability}
Completed evidence ledgers:
${JSON.stringify(
  Array.from(completed.values(), (item) => ({
    artifact_id: item.artifactID ?? item.task.id,
    task: item.task,
    result: item.result,
    report_available: item.reportPath !== undefined,
  })),
  undefined,
  2,
)}

Tasks capped by the remaining node budget:
${JSON.stringify(capped, undefined, 2)}

Read all authorized durable reports with workflow_read_reports({ all: true }) before judging gaps. Never transcribe opaque artifact IDs. Reconcile the current evidence against the research contract: identify critical unanswered questions, unsupported central claims, stale or weak sources, and direct contradictions. Continue only when a novel task has medium or high expected information gain and can materially change the answer. Do not repeat prior questions or create a final-report task.

Deepen selectively. Separate unresolved gaps into:
- desk-researchable gaps that another focused source, calculation, comparison, or repository inspection can resolve;
- compound gaps that need a recursive branch with its own local contract;
- empirical-only gaps that the available capability cannot resolve.

Do not stop with requires_empirical_work while a consequential desk-researchable gap still has medium or high expected information gain. For every proposed follow-up, provide the same bounded-task fields used by the planner and assign role evidence, critic, or recursive. Use recursive only when the completed wave reveals a compound gap with independently consumable subquestions. Use critic plus depends_on with the exact completed task IDs shown above whenever the follow-up compares, verifies, challenges, or integrates earlier reports. Multiple evidence methods inside one bounded claim do not justify recursion.

Emit explicit disputes only when there are credible competing claims or assumptions. Mark whether each dispute is consequential and its priority. Select debate_profile "full" only for genuinely conflicting evidence with identifiable competing claim IDs; use "compact" for consequential interpretation, semantics, or judgment. Council is selected later by policy; do not call it yourself.

Evaluate every contract deliverable in deliverable_coverage using exactly one status: covered, partial, missing, or empirical_only, with a concrete reason. A desk-researchable partial or missing deliverable requires decision "continue" and at least one targeted task. Only empirical_only deliverables may remain uncovered when stopping.

When stopping, select exactly one stop_reason: evidence_saturated, requires_empirical_work, budget_exhausted, blocked, or low_information_gain. Do not claim budget_exhausted while task slots remain and the engine reports no exhausted time/token limit. Put experiments or real-world checks that cannot be performed with the available capability in deferred_validations.

Submit decision, stop reason, coverage, information gain, novel follow-up tasks, disputes, and deferred validations through workflow_result.`
}

function synthesisPrompt(
  input: ExecuteNodeInput,
  contract: WorkflowSchema.ResearchContract,
  state: WaveState,
  artifacts: ReadonlyArray<WorkflowReport.Artifact>,
) {
  return `Synthesize one hierarchical Research node. ${
    input.depth === 0
      ? "You are the sole author of the final standalone report."
      : "Your report is the complete branch synthesis that its parent will read."
  }

Root objective:
${input.rootObjective}

Current branch:
${input.objective}

Research contract:
${JSON.stringify(contract, undefined, 2)}

Adaptive wave decisions:
${JSON.stringify(state.waves, undefined, 2)}

Structured branch ledgers:
${JSON.stringify(
  Array.from(state.completed.values(), (item) => ({
    artifact_id: item.artifactID ?? item.task.id,
    task: item.task,
    result: item.result,
    report_available: item.reportPath !== undefined,
  })),
  undefined,
  2,
)}

Source eligibility inventory:
${JSON.stringify(
  unique(
    Array.from(state.completed.values()).flatMap((item) =>
      item.result.evidence.flatMap((evidence) =>
        evidence.url
          ? [
              {
                url: evidence.url,
                verification: evidence.verification,
                source_type: evidence.source_type,
                report_path: evidence.report_path,
                limitation: evidence.limitation,
              },
            ]
          : [],
      ),
    ),
    (source) => source.url,
  ),
  undefined,
  2,
)}

Council reviews:
${JSON.stringify(
  state.councils
    .filter((review) => review.node_id === input.id)
    .map((review) => ({
      dispute_id: review.dispute_id,
      dispute_ids: review.dispute_ids,
      question: review.question,
      status: review.output.status,
      consensus: review.output.consensus,
      disagreements: review.output.disagreements,
      recommendations: review.output.recommendations,
      report_path: review.output.report_path,
    })),
  undefined,
  2,
)}

Authorized report inventory:
${JSON.stringify(
  artifacts.map((artifact) => ({
    artifact_id: artifact.id,
    title: artifact.title,
    available: artifact.reportPath !== undefined,
  })),
  undefined,
  2,
)}

Read all authorized reports with workflow_read_reports({ all: true }) before writing. Never transcribe opaque artifact IDs or invent filesystem paths. Then use workflow_report to author a substantial, coherent, self-contained Markdown document. The reader must understand the answer, reasoning, evidence, important numbers, tradeoffs, disagreement, uncertainty, and recommendations without opening a child report. Links to child reports are audit references, not substitutes for content.

Do not inspect the workspace, search the web, or introduce newly discovered sources. Synthesis must remain downstream of the authorized evidence. Cite a URL as verified only when the source eligibility inventory marks it verified; explicitly label every other cited URL unverified.

${
  input.depth === 0
    ? `The standalone root document should contain at least ${input.settings.minimumReportWords} substantive words unless the objective genuinely cannot support that depth; a shorter artifact is published but marked partial.`
    : "The branch document should be substantial enough to preserve its material evidence for the parent synthesis."
}

Organize the document for this objective rather than forcing an engineering template. Start with the direct answer and orienting synthesis, then develop the argument in the natural domain structure. Integrate source URLs beside supported claims. Distinguish verified facts, estimates, inferences, and recommendations. Explain consequential contradictions and Council resolutions, preserve unresolved minority positions, and state limitations. Include enough method and assumption detail for an informed reader to audit the result.

For every authorized report, record a substantive used, rejected, or unresolved coverage disposition in workflow_result.coverage. Coverage is audit metadata and must never replace or block report prose. Map every contract deliverable in workflow_result.deliverable_coverage with complete, partial, or missing status, the exact report section that addresses it, supporting claim IDs, and honest limitations. A deliverable is complete only when the document itself answers it and linked canonical claims support it.

The structured root ledger is the canonical graph, not a duplicate dump of every child ledger. Use derived_from_claim_ids and supersedes_claim_ids to connect canonical claims to raw child claims, and resolves_gap_ids or resolves_dispute_ids when a canonical claim closes a recorded issue. Preserve only decision-relevant canonical gaps and disputes, and mark resolved Council issues with the resolution. Do not paste a manifest into the main narrative. ${
    input.depth === 0
      ? "Do not delegate final authorship and do not create a second reviewer or rewriter."
      : "Compress descendants into this branch document without losing material evidence."
  }

${input.depth === 0 ? "Write the complete final document in one workflow_report call; it is persisted directly as RESEARCH_REPORT.md and is not passed through a later rewriting stage." : ""}

Finally submit a structured claim/evidence ledger through workflow_result. It must reflect the document but remain compact; the durable report is the full deliverable.`
}

export async function validateDocument(reportPath: string | undefined, minimumWords: number) {
  if (!reportPath) return []
  if (!(await Bun.file(reportPath).exists())) return ["The standalone synthesis report is unavailable."]
  const content = await Bun.file(reportPath).text()
  const words = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_`[\]()|-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length
  const headings = content.split(/\r?\n/).filter((line) => /^#{2,6}\s+\S/.test(line)).length
  return [
    ...(words < minimumWords
      ? [`The standalone synthesis contains ${words} substantive words; the configured minimum is ${minimumWords}.`]
      : []),
    ...(headings < 2 ? ["The standalone synthesis has fewer than two substantive sections."] : []),
  ]
}

function validateDeliverables(contract: WorkflowSchema.ResearchContract, result: WorkflowSchema.ResearchBranchResult) {
  if (contract.deliverables.length === 0) return []
  const coverage = result.deliverable_coverage ?? []
  return contract.deliverables.flatMap((deliverable) => {
    const item = coverage.find((candidate) => equivalentQuestion(candidate.deliverable, deliverable))
    if (!item) return [`Contract deliverable was not evaluated: ${deliverable}`]
    if (item.status === "complete" && item.report_section && item.claim_ids.length > 0) return []
    return [
      `Contract deliverable is ${item.status}: ${deliverable}${
        item.limitations.length > 0 ? ` (${item.limitations.join("; ")})` : ""
      }`,
    ]
  })
}

export async function evaluate(
  nodes: ReadonlyArray<WorkflowSchema.ResearchNode>,
  graph: WorkflowSchema.ResearchGraph,
  councils: ReadonlyArray<WorkflowSchema.ResearchCouncilReview>,
  minimumReportWords: number,
  operational?: {
    readonly sessions: ReadonlyArray<WorkflowSchema.SessionStage>
    readonly delegations: ReadonlyArray<WorkflowSchema.Delegation>
    readonly sources: ReadonlyArray<WorkflowSchema.SourceReference>
  },
) {
  const root = nodes.find((node) => node.depth === 0) ?? nodes[0]
  const tasks = nodes.flatMap((node) =>
    node.waves.flatMap((wave) => wave.tasks.map((task) => ({ task, evidenceDepth: node.depth + 1 }))),
  )
  const direct = tasks.filter((item) => item.task.role !== "recursive")
  const recursive = nodes.filter((node) => node.depth > 0)
  const content =
    root?.report_path && (await Bun.file(root.report_path).exists()) ? await Bun.file(root.report_path).text() : ""
  const reportWords = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#>*_`[\]()|-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length
  const reportSections = content.split(/\r?\n/).filter((line) => /^#{2,6}\s+\S/.test(line)).length
  const evidenceIDs = new Set(graph.evidence.map((evidence) => evidence.id))
  const supported = graph.claims.filter((claim) => claim.status === "supported")
  const deliverables =
    root?.contract.deliverables.map((deliverable) => {
      return (
        root.result.deliverable_coverage?.find((item) => equivalentQuestion(item.deliverable, deliverable)) ?? {
          status: "missing" as const,
        }
      )
    }) ?? []
  const completeDeliverables = deliverables.filter(
    (item) =>
      item.status === "complete" &&
      "report_section" in item &&
      Boolean(item.report_section) &&
      "claim_ids" in item &&
      item.claim_ids.length > 0,
  ).length
  const partialDeliverables = deliverables.filter((item) => item.status === "partial").length
  const missingDeliverables = deliverables.length - completeDeliverables - partialDeliverables
  const addressedDeliverables = deliverables.filter(
    (item) =>
      item.status !== "missing" &&
      "report_section" in item &&
      Boolean(item.report_section) &&
      "claim_ids" in item &&
      item.claim_ids.length > 0,
  ).length
  const sessions = operational?.sessions ?? []
  const councilRuns = new Set(
    sessions.filter((session) => session.workflow === "council").map((session) => session.run_id),
  )
  const nestedCouncilRuns = new Set(
    sessions
      .filter((session) => session.workflow === "council" && session.workflow_depth > 1)
      .map((session) => session.run_id),
  )
  const roles = Array.from(new Set(sessions.map((session) => session.agent))).map((agent) => {
    const stages = sessions.filter((session) => session.agent === agent)
    return WorkflowSchema.ResearchRoleEvaluation.make({
      agent,
      sessions: stages.length,
      failed_sessions: stages.filter((session) => session.status === "failed" || session.status === "timed_out").length,
      tool_calls: stages.reduce((total, session) => total + (session.tool_calls ?? 0), 0),
      tool_errors: stages.reduce((total, session) => total + (session.tool_errors ?? 0), 0),
      usage: WorkflowReport.aggregateUsage(stages),
    })
  })
  return WorkflowSchema.ResearchEvaluation.make({
    report_words: reportWords,
    report_sections: reportSections,
    standalone_pass:
      root?.report_path === undefined ||
      (reportWords >= minimumReportWords && reportSections >= 2 && addressedDeliverables === deliverables.length),
    claims: graph.claims.length,
    supported_claims: supported.length,
    traceable_supported_claims: supported.filter(
      (claim) => claim.evidence_ids.length > 0 && claim.evidence_ids.every((id) => evidenceIDs.has(id)),
    ).length,
    evidence_records: graph.evidence.length,
    verified_sources: graph.evidence.filter((evidence) => evidence.url && evidence.verification === "verified").length,
    open_critical_gaps: graph.gaps.filter((gap) => gap.priority === "critical" && gap.status === "open").length,
    consequential_disputes: graph.disputes.filter((dispute) => dispute.consequential).length,
    council_reviews: councils.length,
    evidence_tasks: nodes.reduce(
      (total, node) => total + node.waves.reduce((current, wave) => current + wave.tasks.length, 0),
      0,
    ),
    reused_artifacts: nodes.reduce(
      (total, node) =>
        total + node.waves.reduce((current, wave) => current + wave.tasks.filter((task) => task.reused).length, 0),
      0,
    ),
    recursive_branches: recursive.length,
    productive_recursive_branches: recursive.filter((node) => node.waves.some((wave) => wave.tasks.length > 0)).length,
    synthesis_only_branches: recursive.filter((node) => node.waves.every((wave) => wave.tasks.length === 0)).length,
    branch_syntheses: recursive.filter((node) => node.synthesis_status !== "skipped").length,
    evidence_leaves: direct.filter((item) => item.task.role === "evidence").length,
    critic_tasks: direct.filter((item) => item.task.role === "critic").length,
    max_evidence_depth: Math.max(0, ...direct.map((item) => item.evidenceDepth)),
    max_branch_depth: Math.max(0, ...nodes.map((node) => node.depth)),
    dependent_tasks: tasks.filter((item) => (item.task.depends_on?.length ?? 0) > 0).length,
    root_budget_slots: root?.budget_allocated ?? 0,
    root_unused_slots: root?.budget_unused ?? 0,
    coverage_complete: WorkflowReport.unaccountedCoverage(root?.result.coverage ?? []).length === 0,
    deliverables_total: deliverables.length,
    deliverables_complete: completeDeliverables,
    deliverables_partial: partialDeliverables,
    deliverables_missing: missingDeliverables,
    total_sessions: sessions.length,
    failed_sessions: sessions.filter((session) => session.status === "failed" || session.status === "timed_out").length,
    delegated_workflows: operational?.delegations.length ?? 0,
    council_sessions: sessions.filter((session) => session.workflow === "council").length,
    council_invocations: councilRuns.size,
    nested_council_invocations: nestedCouncilRuns.size,
    tool_calls: sessions.reduce((total, session) => total + (session.tool_calls ?? 0), 0),
    tool_errors: sessions.reduce((total, session) => total + (session.tool_errors ?? 0), 0),
    cited_sources: operational?.sources.length ?? 0,
    verified_citations: operational?.sources.filter((source) => source.verification === "verified").length ?? 0,
    unverified_citations: operational?.sources.filter((source) => source.verification !== "verified").length ?? 0,
    usage: WorkflowReport.aggregateUsage(sessions),
    roles,
  })
}
