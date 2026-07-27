export * as HeavyWorkflow from "./heavy"

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
  readonly maxDepth: number
  readonly tasksPerNode: number
  readonly maxNodes: number
  readonly concurrency: number
  readonly childTimeoutMs: number
  readonly finalizationRetries?: number
  readonly maxPromptBytes?: number
  readonly onFailure: "keep" | "stop"
  readonly councilMode?: "auto" | "synthesis" | "required" | "always" | "off"
  readonly council?: CouncilWorkflow.Settings
  readonly models: {
    readonly planner?: string
    readonly worker?: string
    readonly writer?: string
    readonly synthesizer?: string
  }
}

export function run(
  task: string,
  parent: SessionSchema.Info,
  context: WorkflowRuntime.RunContext,
  settings: Settings,
  runtime: WorkflowRuntime.Interface,
) {
  return Effect.gen(function* () {
    const remaining = yield* Ref.make(Math.max(0, settings.maxNodes - 1))
    const root = yield* executeNode({
      id: `heavy-${Hash.fast(context.toolCallID).slice(0, 12)}`,
      title: "Heavy root",
      objective: task,
      capability: "write",
      depth: 0,
      parentID: parent.id,
      rootObjective: task,
      inheritedContext: [],
      scopeLedger: [],
      parent,
      context,
      settings,
      runtime,
      remaining,
    })
    const status = root.nodes.some((node) => node.status === "failed")
      ? "partial"
      : root.nodes.some((node) => node.status === "partial")
        ? "partial"
        : root.result.status
    return WorkflowSchema.HeavyOutput.make({
      workflow: "heavy",
      status,
      summary: root.result.summary,
      root_session_id: root.sessionID,
      nodes: root.nodes,
      council: root.council,
    })
  })
}

type ExecuteNodeInput = {
  readonly id: string
  readonly title: string
  readonly objective: string
  readonly capability: WorkflowSchema.Capability
  readonly depth: number
  readonly parentNodeID?: string
  readonly parentID: SessionSchema.ID
  readonly rootObjective: string
  readonly inheritedContext: ReadonlyArray<string>
  readonly scopeLedger: ReadonlyArray<WorkflowSchema.HeavyTask>
  readonly parent: SessionSchema.Info
  readonly context: WorkflowRuntime.RunContext
  readonly settings: Settings
  readonly runtime: WorkflowRuntime.Interface
  readonly remaining: Ref.Ref<number>
}

type NodeExecution = {
  readonly sessionID: SessionSchema.ID
  readonly result: WorkflowSchema.HeavyNodeResult
  readonly nodes: ReadonlyArray<WorkflowSchema.HeavyNode>
  readonly council?: WorkflowSchema.CouncilOutput
}

type Planned = {
  readonly plan: WorkflowSchema.HeavyPlan
  readonly failure?: string
}

