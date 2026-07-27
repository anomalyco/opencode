export * as WorkflowExecution from "./execution"

import path from "node:path"
import { DateTime, Deferred, Effect, Ref, Semaphore } from "effect"
import { SessionSchema } from "../session/schema"
import { Tool } from "../tool/tool"
import { Hash } from "../util/hash"
import { WorkflowSchema } from "./schema"

export type Kind = "heavy" | "council" | "research"

type Invocation = {
  readonly id: string
  readonly parentID?: string
  readonly parentSessionID: SessionSchema.ID
  readonly workflow: Kind
  readonly depth: number
  readonly objective: string
  readonly reportPath: string
  readonly status: "running" | WorkflowSchema.Status
  readonly executionStatus?: WorkflowSchema.ExecutionStatus
  readonly artifactStatus?: WorkflowSchema.ArtifactStatus
  readonly evidenceStatus?: WorkflowSchema.Status
  readonly summary: string
  readonly rootSessionID?: SessionSchema.ID
  readonly sessionIDs: ReadonlyArray<SessionSchema.ID>
  readonly startedAt: number
  readonly completedAt?: number
}

type WaitTracker = {
  active: number
  elapsed: number
  started?: number
  resumeWorker: boolean
}

type Settlement = {
  done: boolean
  parent?: Context
}

type WorkerLease = {
  held: boolean
}

type Progress = {
  readonly structured: Record<string, unknown>
  readonly text: string
}

export type CouncilClaim = {
  readonly key: string
  readonly objective: string
  readonly artifactPaths: ReadonlyArray<string>
  readonly ownerRunID?: string
  readonly result: Deferred.Deferred<WorkflowSchema.CouncilOutput, Tool.Failure>
}

export type CouncilCoordination =
  | { readonly owner: true; readonly claim: CouncilClaim }
  | { readonly owner: false; readonly claim: CouncilClaim }

type Root = {
  readonly id: string
  readonly rootSessionID: SessionSchema.ID
  readonly workflow: Kind
  readonly maxDepth: number
  readonly remaining: Ref.Ref<number>
  readonly maxCouncils: number
  readonly invocations: Ref.Ref<ReadonlyArray<Invocation>>
  readonly sessions: Ref.Ref<ReadonlyArray<WorkflowSchema.SessionStage>>
  readonly councils: Ref.Ref<ReadonlyArray<CouncilClaim>>
  readonly delegates: Readonly<Partial<Record<Kind, ReadonlySet<Kind>>>>
  readonly debateDeduplication: "off" | "exact" | "semantic"
  readonly onProgress?: (input: Progress) => Effect.Effect<void>
  readonly writer: ReturnType<typeof Semaphore.makeUnsafe>
  readonly workers: ReturnType<typeof Semaphore.makeUnsafe>
  readonly reportDirectory: string
  readonly startedAt: number
}

export type Context = {
  readonly root: Root
  readonly id: string
  readonly parentID?: string
  readonly workflow: Kind
  readonly depth: number
  readonly reportPath: string
  readonly writer: ReturnType<typeof Semaphore.makeUnsafe>
  readonly objective: string
  readonly wait: WaitTracker
  readonly settlement: Settlement
  readonly worker: WorkerLease
  readonly sessionID?: SessionSchema.ID
  readonly startedAt: number
}

