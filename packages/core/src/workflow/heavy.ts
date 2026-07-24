export * as HeavyWorkflow from "./heavy"

import { Effect, Ref } from "effect"
import { AgentV2 } from "../agent"
import { SessionSchema } from "../session/schema"
import { Hash } from "../util/hash"
import { CouncilWorkflow } from "./council"
import { WorkflowRuntime } from "./runtime"
import { WorkflowSchema } from "./schema"

export interface Settings {
  readonly maxDepth: number
  readonly tasksPerNode: number
  readonly maxNodes: number
  readonly concurrency: number
  readonly childTimeoutMs: number
  readonly onFailure: "keep" | "stop"
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
  const planned = yield* input.runtime
    .runChild({
      id: planID,
      parentID: input.parentID,
      location: input.parent.location,
      title: `Heavy plan: ${input.title}`,
      agent: AgentV2.ID.make("heavy-planner"),
      model: WorkflowRuntime.resolveModel(input.parent.model, input.settings.models.planner),
      timeoutMs: input.settings.childTimeoutMs,
      result: WorkflowSchema.HeavyPlan,
      prompt: planningPrompt(input),
      progress: {
        context: input.context,
        workflow: "heavy",
        phase: "planning",
        stage: "planning",
      },
    })
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
  const tasks = normalizeTasks(planned.plan.tasks, input)
  const scheduled = yield* schedule(
    tasks,
    new Map(),
    [],
    {
      ...input,
      inheritedContext: [
        ...input.inheritedContext,
        JSON.stringify({
          ancestor: input.id,
          objective: input.objective,
          planner_rationale: planned.plan.rationale,
        }),
      ],
    },
    planningSessionID,
  )
  const council =
    input.depth === 0 && input.settings.council
      ? yield* reviewWithCouncil(input, planningSessionID, scheduled.completed, input.settings.council)
      : { output: undefined, failure: undefined }
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
  const synthesized = yield* input.runtime
    .runChild({
      id: `${input.id}:synthesis`,
      parentID: planningSessionID,
      location: input.parent.location,
      title: `Heavy synthesis: ${input.title}`,
      agent: AgentV2.ID.make("heavy-synthesizer"),
      model: WorkflowRuntime.resolveModel(input.parent.model, input.settings.models.synthesizer),
      timeoutMs: input.settings.childTimeoutMs,
      result: WorkflowSchema.HeavyNodeResult,
      prompt: synthesisPrompt(input, planned.plan.rationale, scheduled.completed, council.output),
      progress: {
        context: input.context,
        workflow: "heavy",
        phase: "synthesizing",
        stage: "synthesis",
      },
    })
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
  const result = {
    ...synthesized.result,
    status:
      planned.failure ||
      synthesized.failure ||
      council.failure ||
      (council.output !== undefined && council.output.status !== "completed")
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
    ...result,
  })
  return {
    sessionID: planningSessionID,
    result,
    nodes: [node, ...children.flatMap((child) => child.nodes)],
    council: council.output,
  } satisfies NodeExecution
})