const executeNode = Effect.fn("HeavyWorkflow.executeNode")(function* (input: ExecuteNodeInput) {
  const planID = `${input.id}:plan`
  const planningSessionID = input.runtime.childID(input.parentID, planID)
  yield* input.runtime.progress(
    input.context,
    {
      workflow: "heavy",
      phase: "planning",
      depth: input.depth,
      node: input.id,
      session_id: planningSessionID,
    },
    `Heavy is planning ${input.title} at depth ${input.depth}`,
  )
  const planned = yield* WorkflowReport.prompt(
    `Heavy planner for ${input.title}`,
    planningPrompt(input),
    input.settings.maxPromptBytes,
  )
    .pipe(
      Effect.flatMap((prompt) =>
        input.runtime.runChild({
          id: planID,
          parentID: input.parentID,
          location: input.parent.location,
          title: `Heavy plan: ${input.title}`,
          agent: AgentV2.ID.make("heavy-planner"),
          model: WorkflowRuntime.resolveModel(input.parent.model, input.settings.models.planner),
          timeoutMs: input.settings.childTimeoutMs,
          finalizationRetries: input.settings.finalizationRetries,
          maxPromptBytes: input.settings.maxPromptBytes,
          result: WorkflowSchema.HeavyPlanSubmission,
          prompt,
          progress: {
            context: input.context,
            workflow: "heavy",
            phase: "planning",
            stage: "planning",
            details: {
              node_id: input.id,
              parent_node_id: input.parentNodeID,
              node_depth: input.depth,
              capability: input.capability,
            },
          },
        }),
      ),
    )
    .pipe(
      Effect.map((plan) => ({ plan, failure: undefined as string | undefined })),
      Effect.catch((error) =>
        input.runtime
          .progress(
            input.context,
            {
              workflow: "heavy",
              phase: "recovering",
              stage: "planning",
              depth: input.depth,
              node: input.id,
              session_id: planningSessionID,
              error: error.message,
            },
            `Heavy planner failed for ${input.title}; continuing directly: ${error.message}`,
          )
          .pipe(
            Effect.as({
              plan: WorkflowSchema.HeavyPlan.make({
                rationale: `Planner failed; executing the current objective directly: ${error.message}`,
                tasks: [
                  {
                    id: "fallback",
                    title: input.title,
                    objective: input.objective,
                    capability: input.capability,
                    mode: "leaf",
                    depends_on: [],
                  },
                ],
              }),
              failure: error.message,
            }),
          ),
      ),
    )
  const reviewed = yield* reviewPlan(input, planningSessionID, planned)
  const normalized = normalizeTasks(reviewed.plan.tasks, input)
  const scheduled = yield* schedule(
    normalized.tasks,
    new Map(),
    [],
    {
      ...input,
      inheritedContext: [
        ...input.inheritedContext,
        JSON.stringify({
          ancestor: input.id,
          objective: input.objective,
          planner_rationale: reviewed.plan.rationale,
        }),
      ],
      scopeLedger: [...input.scopeLedger, ...normalized.tasks],
    },
    planningSessionID,
  )
  const routing = councilRouting(input, reviewed.plan.council, scheduled.completed)
  yield* input.runtime.progress(
    input.context,
    {
      workflow: "heavy",
      phase: "council-routing",
      depth: input.depth,
      node: input.id,
      council_mode: routing.mode,
      council_outcome: routing.outcome,
      council_reason: routing.reason,
      council_signals: routing.signals,
    },
    `Heavy Council routing: ${routing.outcome} — ${routing.reason}`,
  )
  const council =
    input.settings.council && routing.outcome === "triggered"
      ? yield* reviewWithCouncil(
          input,
          planningSessionID,
          scheduled.completed,
          input.settings.council,
          routing.question,
        ).pipe(
          Effect.map((output) => ({ output, failure: undefined as string | undefined })),
          Effect.catch((error) =>
            input.runtime
              .progress(
                input.context,
                {
                  workflow: "heavy",
                  phase: "recovering",
                  stage: "council",
                  depth: input.depth,
                  node: input.id,
                  session_id: planningSessionID,
                  error: error.message,
                },
                `Council review failed for ${input.title}; preserving Heavy results: ${error.message}`,
              )
              .pipe(Effect.as({ output: undefined, failure: error.message })),
          ),
        )
      : { output: undefined, failure: undefined }
  const resolvedRouting = WorkflowSchema.CouncilRouting.make({
    ...routing,
    ...(council.failure
      ? {
          outcome: "failed" as const,
          reason: `${routing.reason} Council execution failed: ${council.failure}`,
        }
      : {}),
  })
  const synthesisID = input.runtime.childID(planningSessionID, `${input.id}:synthesis`)
  yield* input.runtime.progress(
    input.context,
    {
      workflow: "heavy",
      phase: "synthesizing",
      depth: input.depth,
      node: input.id,
      completed: scheduled.completed.size,
      session_id: synthesisID,
      node_session_id: planningSessionID,
    },
    `Heavy is synthesizing ${input.title}`,
  )
  const children = Array.from(scheduled.completed.values())
  const plan = reconcilePlan(normalized.records, scheduled.completed)
  const artifacts = [
    ...children.map((child) => ({
      title: child.task.title,
      reportPath: child.reportPath,
    })),
    ...(council.output
      ? [
          {
            title: "Council review",
            reportPath: council.output.report_path ?? council.output.synthesis_report_path,
          },
        ]
      : []),
  ]
  const childReports = yield* Effect.promise(() => WorkflowReport.readArtifacts(artifacts))
  const evidenceSessions = input.context.execution ? yield* WorkflowExecution.sessions(input.context.execution) : []
  const evidence = yield* Effect.promise(() =>
    WorkflowReport.collectSourceProvenance(
      Array.from(scheduled.completed.values(), (child) => child.result),
      artifacts.map((artifact) => artifact.reportPath),
      evidenceSessions,
    ),
  )
  const synthesized = yield* WorkflowReport.prompt(
    `Heavy synthesis for ${input.title}`,
    synthesisPrompt(
      input,
      reviewed.plan.rationale,
      plan,
      scheduled.completed,
      childReports,
      council.output,
      resolvedRouting,
      evidence,
    ),
    input.settings.maxPromptBytes,
  )
    .pipe(
      Effect.flatMap((prompt) =>
        input.runtime.runChild({
          id: `${input.id}:synthesis`,
          parentID: planningSessionID,
          location: input.parent.location,
          title: `Heavy synthesis: ${input.title}`,
          agent: AgentV2.ID.make("heavy-synthesizer"),
          model: WorkflowRuntime.resolveModel(input.parent.model, input.settings.models.synthesizer),
          timeoutMs: input.settings.childTimeoutMs,
          finalizationRetries: input.settings.finalizationRetries,
          maxPromptBytes: input.settings.maxPromptBytes,
          result: WorkflowSchema.HeavyNodeSubmission,
          prompt,
          progress: {
            context: input.context,
            workflow: "heavy",
            phase: "synthesizing",
            stage: "synthesis",
            details: {
              node_id: input.id,
              parent_node_id: input.parentNodeID,
              node_depth: input.depth,
              capability: input.capability,
            },
          },
        }),
      ),
    )
    .pipe(
      Effect.map((result) => ({ result, failure: undefined as string | undefined })),
      Effect.catch((error) =>
        input.runtime
          .progress(
            input.context,
            {
              workflow: "heavy",
              phase: "recovering",
              stage: "synthesis",
              depth: input.depth,
              node: input.id,
              session_id: synthesisID,
              node_session_id: planningSessionID,
              error: error.message,
            },
            `Heavy synthesis failed for ${input.title}; preserving child results: ${error.message}`,
          )
          .pipe(Effect.as({ result: fallbackSynthesis(children, error.message), failure: error.message })),
      ),
    )
  const coverage = [
    ...(yield* Effect.promise(() => WorkflowReport.coverage(artifacts, synthesized.result.coverage))),
    ...plan
      .filter((task) => task.disposition === "capped" || task.disposition === "blocked")
      .map((task) =>
        WorkflowSchema.ArtifactCoverage.make({
          title: task.title,
          received: false,
          used: [],
          rejected: [],
          unresolved: [task.reason ?? "The planned task was not executed."],
        }),
      ),
  ]
  const result = {
    ...synthesized.result,
    coverage,
    status:
      reviewed.failure ||
      synthesized.failure ||
      council.failure ||
      (council.output !== undefined &&
        (council.output.status !== "completed" || council.output.artifact_status === "partial")) ||
      plan.some((task) => task.disposition === "capped" || task.disposition === "blocked")
        ? children.length > 0
          ? "partial"
          : "failed"
        : children.some((child) => child.result.status === "failed")
          ? synthesized.result.status === "failed"
            ? "failed"
            : "partial"
          : children.some((child) => child.result.status === "partial")
            ? "partial"
            : synthesized.result.status,
  } satisfies WorkflowSchema.HeavyNodeResult
  const node = WorkflowSchema.HeavyNode.make({
    id: input.id,
    parent_id: input.parentNodeID,
    session_id: synthesisID,
    planning_session_id: planningSessionID,
    depth: input.depth,
    title: input.title,
    objective: input.objective,
    capability: input.capability,
    report_path: input.context.execution
      ? WorkflowExecution.stageReportPath(input.context.execution, synthesisID)
      : undefined,
    plan,
    council_routing: resolvedRouting,
    ...result,
  })
  return {
    sessionID: planningSessionID,
    result,
    nodes: [node, ...children.flatMap((child) => child.nodes)],
    council: council.output,
  } satisfies NodeExecution
})