export function make(input: {
  readonly workflow: Kind
  readonly objective: string
  readonly sessionID: SessionSchema.ID
  readonly toolCallID: string
  readonly directory: string
  readonly reportDirectory: string
  readonly maxDepth: number
  readonly maxWorkflows: number
  readonly maxCouncils?: number
  readonly maxConcurrency?: number
  readonly debateDeduplication?: "off" | "exact" | "semantic"
  readonly delegates: Readonly<Partial<Record<Kind, ReadonlySet<Kind>>>>
  readonly onProgress?: (input: Progress) => Effect.Effect<void>
}) {
  return Effect.gen(function* () {
    const startedAt = DateTime.toEpochMillis(yield* DateTime.now)
    const id = `run-${Hash.fast(`${input.sessionID}:${input.toolCallID}`).slice(0, 16)}`
    const reportDirectory = path.resolve(input.directory, input.reportDirectory, input.sessionID, id)
    const reportPath = path.join(reportDirectory, reportName(input.workflow))
    const root: Root = {
      id,
      rootSessionID: input.sessionID,
      workflow: input.workflow,
      maxDepth: input.maxDepth,
      remaining: yield* Ref.make(Math.max(0, input.maxWorkflows - 1)),
      maxCouncils: input.maxCouncils ?? 8,
      invocations: yield* Ref.make<ReadonlyArray<Invocation>>([
        {
          id,
          parentSessionID: input.sessionID,
          workflow: input.workflow,
          depth: 0,
          objective: input.objective,
          reportPath,
          status: "running",
          summary: "",
          sessionIDs: [],
          startedAt,
        },
      ]),
      sessions: yield* Ref.make<ReadonlyArray<WorkflowSchema.SessionStage>>([]),
      councils: yield* Ref.make<ReadonlyArray<CouncilClaim>>([]),
      delegates: input.delegates,
      debateDeduplication: input.debateDeduplication ?? "semantic",
      onProgress: input.onProgress,
      writer: Semaphore.makeUnsafe(1),
      workers: Semaphore.makeUnsafe(input.maxConcurrency ?? 8),
      reportDirectory,
      startedAt,
    }
    return {
      root,
      id,
      workflow: input.workflow,
      depth: 0,
      reportPath,
      writer: root.writer,
      objective: input.objective,
      wait: { active: 0, elapsed: 0, resumeWorker: false },
      settlement: { done: false },
      worker: { held: false },
      startedAt,
    } satisfies Context
  })
}

export function delegate(
  parent: Context,
  input: {
    readonly workflow: Kind
    readonly objective: string
    readonly sessionID: SessionSchema.ID
    readonly toolCallID: string
  },
) {
  return Effect.gen(function* () {
    if (!parent.root.delegates[parent.workflow]?.has(input.workflow))
      return yield* new Tool.Failure({
        message: `${parent.workflow} is not configured to delegate to ${input.workflow}`,
      })
    if (sameObjective(parent.objective, input.objective))
      return yield* new Tool.Failure({
        message: "Delegated workflows must receive a strict subproblem, not the current workflow objective",
      })
    const depth = parent.depth + 1
    if (depth > parent.root.maxDepth)
      return yield* new Tool.Failure({
        message: `Workflow delegation depth ${depth} exceeds the configured maximum ${parent.root.maxDepth}`,
      })
    const claimed = yield* Ref.modify(parent.root.remaining, (remaining) => [remaining > 0, Math.max(0, remaining - 1)])
    if (!claimed)
      return yield* new Tool.Failure({
        message: "Workflow delegation budget exhausted",
      })
    const startedAt = DateTime.toEpochMillis(yield* DateTime.now)
    const id = `run-${Hash.fast(`${parent.id}:${input.sessionID}:${input.toolCallID}`).slice(0, 16)}`
    const reportPath = path.join(parent.root.reportDirectory, "runs", id, reportName(input.workflow))
    beginWait(parent.wait, startedAt, yield* releaseWorker(parent))
    yield* recordActivity(parent, "waiting_on_delegation")
    yield* Ref.update(parent.root.invocations, (invocations) => [
      ...invocations,
      {
        id,
        parentID: parent.id,
        parentSessionID: input.sessionID,
        workflow: input.workflow,
        depth,
        objective: input.objective,
        reportPath,
        status: "running",
        summary: "",
        sessionIDs: [],
        startedAt,
      } satisfies Invocation,
    ])
    return {
      root: parent.root,
      id,
      parentID: parent.id,
      workflow: input.workflow,
      depth,
      reportPath,
      writer: parent.writer,
      objective: input.objective,
      wait: { active: 0, elapsed: 0, resumeWorker: false },
      settlement: { done: false, parent },
      worker: { held: false },
      startedAt,
    } satisfies Context
  })
}