type Scheduled = {
  readonly task: WorkflowSchema.HeavyTask
  readonly result: WorkflowSchema.HeavyNodeResult
  readonly nodes: ReadonlyArray<WorkflowSchema.HeavyNode>
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

  const recursiveReaders = ready.filter((task) => task.mode === "recurse" && task.capability === "read")
  const recursiveWriters = ready.filter((task) => task.mode === "recurse" && task.capability === "write")
  const next = new Map(completed)
  // Read-only recursive branches cannot mutate the workspace, so they may fan
  // out like leaf readers. Write-capable branches remain serial because any
  // descendant may run bash or edit the same files.
  const recursiveReadResults = yield* Effect.forEach(
    recursiveReaders,
    (task) => executeTask(task, next, input, parentID),
    { concurrency: input.settings.concurrency },
  )
  recursiveReadResults.forEach((result) => next.set(result.task.id, result))
  const recursiveWriteResults: Scheduled[] = []
  for (const task of recursiveWriters) {
    const result = yield* executeTask(task, next, input, parentID)
    recursiveWriteResults.push(result)
    next.set(result.task.id, result)
    if (result.result.status === "failed" && input.settings.onFailure === "stop") break
  }
  const recursiveResults = [...recursiveReadResults, ...recursiveWriteResults]
  const recursiveFailures = recursiveResults
    .filter((result) => result.result.status === "failed")
    .map((result) => result.task.id)
  if (recursiveFailures.length > 0 && input.settings.onFailure === "stop")
    return { completed: next, failedDependencies: [...failedDependencies, ...recursiveFailures] }

  const readable = ready.filter((task) => task.mode === "leaf" && task.capability === "read")
  const writable = ready.filter((task) => task.mode === "leaf" && task.capability === "write")
  // Bash can mutate arbitrary paths, so remaining leaf readers finish before
  // leaf writers take the workspace one at a time.
  const readResults = yield* Effect.forEach(readable, (task) => executeTask(task, next, input, parentID), {
    concurrency: input.settings.concurrency,
  })
  for (const result of readResults) next.set(result.task.id, result)
  const readFailures = readResults.filter((result) => result.result.status === "failed").map((result) => result.task.id)
  if (readFailures.length > 0 && input.settings.onFailure === "stop")
    return { completed: next, failedDependencies: [...failedDependencies, ...readFailures] }
  const writeResults: Scheduled[] = []
  for (const task of writable) {
    const result = yield* executeTask(task, next, input, parentID)
    writeResults.push(result)
    next.set(result.task.id, result)
    if (result.result.status === "failed" && input.settings.onFailure === "stop") break
  }
  const failures = [
    ...recursiveFailures,
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
  const dependencies = task.depends_on.flatMap((dependency) => {
    const result = completed.get(dependency)
    return result ? [JSON.stringify({ id: dependency, result: result.result })] : []
  })
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
        inheritedContext: [...input.inheritedContext, ...dependencies],
      })
    : executeLeaf(task, dependencies, input, parentID)
  return yield* execution.pipe(
    Effect.map((result) => ({ task, result: result.result, nodes: result.nodes })),
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
  input: ExecuteNodeInput,
  parentID: SessionSchema.ID,
) {
  const childID = input.runtime.childID(parentID, `${task.id}:work`)
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
    result: WorkflowSchema.HeavyNodeResult,
    prompt: workerPrompt(input, task, dependencies),
    progress: {
      context: input.context,
      workflow: "heavy",
      phase: "executing",
      stage: "execution",
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
        .map((child) => child.result.summary)
        .filter(Boolean)
        .join("\n\n") || `Heavy synthesis failed: ${error}`,
    decisions: children.flatMap((child) => child.result.decisions),
    findings: children.flatMap((child) => child.result.findings),
    changed_files: Array.from(new Set(children.flatMap((child) => child.result.changed_files))),
    validation: children.flatMap((child) => child.result.validation),
    risks: [...children.flatMap((child) => child.result.risks), `Heavy synthesis failed: ${error}`],
    follow_up: children.flatMap((child) => child.result.follow_up),
  })
}

function normalizeTasks(tasks: ReadonlyArray<WorkflowSchema.HeavyTask>, input: ExecuteNodeInput) {
  const substantive = tasks.filter(
    (task) =>
      !(
        task.capability === "read" &&
        task.depends_on.length > 0 &&
        !tasks.some((candidate) => candidate.depends_on.includes(task.id)) &&
        /(^|\b)(synthesi[sz]e|summari[sz]e|assemble|integrate|compile|produce|write|draft)\b.*\b(report|findings|recommendations?|plan|answer)\b/i.test(
          `${task.title} ${task.objective}`,
        )
      ),
  )
  const selected =
    substantive.length > 0
      ? substantive.slice(0, input.settings.tasksPerNode)
      : tasks.length > 0
        ? tasks.slice(0, 1)
        : [
            {
              id: "fallback",
              title: input.title,
              objective: input.objective,
              capability: input.capability,
              mode: "leaf" as const,
              depends_on: [],
            },
          ]
  const canRecurse = input.depth + 1 < input.settings.maxDepth
  return selected.map((task, index) =>
    WorkflowSchema.HeavyTask.make({
      ...task,
      id: `${input.id}.${index + 1}`,
      capability: input.capability === "read" ? "read" : task.capability,
      mode: canRecurse && (index === 0 || task.mode === "recurse") ? "recurse" : "leaf",
      depends_on:
        canRecurse && index === 0
          ? []
          : task.depends_on.flatMap((dependency) => {
              const dependencyIndex = selected.findIndex((candidate) => candidate.id === dependency)
              return dependencyIndex >= 0 ? [`${input.id}.${dependencyIndex + 1}`] : []
            }),
    }),
  )
}