const reviewPlan = Effect.fn("HeavyWorkflow.reviewPlan")(function* (
  input: ExecuteNodeInput,
  planningSessionID: SessionSchema.ID,
  planned: Planned,
) {
  const conflicts = scopeConflicts(planned.plan.tasks, input)
  if (conflicts.length === 0) return planned
  const reviewID = `${input.id}:plan-scope-review`
  const sessionID = input.runtime.childID(planningSessionID, reviewID)
  yield* input.runtime.progress(
    input.context,
    {
      workflow: "heavy",
      phase: "planning",
      stage: "scope-review",
      depth: input.depth,
      node: input.id,
      session_id: sessionID,
      conflicts,
    },
    `Heavy is differentiating ${conflicts.length} overlapping scope assignment(s)`,
  )
  return yield* WorkflowReport.prompt(
    `Heavy scope review for ${input.title}`,
    scopeReviewPrompt(input, planned.plan, conflicts),
    input.settings.maxPromptBytes,
  ).pipe(
    Effect.flatMap((prompt) =>
      input.runtime.runChild({
        id: reviewID,
        parentID: planningSessionID,
        location: input.parent.location,
        title: `Heavy scope review: ${input.title}`,
        agent: AgentV2.ID.make("heavy-planner"),
        model: WorkflowRuntime.resolveModel(input.parent.model, input.settings.models.planner),
        timeoutMs: input.settings.childTimeoutMs,
        finalizationRetries: input.settings.finalizationRetries,
        maxPromptBytes: input.settings.maxPromptBytes,
        result: WorkflowSchema.HeavyPlanSubmission,
        prompt,
        progress: {
          context: input.context,
          workflow: "heavy",
          phase: "planning",
          stage: "scope-review",
          details: {
            node_id: input.id,
            parent_node_id: input.parentNodeID,
            node_depth: input.depth,
            capability: input.capability,
          },
        },
      }),
    ),
    Effect.map((plan) => ({ plan, failure: planned.failure })),
    Effect.catch((error) =>
      Effect.succeed({
        plan: planned.plan,
        failure: [planned.failure, `Scope review failed: ${error.message}`].filter(Boolean).join("; "),
      }),
    ),
  )
})

function councilRouting(
  input: ExecuteNodeInput,
  planned: WorkflowSchema.CouncilRequest | undefined,
  completed: ReadonlyMap<string, Scheduled>,
) {
  const mode = input.settings.councilMode ?? "auto"
  if (mode === "off")
    return WorkflowSchema.CouncilRouting.make({
      mode,
      outcome: "disabled",
      reason: "Council routing is disabled by configuration.",
      signals: [],
    })
  if (!input.settings.council)
    return WorkflowSchema.CouncilRouting.make({
      mode,
      outcome: "unavailable",
      reason: "Council is not available in the effective workflow configuration.",
      signals: [],
    })
  const requests = Array.from(completed.values()).flatMap((item) =>
    item.result.council_request?.recommended ? [item.result.council_request] : [],
  )
  const requested = planned?.recommended ? planned : requests[0]
  const signals = Array.from(
    new Set([
      ...(planned?.recommended ? planned.signals : []),
      ...requests.flatMap((request) => request.signals),
      ...(requests.length > 0 ? (["worker_requested"] as const) : []),
    ]),
  )
  const question = requested?.question ?? `Which conclusion should govern this Heavy subproblem: ${input.objective}`
  if (mode === "synthesis")
    return WorkflowSchema.CouncilRouting.make({
      mode,
      outcome: "triggered",
      reason: "The configured synthesis policy requires a Council review at every Heavy synthesis boundary.",
      question,
      signals,
    })
  if ((mode === "required" || mode === "always") && input.depth === 0)
    return WorkflowSchema.CouncilRouting.make({
      mode,
      outcome: "triggered",
      reason: "The configured policy requires a root Council review.",
      question,
      signals,
    })
  if (mode === "required" || mode === "always")
    return WorkflowSchema.CouncilRouting.make({
      mode,
      outcome: "not_triggered",
      reason: "The configured policy reserves its guaranteed Council review for the root synthesis.",
      signals,
    })
  if (requested)
    return WorkflowSchema.CouncilRouting.make({
      mode,
      outcome: "triggered",
      reason: requested.reason,
      question,
      signals,
    })
  return WorkflowSchema.CouncilRouting.make({
    mode,
    outcome: "not_triggered",
    reason:
      "The planner and completed workers found no consequential dispute, conflicting evidence, or assumption-sensitive decision requiring adversarial review.",
    signals,
  })
}

type Scheduled = {
  readonly task: WorkflowSchema.HeavyTask
  readonly result: WorkflowSchema.HeavyNodeResult
  readonly nodes: ReadonlyArray<WorkflowSchema.HeavyNode>
  readonly reportPath?: string
}