export function forChild(context: Context, agent: string, sessionID?: SessionSchema.ID) {
  return {
    ...context,
    writer: agent === "heavy-writer" || agent === "research-writer" ? Semaphore.makeUnsafe(1) : context.writer,
    wait: { active: 0, elapsed: 0, resumeWorker: false },
    worker: { held: false },
    sessionID,
  }
}

export function withWorker<A, E, R>(context: Context, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    acquireWorker(context),
    () => effect,
    () => releaseWorker(context).pipe(Effect.asVoid),
  )
}

export function complete(
  context: Context,
  input: {
    readonly status: WorkflowSchema.Status
    readonly executionStatus?: WorkflowSchema.ExecutionStatus
    readonly artifactStatus?: WorkflowSchema.ArtifactStatus
    readonly evidenceStatus?: WorkflowSchema.Status
    readonly summary: string
    readonly rootSessionID: SessionSchema.ID
  },
) {
  return Effect.gen(function* () {
    const completedAt = DateTime.toEpochMillis(yield* DateTime.now)
    const parent = settle(context, completedAt)
    if (parent) {
      yield* acquireWorker(parent)
      yield* recordActivity(parent, "provider_active")
    }
    yield* Ref.update(context.root.invocations, (invocations) =>
      invocations.map((invocation) =>
        invocation.id === context.id
          ? {
              ...invocation,
              status: input.status,
              executionStatus: input.executionStatus,
              artifactStatus: input.artifactStatus,
              evidenceStatus: input.evidenceStatus,
              summary: input.summary,
              rootSessionID: input.rootSessionID,
              completedAt,
            }
          : invocation,
      ),
    )
  })
}

export function fail(context: Context, summary: string) {
  return Effect.gen(function* () {
    const completedAt = DateTime.toEpochMillis(yield* DateTime.now)
    const parent = settle(context, completedAt)
    if (parent) {
      yield* acquireWorker(parent)
      yield* recordActivity(parent, "provider_active")
    }
    yield* Ref.update(context.root.invocations, (invocations) =>
      invocations.map((invocation) =>
        invocation.id === context.id ? { ...invocation, status: "failed", summary, completedAt } : invocation,
      ),
    )
  })
}

export function manifest(context: Context) {
  return Effect.gen(function* () {
    const invocations = yield* Ref.get(context.root.invocations)
    const collect = (parentID: string): ReadonlyArray<Invocation> =>
      invocations
        .filter((invocation) => invocation.parentID === parentID)
        .flatMap((invocation) => [invocation, ...collect(invocation.id)])
    return collect(context.id).map((invocation) =>
      WorkflowSchema.Delegation.make({
        id: invocation.id,
        parent_id: invocation.parentID,
        parent_session_id: invocation.parentSessionID,
        workflow: invocation.workflow,
        depth: invocation.depth,
        objective: invocation.objective,
        status: invocation.status === "running" ? "failed" : invocation.status,
        execution_status: invocation.executionStatus,
        artifact_status: invocation.artifactStatus,
        evidence_status: invocation.evidenceStatus,
        summary:
          invocation.status === "running" ? "Workflow ended before reaching a terminal state" : invocation.summary,
        root_session_id: invocation.rootSessionID ?? invocation.sessionIDs[0] ?? invocation.parentSessionID,
        session_ids: invocation.sessionIDs,
        report_path: invocation.reportPath,
        timing: {
          started_at: invocation.startedAt,
          completed_at: invocation.completedAt ?? invocation.startedAt,
          elapsed_ms: Math.max(0, (invocation.completedAt ?? invocation.startedAt) - invocation.startedAt),
        },
      }),
    )
  })
}