const reviewWithCouncil = Effect.fn("HeavyWorkflow.reviewWithCouncil")(function* (
  input: ExecuteNodeInput,
  planningSessionID: SessionSchema.ID,
  completed: ReadonlyMap<string, Scheduled>,
  settings: CouncilWorkflow.Settings,
) {
  const output = yield* CouncilWorkflow.run(
    councilQuestion(input, completed),
    {
      ...input.parent,
      id: planningSessionID,
      parentID: input.parent.id,
      title: `Council review: ${input.title}`,
    },
    input.context,
    settings,
    input.runtime,
  )
  return { output, failure: undefined as string | undefined }
})

function councilQuestion(input: ExecuteNodeInput, completed: ReadonlyMap<string, Scheduled>) {
  return `Critically review the Heavy workflow's evidence before final synthesis.

Root objective:
${input.rootObjective}

Heavy reports:
${JSON.stringify(
  Array.from(completed.values(), (item) => ({
    task: {
      title: item.task.title,
      objective: item.task.objective,
    },
    report: {
      status: item.result.status,
      summary: item.result.summary.slice(0, 4_000),
      decisions: item.result.decisions.slice(0, 16),
      findings: item.result.findings.slice(0, 12).map((finding) => ({
        claim: finding.claim,
        evidence: finding.evidence.slice(0, 6),
      })),
      validation: item.result.validation.slice(0, 12),
      risks: item.result.risks.slice(0, 16),
      follow_up: item.result.follow_up.slice(0, 12),
    },
  })),
  undefined,
  2,
)}

Use genuinely independent perspectives to challenge assumptions, reconcile contradictions, identify missing evidence, and assess whether the proposed conclusions and tradeoffs answer the root objective. Preserve source URLs and distinguish verified evidence from estimates.`
}

function planningPrompt(input: ExecuteNodeInput) {
  return `Plan one bounded level of a recursive Heavy workflow.

Root objective:
${input.rootObjective}

Current objective:
${input.objective}

Depth: ${input.depth} of ${input.settings.maxDepth}
Maximum tasks: ${input.settings.tasksPerNode}
Inherited context from ancestors:
${input.inheritedContext.join("\n\n") || "(none)"}

Break the objective into independently useful tasks. Use depends_on IDs to encode ordering. Choose capability "write" whenever a task must edit files, run mutating commands, install dependencies, format, or test changes. Choose mode "recurse" only when another planning level will materially improve depth. A read-only parent may only produce read tasks. Do not perform the work in the plan itself.

Do not create a task whose sole purpose is to synthesize, summarize, assemble, or write the final report from sibling results. Heavy automatically synthesizes every node after its substantive tasks finish.

Submit the plan through workflow_result.`
}

function workerPrompt(input: ExecuteNodeInput, task: WorkflowSchema.HeavyTask, dependencies: ReadonlyArray<string>) {
  return `Execute one Heavy workflow task completely.

Root objective:
${input.rootObjective}

Task:
${task.objective}

Capability: ${task.capability}
Ancestor context:
${input.inheritedContext.join("\n\n") || "(none)"}

Dependency results:
${dependencies.join("\n\n") || "(none)"}

${
  task.capability === "write"
    ? "You are authorized to inspect and mutate the workspace. Use editing and bash tools as needed, preserve unrelated user changes, and validate your work."
    : "This is a read-only task. Inspect deeply but do not mutate the workspace."
}

Return all useful information, not just a short conclusion: decisions, evidence-backed findings, source URLs, changed files, validation performed, risks, and follow-up. Keep source URLs in the evidence entries they support. Submit the complete structured result through workflow_result.`
}

function synthesisPrompt(
  input: ExecuteNodeInput,
  rationale: string,
  completed: ReadonlyMap<string, Scheduled>,
  council: WorkflowSchema.CouncilOutput | undefined,
) {
  return `Synthesize a Heavy workflow node without discarding material information.

Root objective:
${input.rootObjective}

Current objective:
${input.objective}

Planner rationale:
${rationale}

Ancestor context:
${input.inheritedContext.join("\n\n") || "(none)"}

Child results:
${JSON.stringify(
  Array.from(completed.values(), (item) => ({ task: item.task, result: item.result, nodes: item.nodes })),
  undefined,
  2,
)}

Council review:
${council ? JSON.stringify(council, undefined, 2) : "(not requested for this node)"}

Re-read the current workspace when child mutations affect the conclusion. Preserve concrete evidence, source URLs, changed files, validation, constraints, Council consensus and minority positions, risks, and follow-up. Keep source URLs in the evidence entries they support. Mark the result partial or failed when child or Council failures prevent a complete answer. Submit the complete structured result through workflow_result.`
}