const schedule = Effect.fn("HeavyWorkflow.schedule")(function* (
  pending: ReadonlyArray<WorkflowSchema.HeavyTask>,
  completed: ReadonlyMap<string, Scheduled>,
  failedDependencies: ReadonlyArray<string>,
  input: ExecuteNodeInput,
  parentID: SessionSchema.ID,
): Effect.fn.Return<{
  readonly completed: ReadonlyMap<string, Scheduled>
  readonly failedDependencies: ReadonlyArray<string>
}> {
  if (pending.length === 0) return { completed, failedDependencies }
  const ready = pending.filter((task) => task.depends_on.every((dependency) => completed.has(dependency)))
  if (ready.length === 0) {
    const stalled = new Map(completed)
    for (const task of pending)
      stalled.set(task.id, failedTask(task, parentID, input, "Task dependencies could not be satisfied"))
    return { completed: stalled, failedDependencies: [...failedDependencies, ...pending.map((task) => task.id)] }
  }

  const readable = ready.filter((task) => task.capability === "read")
  const writable = ready.filter((task) => task.capability === "write")
  const next = new Map(completed)
  // Ready read branches share one pool whether they recurse or execute a leaf.
  // This keeps broad research moving while one branch explores more deeply.
  const readResults = yield* Effect.forEach(readable, (task) => executeTask(task, next, input, parentID), {
    concurrency: input.settings.concurrency,
  })
  readResults.forEach((result) => next.set(result.task.id, result))
  const readFailures = readResults.filter((result) => result.result.status === "failed").map((result) => result.task.id)
  if (readFailures.length > 0 && input.settings.onFailure === "stop")
    return { completed: next, failedDependencies: [...failedDependencies, ...readFailures] }

  // Any write-capable branch may mutate through a descendant, so writers remain
  // serial and begin only after the ready read pool has settled.
  const writeResults: Scheduled[] = []
  for (const task of writable) {
    const result = yield* executeTask(task, next, input, parentID)
    writeResults.push(result)
    next.set(result.task.id, result)
    if (result.result.status === "failed" && input.settings.onFailure === "stop") break
  }
  const failures = [
    ...readFailures,
    ...writeResults.filter((result) => result.result.status === "failed").map((result) => result.task.id),
  ]
  if (failures.length > 0 && input.settings.onFailure === "stop")
    return { completed: next, failedDependencies: [...failedDependencies, ...failures] }
  return yield* schedule(
    pending.filter((task) => !ready.includes(task)),
    next,
    [...failedDependencies, ...failures],
    input,
    parentID,
  )
})

const executeTask = Effect.fn("HeavyWorkflow.executeTask")(function* (
  task: WorkflowSchema.HeavyTask,
  completed: ReadonlyMap<string, Scheduled>,
  input: ExecuteNodeInput,
  parentID: SessionSchema.ID,
) {
  const dependencyResults = task.depends_on.flatMap((dependency) => {
    const result = completed.get(dependency)
    return result ? [{ id: dependency, value: result }] : []
  })
  const dependencies = dependencyResults.map((dependency) =>
    JSON.stringify({ id: dependency.id, result: dependency.value.result }),
  )
  const dependencyReports = yield* Effect.promise(() =>
    WorkflowReport.readArtifacts(
      dependencyResults.map((dependency) => ({
        title: dependency.value.task.title,
        reportPath: dependency.value.reportPath,
      })),
    ),
  )
  const claimed = yield* Ref.modify(input.remaining, (value) => [value > 0, Math.max(0, value - 1)])
  if (!claimed) return failedTask(task, parentID, input, "Heavy node budget exhausted")
  const recursive = task.mode === "recurse" && input.depth + 1 < input.settings.maxDepth
  const sessionID = input.runtime.childID(parentID, recursive ? `${task.id}:plan` : `${task.id}:work`)
  yield* input.runtime.progress(
    input.context,
    {
      workflow: "heavy",
      phase: task.mode === "recurse" && input.depth + 1 < input.settings.maxDepth ? "recursing" : "executing",
      depth: input.depth + 1,
      node: task.id,
      capability: task.capability,
      session_id: sessionID,
    },
    `Heavy is executing ${task.title}`,
  )

  const execution = recursive
    ? executeNode({
        ...input,
        id: task.id,
        title: task.title,
        objective: task.objective,
        capability: task.capability,
        depth: input.depth + 1,
        parentNodeID: input.id,
        parentID,
        inheritedContext: [
          ...input.inheritedContext,
          ...dependencies,
          ...(dependencyResults.length > 0 ? [dependencyReports] : []),
        ],
      })
    : executeLeaf(task, dependencies, dependencyReports, input, parentID)
  return yield* execution.pipe(
    Effect.map((result) => ({
      task,
      result: result.result,
      nodes: result.nodes,
      reportPath: result.nodes.find((node) => node.parent_id === input.id)?.report_path ?? result.nodes[0]?.report_path,
    })),
    Effect.catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      return input.runtime
        .progress(
          input.context,
          {
            workflow: "heavy",
            phase: "failed",
            stage: "execution",
            depth: input.depth + 1,
            node: task.id,
            capability: task.capability,
            session_id: sessionID,
            error: message,
          },
          `Heavy task ${task.title} failed: ${message}`,
        )
        .pipe(Effect.as(failedTask(task, parentID, input, message, sessionID)))
    }),
  )
})