export function stageReportPath(context: Context, sessionID: SessionSchema.ID) {
  return path.join(context.root.reportDirectory, "stages", `${sessionID}.md`)
}

export function recordSession(context: Context, sessionID: SessionSchema.ID) {
  return Ref.update(context.root.invocations, (invocations) =>
    invocations.map((invocation) =>
      invocation.id === context.id && !invocation.sessionIDs.includes(sessionID)
        ? { ...invocation, sessionIDs: [...invocation.sessionIDs, sessionID] }
        : invocation,
    ),
  )
}

export function recordStage(context: Context, session: WorkflowSchema.SessionStage) {
  return Ref.update(context.root.sessions, (sessions) => {
    const previous = sessions.find((item) => item.session_id === session.session_id)
    if (!previous) return [...sessions, session]
    return sessions.map((item) =>
      item.session_id === session.session_id
        ? WorkflowSchema.SessionStage.make({
            ...previous,
            ...session,
            parent_session_id: session.parent_session_id ?? previous.parent_session_id,
            parent_run_id: session.parent_run_id ?? previous.parent_run_id,
            activity:
              session.status === "queued" || session.status === "running"
                ? (session.activity ?? previous.activity)
                : undefined,
            node_depth: session.node_depth ?? previous.node_depth,
            node_id: session.node_id ?? previous.node_id,
            parent_node_id: session.parent_node_id ?? previous.parent_node_id,
            capability: session.capability ?? previous.capability,
            depends_on: session.depends_on ?? previous.depends_on,
            issue: session.issue ?? previous.issue,
            round: session.round ?? previous.round,
            report_path: session.report_path ?? previous.report_path,
            prompt_bytes: session.prompt_bytes ?? previous.prompt_bytes,
            active_at: session.active_at ?? previous.active_at,
            queue_ms: session.queue_ms ?? previous.queue_ms,
            waiting_ms: session.waiting_ms ?? previous.waiting_ms,
            active_ms: session.active_ms ?? previous.active_ms,
            recovery_attempts: session.recovery_attempts ?? previous.recovery_attempts,
            usage: session.usage ?? previous.usage,
            sources: session.sources ?? previous.sources,
            error: session.status === "completed" ? undefined : (session.error ?? previous.error),
          })
        : item,
    )
  })
}

export function sessions(context: Context) {
  return Effect.gen(function* () {
    const invocations = yield* Ref.get(context.root.invocations)
    const collect = (parentID: string): ReadonlyArray<string> =>
      invocations
        .filter((invocation) => invocation.parentID === parentID)
        .flatMap((invocation) => [invocation.id, ...collect(invocation.id)])
    const ids = new Set([context.id, ...collect(context.id)])
    return (yield* Ref.get(context.root.sessions)).filter((session) => ids.has(session.run_id))
  })
}

export function progress(context: Context, input: Progress) {
  return context.root.onProgress?.(input) ?? Effect.void
}