const executeLeaf = Effect.fn("HeavyWorkflow.executeLeaf")(function* (
  task: WorkflowSchema.HeavyTask,
  dependencies: ReadonlyArray<string>,
  dependencyReports: string,
  input: ExecuteNodeInput,
  parentID: SessionSchema.ID,
) {
  const childID = input.runtime.childID(parentID, `${task.id}:work`)
  const prompt = yield* WorkflowReport.prompt(
    `Heavy task ${task.title}`,
    workerPrompt(input, task, dependencies, dependencyReports),
    input.settings.maxPromptBytes,
  )
  const result = yield* input.runtime.runChild({
    id: `${task.id}:work`,
    parentID,
    location: input.parent.location,
    title: `Heavy: ${task.title}`,
    agent: AgentV2.ID.make(task.capability === "write" ? "heavy-writer" : "heavy-reader"),
    model: WorkflowRuntime.resolveModel(
      input.parent.model,
      task.capability === "write" ? input.settings.models.writer : input.settings.models.worker,
    ),
    timeoutMs: input.settings.childTimeoutMs,
    finalizationRetries: input.settings.finalizationRetries,
    maxPromptBytes: input.settings.maxPromptBytes,
    result: WorkflowSchema.HeavyNodeSubmission,
    prompt,
    progress: {
      context: input.context,
      workflow: "heavy",
      phase: "executing",
      stage: "execution",
      details: {
        node_id: task.id,
        parent_node_id: input.id,
        node_depth: input.depth + 1,
        capability: task.capability,
        depends_on: task.depends_on,
      },
    },
  })
  return {
    sessionID: childID,
    result,
    nodes: [
      WorkflowSchema.HeavyNode.make({
        id: task.id,
        parent_id: input.id,
        session_id: childID,
        depth: input.depth + 1,
        title: task.title,
        objective: task.objective,
        capability: task.capability,
        report_path: input.context.execution
          ? WorkflowExecution.stageReportPath(input.context.execution, childID)
          : undefined,
        ...result,
      }),
    ],
  } satisfies NodeExecution
})

function failedTask(
  task: WorkflowSchema.HeavyTask,
  parentID: SessionSchema.ID,
  input: ExecuteNodeInput,
  message: string,
  sessionID?: SessionSchema.ID,
): Scheduled {
  const result = WorkflowSchema.HeavyNodeResult.make({
    status: "failed",
    summary: message,
    decisions: [],
    findings: [],
    changed_files: [],
    validation: [],
    risks: [message],
    follow_up: [],
  })
  return {
    task,
    result,
    nodes: [
      WorkflowSchema.HeavyNode.make({
        id: task.id,
        parent_id: input.id,
        session_id: sessionID ?? input.runtime.childID(parentID, `${task.id}:work`),
        depth: input.depth + 1,
        title: task.title,
        objective: task.objective,
        capability: task.capability,
        ...result,
      }),
    ],
  }
}

function fallbackSynthesis(children: ReadonlyArray<Scheduled>, error: string) {
  return WorkflowSchema.HeavyNodeResult.make({
    status: children.length > 0 ? "partial" : "failed",
    summary:
      children
        .filter((child) => child.result.status !== "failed")
        .map((child) => child.result.summary)
        .filter(Boolean)
        .join("\n\n") ||
      "Heavy could not produce its bounded structured synthesis; detailed stage reports remain available.",
    decisions: children.flatMap((child) => child.result.decisions),
    findings: children.flatMap((child) => child.result.findings),
    changed_files: Array.from(new Set(children.flatMap((child) => child.result.changed_files))),
    validation: children.flatMap((child) => child.result.validation),
    risks: [...children.flatMap((child) => child.result.risks), `Heavy synthesis failed: ${error}`],
    follow_up: children.flatMap((child) => child.result.follow_up),
  })
}

type PlanRecord = {
  readonly task: WorkflowSchema.HeavyTask
  readonly nodeID?: string
  readonly disposition: WorkflowSchema.HeavyPlanTaskRecord["disposition"]
  readonly reason?: string
}

function normalizeTasks(tasks: ReadonlyArray<WorkflowSchema.HeavyTask>, input: ExecuteNodeInput) {
  const indexed = tasks.map((task, index) => ({
    task,
    index,
    nodeID: `${input.id}.${index + 1}`,
  }))
  const replaced = indexed.filter((entry) => reportOnly(entry.task))
  const substantive = indexed.filter((entry) => !replaced.includes(entry))
  const bounded = substantive.slice(0, input.settings.tasksPerNode)
  const capped = substantive.slice(input.settings.tasksPerNode)
  const blocked = new Map<number, string>()
  const selected = (() => {
    const visit = (current: typeof bounded): typeof bounded => {
      const ids = new Set(current.map((entry) => entry.task.id))
      const invalid = current.filter((entry) => entry.task.depends_on.some((dependency) => !ids.has(dependency)))
      if (invalid.length === 0) return current
      invalid.forEach((entry) => {
        const missing = entry.task.depends_on.filter((dependency) => !ids.has(dependency))
        blocked.set(entry.index, `Planned dependencies were not scheduled: ${missing.join(", ")}`)
      })
      return visit(current.filter((entry) => !invalid.includes(entry)))
    }
    return visit(bounded)
  })()
  const canRecurse = input.depth + 1 < input.settings.maxDepth
  const normalized = selected.map((entry, index) =>
    WorkflowSchema.HeavyTask.make({
      ...entry.task,
      id: entry.nodeID,
      capability:
        input.capability === "read" || (entry.task.capability === "write" && !requiresWrite(entry.task))
          ? "read"
          : entry.task.capability,
      mode: canRecurse && (index === 0 || entry.task.mode === "recurse") ? "recurse" : "leaf",
      depends_on: entry.task.depends_on.flatMap((dependency) => {
        const target = selected.find((candidate) => candidate.task.id === dependency)
        return target ? [target.nodeID] : []
      }),
    }),
  )
  const records: ReadonlyArray<PlanRecord> = indexed.map((entry) => {
    if (selected.includes(entry))
      return {
        task: entry.task,
        nodeID: entry.nodeID,
        disposition: "executed",
      }
    if (replaced.includes(entry))
      return {
        task: entry.task,
        disposition: "replaced",
        reason: "Automatic node synthesis replaces this report-only task.",
      }
    if (capped.includes(entry))
      return {
        task: entry.task,
        disposition: "capped",
        reason: `The plan exceeded workflows.heavy.tasks_per_node (${input.settings.tasksPerNode}).`,
      }
    return {
      task: entry.task,
      disposition: "blocked",
      reason: blocked.get(entry.index) ?? "The planned task could not be scheduled.",
    }
  })
  if (normalized.length > 0) return { tasks: normalized, records }
  const fallback = WorkflowSchema.HeavyTask.make({
    id: `${input.id}.fallback`,
    title: input.title,
    objective: input.objective,
    capability: input.capability,
    mode: "leaf",
    depends_on: [],
  })
  return {
    tasks: [fallback],
    records: [
      ...records,
      {
        task: fallback,
        nodeID: fallback.id,
        disposition: "fallback" as const,
        reason: "No substantive planned task remained, so Heavy executed the current objective directly.",
      },
    ],
  }
}

function reconcilePlan(records: ReadonlyArray<PlanRecord>, completed: ReadonlyMap<string, Scheduled>) {
  return records.map((record) => {
    const scheduled = record.nodeID ? completed.get(record.nodeID) : undefined
    const node = record.nodeID ? scheduled?.nodes.find((candidate) => candidate.id === record.nodeID) : undefined
    return WorkflowSchema.HeavyPlanTaskRecord.make({
      id: record.task.id,
      node_id: record.nodeID,
      title: record.task.title,
      disposition: record.disposition,
      status: scheduled?.result.status,
      reason: record.reason,
      session_id: node?.session_id,
      report_path: scheduled?.reportPath,
      relationship: record.task.relationship,
      contribution: record.task.contribution,
      exclusions: record.task.exclusions,
    })
  })
}

function reportOnly(task: WorkflowSchema.HeavyTask) {
  if (task.capability !== "read" || task.depends_on.length === 0) return false
  if (/^(?:final )?(?:report|summary|synthesis)\b/i.test(task.title)) return true
  if (
    /^(?:synthesi[sz]e|summari[sz]e|assemble|integrate|compile|write|draft)\b.*\b(?:report|summary|findings|recommendations?|plan|answer)\b/i.test(
      task.title,
    )
  )
    return true
  return /^(?:produce|create)\b.*\b(?:final report|final answer|executive summary|synthesis)\b/i.test(task.title)
}