export function claimCouncil(
  context: Context,
  input: {
    readonly objective: string
    readonly issueKey?: string
    readonly artifactPaths?: ReadonlyArray<string>
  },
) {
  return Effect.gen(function* () {
    const result = yield* Deferred.make<WorkflowSchema.CouncilOutput, Tool.Failure>()
    const invocations = yield* Ref.get(context.root.invocations)
    const artifactPaths = Array.from(new Set(input.artifactPaths ?? [])).sort()
    const key = councilKey(input.issueKey ?? input.objective)
    const candidate = { key, objective: input.objective, artifactPaths, result } satisfies CouncilClaim
    const coordination = yield* Ref.modify(
      context.root.councils,
      (claims): readonly [CouncilCoordination | "ancestor_duplicate" | undefined, ReadonlyArray<CouncilClaim>] => {
        const ancestor = claims.find(
          (claim) =>
            isAncestor(claim.ownerRunID, context.id, invocations) &&
            (claim.key === key || similarity(claim.objective, input.objective) >= 0.7),
        )
        if (ancestor) return ["ancestor_duplicate", claims]
        if (context.root.debateDeduplication === "off") {
          if (claims.length >= context.root.maxCouncils) return [undefined, claims]
          return [{ owner: true as const, claim: candidate }, [...claims, candidate]]
        }
        const existing = claims.find(
          (claim) =>
            !isAncestor(claim.ownerRunID, context.id, invocations) &&
            compatibleArtifacts(claim.artifactPaths, artifactPaths, context.root.debateDeduplication) &&
            (claim.key === key ||
              (context.root.debateDeduplication === "semantic" && similarity(claim.objective, input.objective) >= 0.7)),
        )
        if (existing) return [{ owner: false as const, claim: existing }, claims]
        if (claims.length >= context.root.maxCouncils) return [undefined, claims]
        return [{ owner: true as const, claim: candidate }, [...claims, candidate]]
      },
    )
    if (coordination === "ancestor_duplicate")
      return yield* new Tool.Failure({
        message:
          "Nested Council must address a materially narrower dispute than an equivalent ancestor deliberation over the same evidence.",
      })
    if (coordination) return coordination
    return yield* new Tool.Failure({
      message: `Council budget exhausted after ${context.root.maxCouncils} distinct invocations`,
    })
  })
}

export function bindCouncil(context: Context, claim: CouncilClaim, runID: string) {
  return Ref.update(context.root.councils, (claims) =>
    claims.map((item) => (item.result === claim.result ? { ...item, ownerRunID: runID } : item)),
  )
}

export function completeCouncil(claim: CouncilClaim, output: WorkflowSchema.CouncilOutput) {
  return Deferred.succeed(claim.result, output).pipe(Effect.asVoid)
}

export function failCouncil(context: Context, claim: CouncilClaim, error: Tool.Failure) {
  return Effect.gen(function* () {
    yield* Ref.update(context.root.councils, (claims) => claims.filter((item) => item.result !== claim.result))
    yield* Deferred.fail(claim.result, error)
  }).pipe(Effect.asVoid)
}

export function awaitCouncil(context: Context, claim: CouncilClaim) {
  return withReleasedWorker(context, Deferred.await(claim.result))
}

export function activeElapsed(context: Context, started: number, now = Date.now()) {
  const waiting = context.wait.elapsed + (context.wait.started === undefined ? 0 : now - context.wait.started)
  return Math.max(0, now - started - waiting)
}

export function timing(context: Context, completedAt = Date.now()) {
  return WorkflowSchema.RunTiming.make({
    started_at: context.startedAt,
    completed_at: completedAt,
    elapsed_ms: Math.max(0, completedAt - context.startedAt),
  })
}

function reportName(workflow: Kind) {
  if (workflow === "heavy") return "HEAVY_REPORT.md"
  if (workflow === "council") return "COUNCIL_REPORT.md"
  return "RESEARCH_REPORT.md"
}

function sameObjective(parent: string, child: string) {
  const words = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    )
  const parentWords = words(parent)
  const childWords = words(child)
  if (parentWords.size === 0) return childWords.size === 0
  const shared = Array.from(parentWords).filter((word) => childWords.has(word)).length
  return shared / parentWords.size >= 0.9 && childWords.size <= parentWords.size + 3
}

function councilKey(value: string) {
  return words(value).sort().join(" ")
}

function words(value: string) {
  const ignored = new Set([
    "a",
    "an",
    "and",
    "are",
    "be",
    "for",
    "in",
    "is",
    "of",
    "on",
    "or",
    "should",
    "the",
    "to",
    "with",
  ])
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word && !ignored.has(word))
        .map((word) => (word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word)),
    ),
  )
}

function similarity(left: string, right: string) {
  const leftWords = new Set(words(left))
  const rightWords = new Set(words(right))
  if (leftWords.size === 0 || rightWords.size === 0) return 0
  const shared = Array.from(leftWords).filter((word) => rightWords.has(word)).length
  return shared / (leftWords.size + rightWords.size - shared)
}

function sameArtifacts(left: ReadonlyArray<string>, right: ReadonlyArray<string>) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function compatibleArtifacts(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
  mode: Root["debateDeduplication"],
) {
  if (sameArtifacts(left, right)) return true
  if (mode !== "semantic") return false
  if (left.length === 0 || right.length === 0) return true
  const shared = left.filter((value) => right.includes(value)).length
  return shared / Math.min(left.length, right.length) >= 0.5
}

function isAncestor(ancestorID: string | undefined, invocationID: string, invocations: ReadonlyArray<Invocation>) {
  if (!ancestorID) return false
  const visited = new Set<string>()
  const visit = (currentID: string): boolean => {
    if (currentID === ancestorID) return true
    if (visited.has(currentID)) return false
    visited.add(currentID)
    const parentID = invocations.find((invocation) => invocation.id === currentID)?.parentID
    return parentID ? visit(parentID) : false
  }
  return visit(invocationID)
}

function beginWait(wait: WaitTracker, now: number, resumeWorker: boolean) {
  if (wait.active === 0) wait.started = now
  wait.resumeWorker ||= resumeWorker
  wait.active++
}

function settle(context: Context, now: number) {
  if (context.settlement.done) return undefined
  context.settlement.done = true
  const parent = context.settlement.parent
  if (!parent) return undefined
  return endWait(parent.wait, now) ? parent : undefined
}

function endWait(wait: WaitTracker, now: number) {
  wait.active = Math.max(0, wait.active - 1)
  if (wait.active > 0 || wait.started === undefined) return false
  wait.elapsed += Math.max(0, now - wait.started)
  wait.started = undefined
  const resumeWorker = wait.resumeWorker
  wait.resumeWorker = false
  return resumeWorker
}

function withReleasedWorker<A, E, R>(context: Context, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      beginWait(context.wait, DateTime.toEpochMillis(yield* DateTime.now), yield* releaseWorker(context))
      yield* recordActivity(context, "waiting_on_delegation")
    }),
    () => effect,
    () =>
      Effect.gen(function* () {
        if (endWait(context.wait, DateTime.toEpochMillis(yield* DateTime.now))) yield* acquireWorker(context)
        yield* recordActivity(context, "provider_active")
      }),
  )
}

function recordActivity(context: Context, activity: NonNullable<WorkflowSchema.SessionStage["activity"]>) {
  if (!context.sessionID) return Effect.void
  return Effect.gen(function* () {
    const updatedAt = DateTime.toEpochMillis(yield* DateTime.now)
    yield* Ref.update(context.root.sessions, (sessions) =>
      sessions.map((session) =>
        session.session_id === context.sessionID
          ? WorkflowSchema.SessionStage.make({
              ...session,
              activity,
              updated_at: updatedAt,
              elapsed_ms: Math.max(0, updatedAt - session.started_at),
              waiting_ms:
                context.wait.elapsed +
                (context.wait.started === undefined ? 0 : Math.max(0, updatedAt - context.wait.started)),
            })
          : session,
      ),
    )
    yield* progress(context, {
      structured: {
        workflow: context.workflow,
        child_status: "running",
        child_activity: activity,
        session_id: context.sessionID,
        run_id: context.id,
        workflow_depth: context.depth,
        updated_at: updatedAt,
      },
      text:
        activity === "waiting_on_delegation"
          ? "Workflow child is waiting on delegated work"
          : "Workflow child resumed provider execution",
    })
  })
}

function acquireWorker(context: Context) {
  return Effect.gen(function* () {
    if (context.worker.held) return
    yield* context.root.workers.take(1)
    context.worker.held = true
  })
}

function releaseWorker(context: Context) {
  return Effect.gen(function* () {
    if (!context.worker.held) return false
    context.worker.held = false
    yield* context.root.workers.release(1)
    return true
  })
}