const reviewWithCouncil = Effect.fn("HeavyWorkflow.reviewWithCouncil")(function* (
  input: ExecuteNodeInput,
  planningSessionID: SessionSchema.ID,
  completed: ReadonlyMap<string, Scheduled>,
  settings: CouncilWorkflow.Settings,
  question = `Critically review the evidence and conclusions for this Heavy subproblem: ${input.objective}`,
) {
  const reports = yield* Effect.promise(() =>
    WorkflowReport.readArtifacts(
      Array.from(completed.values(), (item) => ({
        title: item.task.title,
        reportPath: item.reportPath,
      })),
    ),
  )
  const prompt = councilPrompt(input, completed, reports)
  const parent = {
    ...input.parent,
    id: planningSessionID,
    parentID: input.parent.id,
    title: `Council review: ${input.title}`,
  }
  const rootExecution = input.context.execution
  if (!rootExecution) return yield* CouncilWorkflow.run(prompt, parent, input.context, settings, input.runtime)

  const coordination = yield* WorkflowExecution.claimCouncil(rootExecution, {
    objective: question,
    artifactPaths: Array.from(completed.values()).flatMap((item) => (item.reportPath ? [item.reportPath] : [])),
  })
  if (!coordination.owner) return yield* WorkflowExecution.awaitCouncil(rootExecution, coordination.claim)
  const execution = yield* WorkflowExecution.delegate(rootExecution, {
    workflow: "council",
    objective: question,
    sessionID: planningSessionID,
    toolCallID: `${input.context.toolCallID}:${input.id}:council-review`,
  }).pipe(Effect.tapError((error) => WorkflowExecution.failCouncil(rootExecution, coordination.claim, error)))
  yield* WorkflowExecution.bindCouncil(execution, coordination.claim, execution.id)
  return yield* CouncilWorkflow.run(prompt, parent, { ...input.context, execution }, settings, input.runtime).pipe(
    Effect.flatMap((result) =>
      Effect.gen(function* () {
        const delegations = yield* WorkflowExecution.manifest(execution)
        const sessionManifest = yield* WorkflowExecution.sessions(execution)
        const sourceProvenance = yield* Effect.promise(() =>
          WorkflowReport.collectSourceProvenance(
            result,
            [
              result.synthesis_report_path,
              ...result.perspectives.map((perspective) => perspective.report_path),
              ...result.debate.map((contribution) => contribution.report_path),
              ...delegations.map((delegation) => delegation.report_path),
            ],
            sessionManifest,
          ),
        )
        const output = WorkflowSchema.CouncilOutput.make({
          ...result,
          ...WorkflowReport.health(result.status, sessionManifest, result.coverage ?? [], sourceProvenance),
          final_response: yield* Effect.promise(() => WorkflowReport.readArtifact(result.synthesis_report_path)),
          usage: WorkflowReport.aggregateUsage(sessionManifest),
          timing: WorkflowExecution.timing(execution),
          report_path: execution.reportPath,
          source_manifest: sourceProvenance.map((source) => source.url),
          source_provenance: sourceProvenance,
          session_manifest: sessionManifest,
          delegations,
        })
        yield* Effect.tryPromise({
          try: () => WorkflowReport.writeCouncil(question, output, execution.reportPath),
          catch: (error) =>
            new Error(
              `Failed to write Council review report: ${error instanceof Error ? error.message : String(error)}`,
            ),
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

function councilPrompt(input: ExecuteNodeInput, completed: ReadonlyMap<string, Scheduled>, reports: string) {
  return `Critically review the Heavy workflow's evidence before final synthesis.

Root objective:
${input.rootObjective}

Heavy results:
${JSON.stringify(
  Array.from(completed.values(), (item) => ({
    task: {
      title: item.task.title,
      objective: item.task.objective,
    },
    result: item.result,
    report_path: item.reportPath,
  })),
  undefined,
  2,
)}

Durable Heavy reports, loaded deterministically:
${reports}

Use independent perspectives and explicit rebuttal to challenge assumptions, reconcile contradictions, identify missing evidence, and assess whether the conclusions answer the root objective. Preserve minority positions and distinguish verified evidence from estimates.`
}

function planningPrompt(input: ExecuteNodeInput) {
  const reserved = reservedScopes(input)
  return `Plan one bounded level of a recursive Heavy workflow.

Root objective:
${input.rootObjective}

Current objective:
${input.objective}

Depth: ${input.depth} of ${input.settings.maxDepth}
Maximum tasks: ${input.settings.tasksPerNode}
Inherited context from ancestors:
${input.inheritedContext.join("\n\n") || "(none)"}

Scope already owned outside this branch:
${JSON.stringify(reserved, undefined, 2)}

Break the objective into independently useful tasks. For every task, declare relationship as partition, corroborate, challenge, or integrate; state its unique contribution; and list explicit exclusions. Partition tasks must own disjoint outcomes. Corroborate and challenge may overlap only deliberately, while integrate must depend on the material it combines. Before submitting, compare every task semantically against every sibling and reserved scope, then rewrite accidental duplicates so each task makes a unique contribution. Children may decompose the current branch's owned scope, but must not reclaim a sibling or ancestor branch's reserved scope.

Use depends_on IDs to encode ordering. Choose capability "write" whenever a task must edit files, run mutating commands, install dependencies, format, or test changes. Choose mode "recurse" only when another planning level will materially improve depth. A read-only parent may only produce read tasks. Do not perform the work in the plan itself.

Do not create a task whose sole purpose is to synthesize, summarize, assemble, or write the final report from sibling results. Heavy automatically synthesizes every node after its substantive tasks finish.

If you delegate while planning, the delegated objective must be a strict, bounded subproblem of the current objective. Never pass the root or current objective unchanged. ${
    input.settings.councilMode === "off"
      ? "Council delegation is disabled."
      : "Use Council only for a concrete disputed decision with credible competing positions."
  } Use Heavy only for a subproblem that itself needs multi-step decomposition.

Assess Council routing explicitly. Recommend Council when the work contains competing valid objectives, high uncertainty, conflicting evidence, a consequential decision, assumption-sensitive conclusions, or multiple defensible interpretations. Supply a narrow debate question, concrete signals, and a reason; otherwise record why debate is unnecessary.

Submit a compact plan through workflow_result and preserve any detailed planning rationale and scope-review decisions in workflow_report.`
}

function workerPrompt(
  input: ExecuteNodeInput,
  task: WorkflowSchema.HeavyTask,
  dependencies: ReadonlyArray<string>,
  dependencyReports: string,
) {
  return `Execute one Heavy workflow task completely.

Root objective:
${input.rootObjective}

Task:
${task.objective}

Capability: ${task.capability}
Scope relationship: ${task.relationship ?? "partition"}
Unique contribution: ${task.contribution ?? task.objective}
Explicit exclusions:
${JSON.stringify(task.exclusions ?? [], undefined, 2)}

Complete scope ledger:
${JSON.stringify(input.scopeLedger, undefined, 2)}

Ancestor context:
${input.inheritedContext.join("\n\n") || "(none)"}

Dependency results:
${dependencies.join("\n\n") || "(none)"}

Durable dependency reports, loaded deterministically:
${dependencyReports}

${
  task.capability === "write"
    ? "You are authorized to inspect and mutate the workspace. Use editing and bash tools as needed, preserve unrelated user changes, and validate your work."
    : "This is a read-only task. Inspect deeply but do not mutate the workspace."
}

${
  input.settings.councilMode === "off"
    ? "Council delegation is disabled for this Heavy workflow."
    : "If a genuinely disputed decision would benefit from independent positions and rebuttal, delegate that narrow question to Council."
} If one bounded subproblem still requires several independent tasks, delegate only that subproblem to Heavy. Never pass the root objective or this complete task unchanged to either workflow.

Stay within the assigned contribution and exclusions. If the work uncovers a consequential unresolved dispute that was not debated, set workflow_result.council_request with a narrow question, concrete signals, and rationale.

Preserve all useful information in workflow_report: decisions, evidence-backed findings, source URLs, changed files, validation performed, risks, and follow-up. Keep source URLs near the evidence they support. Finish with a compact structured index through workflow_result; do not repeat the full report in its summary.`
}

function synthesisPrompt(
  input: ExecuteNodeInput,
  rationale: string,
  plan: ReadonlyArray<WorkflowSchema.HeavyPlanTaskRecord>,
  completed: ReadonlyMap<string, Scheduled>,
  childReports: string,
  council: WorkflowSchema.CouncilOutput | undefined,
  routing: WorkflowSchema.CouncilRouting,
  evidence: ReadonlyArray<WorkflowSchema.SourceReference>,
) {
  return `Synthesize a Heavy workflow node without discarding material information.

Root objective:
${input.rootObjective}

Current objective:
${input.objective}

Planner rationale:
${rationale}

Plan reconciliation:
${JSON.stringify(plan, undefined, 2)}

Ancestor context:
${input.inheritedContext.join("\n\n") || "(none)"}

Child results:
${JSON.stringify(
  Array.from(completed.values(), (item) => ({
    task: item.task,
    result: item.result,
    report_path: item.reportPath,
  })),
  undefined,
  2,
)}

Durable direct-child and Council reports, loaded deterministically:
${childReports}

Council review:
${council ? JSON.stringify(council, undefined, 2) : "(none)"}

Council routing decision:
${JSON.stringify(routing, undefined, 2)}

Evidence ledger derived from tool execution:
${JSON.stringify(evidence, undefined, 2)}

The evidence ledger is authoritative for verification status. Never present an unverified or failed source as directly verified, and explicitly qualify material conclusions that depend on partial evidence. Failed direct checks remain relevant provenance even when a child omitted the URL from prose.

The durable reports above are canonical and must be incorporated, including material omitted from bounded child results. Re-read the current workspace when child mutations affect the conclusion. In workflow_result.coverage, include one entry for every durable report using its exact title and report_path. For each entry, briefly list findings used, conclusions explicitly rejected, and unresolved contradictions; never claim receipt of a missing artifact. ${
    input.settings.councilMode === "auto"
      ? "If the conclusion depends on a consequential unresolved branch-local tradeoff and no child report contains a Council deliberation, delegate exactly one narrow disputed question to Council before finishing. Supply a stable issue_key and the exact artifact_paths framing it; leave whole-objective disputes for the root synthesis."
      : input.settings.councilMode === "off"
        ? "Council delegation is disabled for this Heavy workflow."
        : council
          ? "A deterministic Council review has already been run for this synthesis; integrate its consensus and minority positions without requesting a duplicate review."
          : "A deterministic Council review is guaranteed at the configured synthesis boundary. Delegate only a distinct narrow dispute that cannot wait for that review."
  } Preserve concrete evidence, source URLs, changed files, validation, constraints, delegated workflow conclusions and minority positions, risks, and follow-up. Keep source URLs in the evidence entries they support. Mark the result partial or failed when child or delegated workflow failures prevent a complete answer.

The workflow_report is the completed synthesis for this node and, at the root, the final Heavy document. It is not an executive recap or navigation page. Choose its outline from the objective and the material actually gathered; do not impose a domain-specific stock template. Reconstruct the reasoning and preserve the material detail, evidence, disagreement, uncertainty, and conclusions needed for a standalone treatment. Treat every coverage entry as a content obligation: the report must explain the important information it used, not merely say that an artifact was reviewed. Never use "see the child report for details" as a substitute for incorporating information, and never paste whole child reports together. A request for a concise user-facing answer applies to workflow_result.summary, not to the durable report. Use workflow_report repeatedly, normally one call per major section, when that is needed to author a complete document.

Submit a compact structured index through workflow_result and put the complete subject-adaptive standalone document in workflow_report.`
}

function scopeReviewPrompt(input: ExecuteNodeInput, plan: WorkflowSchema.HeavyPlan, conflicts: ReadonlyArray<string>) {
  return `Revise a Heavy plan whose scope review found accidental overlap.

Current objective:
${input.objective}

Reserved scopes outside this branch:
${JSON.stringify(reservedScopes(input), undefined, 2)}

Submitted plan:
${JSON.stringify(plan, undefined, 2)}

Detected conflicts:
${conflicts.map((conflict) => `- ${conflict}`).join("\n")}

Preserve useful breadth and recursion, but differentiate accidental duplicates. Every task must declare relationship, unique contribution, and explicit exclusions. Retain overlap only when it is intentionally marked corroborate, challenge, or integrate. Preserve dependencies and write capability. Reassess the Council routing recommendation after revising the plan. Submit the complete corrected plan through workflow_result and record the scope decisions in workflow_report.`
}

function reservedScopes(input: ExecuteNodeInput) {
  return input.scopeLedger.filter((task) => !input.id.startsWith(task.id))
}

function scopeConflicts(tasks: ReadonlyArray<WorkflowSchema.HeavyTask>, input: ExecuteNodeInput) {
  const entries = tasks.map((task, index) => ({ task, label: `task ${index + 1} (${task.title})` }))
  const siblings = entries.flatMap((left, index) =>
    entries
      .slice(index + 1)
      .flatMap((right) =>
        accidentalOverlap(left.task, right.task)
          ? [`${left.label} overlaps ${right.label} without an intentional overlap relationship.`]
          : [],
      ),
  )
  const reserved = entries.flatMap((entry) =>
    reservedScopes(input).flatMap((scope) =>
      accidentalOverlap(entry.task, scope)
        ? [`${entry.label} reclaims reserved scope ${scope.title} without an intentional overlap relationship.`]
        : [],
    ),
  )
  return [...siblings, ...reserved]
}

function accidentalOverlap(left: WorkflowSchema.HeavyTask, right: WorkflowSchema.HeavyTask) {
  if (
    left.relationship === "corroborate" ||
    left.relationship === "challenge" ||
    left.relationship === "integrate" ||
    right.relationship === "corroborate" ||
    right.relationship === "challenge" ||
    right.relationship === "integrate"
  )
    return false
  return (
    similarity(
      `${left.title} ${left.objective} ${left.contribution ?? ""}`,
      `${right.title} ${right.objective} ${right.contribution ?? ""}`,
    ) >= 0.75
  )
}

function similarity(left: string, right: string) {
  const terms = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(
          (word) =>
            word.length > 2 && !["and", "for", "from", "into", "the", "this", "that", "with", "without"].includes(word),
        )
        .map((word) => (word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word)),
    )
  const leftTerms = terms(left)
  const rightTerms = terms(right)
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0
  const shared = Array.from(leftTerms).filter((term) => rightTerms.has(term)).length
  return shared / (leftTerms.size + rightTerms.size - shared)
}

function requiresWrite(task: WorkflowSchema.HeavyTask) {
  return /\b(add|apply|build|change|commit|create|delete|edit|fix|format|generate|implement|install|migrate|modify|patch|refactor|remove|rename|replace|run|test|update|validate|write)\b/i.test(
    `${task.title} ${task.objective}`,
  )
}
