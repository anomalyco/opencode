import type {
  Assignment,
  ErrorCode,
  Evidence,
  ExecutionError,
  Gate,
  OperationType,
  Outcome,
  ReportCommand,
  ReportOperation,
  RunEvent,
  RunSnapshot,
  Task,
  TaskDefinition,
  TaskState,
} from "./schema"

export type ReportContext = {
  rootSessionID: string
  ownerDirectory: string
  now: number
}

type StartOperation = Extract<ReportOperation, { type: "run.start" }>
type TaskStateOperation = Extract<ReportOperation, { type: "task.state" }>
type AssignmentAddOperation = Extract<ReportOperation, { type: "assignment.add" }>
type AssignmentEndOperation = Extract<ReportOperation, { type: "assignment.end" }>
type EvidenceAddOperation = Extract<ReportOperation, { type: "evidence.add" }>
type VerifyOperation = Extract<ReportOperation, { type: "task.verify" }>
type ReopenOperation = Extract<ReportOperation, { type: "task.reopen" }>
type ReviseOperation = Extract<ReportOperation, { type: "plan.revise" }>
type CancelOperation = Extract<ReportOperation, { type: "run.cancel" }>

export class DomainError extends Error {
  constructor(readonly error: ExecutionError) {
    super(error.detail)
    this.name = "DomainError"
  }
}

const transitions: Record<TaskState, readonly TaskState[]> = {
  pending: ["running", "blocked"],
  running: ["blocked", "awaiting_review", "failed"],
  blocked: ["running"],
  awaiting_review: ["running", "failed"],
  verified: [],
  failed: [],
  skipped: [],
}

export function applyReport(
  current: RunSnapshot | undefined,
  command: ReportCommand,
  context: ReportContext,
): RunSnapshot {
  const operation = command.operation
  if (operation.type === "run.start") return startRun(current, command, operation, context)

  if (current === undefined || current.runID !== command.runID) {
    throw domainError("not_found", `run not found: ${command.runID}`)
  }
  if (current.status !== "active") {
    throw domainError("invalid_transition", `run ${current.runID} is ${current.status}`)
  }
  if (current.revision !== command.expectedRevision) {
    throw domainError(
      "revision_conflict",
      `expected revision ${command.expectedRevision} but current revision is ${current.revision}`,
      current.revision,
    )
  }

  switch (operation.type) {
    case "task.state":
      return applyTaskState(current, operation, context)
    case "assignment.add":
      return applyAssignmentAdd(current, operation, context)
    case "assignment.end":
      return applyAssignmentEnd(current, operation, context)
    case "evidence.add":
      return applyEvidenceAdd(current, operation, context)
    case "task.verify":
      return applyVerify(current, operation, context)
    case "task.reopen":
      return applyReopen(current, operation, context)
    case "plan.revise":
      return applyPlanRevise(current, operation, context)
    case "run.finish":
      return applyFinish(current, context)
    case "run.cancel":
      return applyCancel(current, operation, context)
  }
}

export function validateTaskGraph(tasks: readonly TaskDefinition[]): void {
  const ids = new Set<string>()
  for (const task of tasks) {
    if (ids.has(task.id)) throw domainError("invalid_input", `duplicate task id: ${task.id}`)
    ids.add(task.id)
  }
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.id) throw domainError("invalid_input", `task depends on itself: ${task.id}`)
      if (!ids.has(dependency)) {
        throw domainError("invalid_input", `missing dependency ${dependency} referenced by ${task.id}`)
      }
    }
  }

  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const task of tasks) {
    indegree.set(task.id, task.dependsOn.length)
    for (const dependency of task.dependsOn) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), task.id])
    }
  }
  const ready = tasks.filter((task) => indegree.get(task.id) === 0).map((task) => task.id)
  let visited = 0
  while (ready.length > 0) {
    const id = ready.pop()
    if (id === undefined) continue
    visited += 1
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1
      indegree.set(dependent, remaining)
      if (remaining === 0) ready.push(dependent)
    }
  }
  if (visited !== tasks.length) throw domainError("invalid_input", "task graph contains a cycle")
}

function startRun(
  current: RunSnapshot | undefined,
  command: ReportCommand,
  operation: StartOperation,
  context: ReportContext,
): RunSnapshot {
  if (current !== undefined) throw domainError("operation_conflict", `run already exists: ${command.runID}`)
  if (command.expectedRevision !== 0) {
    throw domainError("revision_conflict", "run creation requires expected revision 0", 0)
  }
  validateTaskGraph(operation.tasks)
  return {
    schemaVersion: 1,
    runID: command.runID,
    rootSessionID: context.rootSessionID,
    title: operation.title,
    ownerDirectory: context.ownerDirectory,
    plan: { ...operation.plan, revision: 1 },
    revision: 1,
    status: "active",
    createdAt: context.now,
    updatedAt: context.now,
    tasks: operation.tasks.map(taskFromDefinition),
    assignments: [],
    evidence: [],
    events: [{ revision: 1, type: "run.start", summary: `${operation.title} started`, createdAt: context.now }],
  }
}

function applyTaskState(current: RunSnapshot, operation: TaskStateOperation, context: ReportContext): RunSnapshot {
  const task = requireTask(current, operation.taskID)
  requireAttempt(task, operation.attempt)
  if (!transitions[task.state].includes(operation.state)) {
    throw domainError("invalid_transition", `cannot move ${task.id} from ${task.state} to ${operation.state}`)
  }
  if (operation.state === "running") requireDependenciesVerified(current, task)
  const tasks = replaceTask(current.tasks, taskWithState(task, operation.state, operation.reason))
  return commit({ ...current, tasks }, "task.state", operation.reason ?? `${task.id} ${operation.state}`, context, task.id)
}

function applyAssignmentAdd(
  current: RunSnapshot,
  operation: AssignmentAddOperation,
  context: ReportContext,
): RunSnapshot {
  const task = requireTask(current, operation.taskID)
  requireAttempt(task, operation.attempt)
  if (current.assignments.some((assignment) => assignment.id === operation.id)) {
    throw domainError("operation_conflict", `assignment already exists: ${operation.id}`)
  }
  const assignment: Assignment = {
    id: operation.id,
    taskID: operation.taskID,
    attempt: operation.attempt,
    sessionID: operation.sessionID,
    role: operation.role,
    createdAt: context.now,
  }
  return commit(
    { ...current, assignments: [...current.assignments, assignment] },
    "assignment.add",
    `${operation.role} assigned to ${task.id}`,
    context,
    task.id,
  )
}

function applyAssignmentEnd(
  current: RunSnapshot,
  operation: AssignmentEndOperation,
  context: ReportContext,
): RunSnapshot {
  const assignment = current.assignments.find((candidate) => candidate.id === operation.assignmentID)
  if (assignment === undefined) throw domainError("not_found", `assignment not found: ${operation.assignmentID}`)
  if (assignment.endedAt !== undefined) {
    throw domainError("operation_conflict", `assignment already ended: ${assignment.id}`)
  }
  const assignments = current.assignments.map((candidate) =>
    candidate.id === assignment.id ? { ...candidate, endedAt: context.now } : candidate,
  )
  return commit(
    { ...current, assignments },
    "assignment.end",
    `${assignment.taskID} assignment ended`,
    context,
    assignment.taskID,
  )
}

function applyEvidenceAdd(
  current: RunSnapshot,
  operation: EvidenceAddOperation,
  context: ReportContext,
): RunSnapshot {
  const task = requireTask(current, operation.taskID)
  requireAttempt(task, operation.attempt)
  if (current.evidence.some((record) => record.id === operation.id)) {
    throw domainError("operation_conflict", `evidence already exists: ${operation.id}`)
  }
  const evidence: Evidence = {
    id: operation.id,
    taskID: operation.taskID,
    attempt: operation.attempt,
    gate: operation.gate,
    outcome: operation.outcome,
    summary: operation.summary,
    sessionID: operation.sessionID,
    messageID: operation.messageID,
    reportedBySessionID: context.rootSessionID,
    createdAt: context.now,
  }
  const record = operation.partID === undefined ? evidence : { ...evidence, partID: operation.partID }
  return commit(
    { ...current, evidence: [...current.evidence, record] },
    "evidence.add",
    `${operation.gate} ${operation.outcome} for ${task.id}`,
    context,
    task.id,
  )
}

function applyVerify(current: RunSnapshot, operation: VerifyOperation, context: ReportContext): RunSnapshot {
  const task = requireTask(current, operation.taskID)
  requireAttempt(task, operation.attempt)
  if (task.state !== "running" && task.state !== "awaiting_review") {
    throw domainError("invalid_transition", `cannot verify ${task.id} from ${task.state}`)
  }
  requireDependenciesVerified(current, task)
  const missing = task.requiredGates.filter(
    (gate) => latestOutcome(current.evidence, task.id, task.attempt, gate) !== "passed",
  )
  if (missing.length > 0) {
    throw domainError("invalid_transition", `required gates not passed: ${missing.join(", ")}`)
  }
  const tasks = replaceTask(current.tasks, taskWithState(task, "verified", undefined))
  return commit({ ...current, tasks }, "task.verify", `${task.id} verified`, context, task.id)
}

function applyReopen(current: RunSnapshot, operation: ReopenOperation, context: ReportContext): RunSnapshot {
  const task = requireTask(current, operation.taskID)
  if (task.state === "skipped") {
    throw domainError("invalid_transition", `cannot reopen skipped task ${task.id}`)
  }
  const closure = invalidationClosure(current.tasks, new Set([task.id]))
  const tasks = current.tasks.map((candidate) =>
    closure.has(candidate.id)
      ? taskWithState({ ...candidate, attempt: candidate.attempt + 1 }, "pending", undefined)
      : candidate,
  )
  const assignments = closeAssignments(current.assignments, context.now, closure)
  return commit({ ...current, tasks, assignments }, "task.reopen", operation.reason, context, task.id)
}

function applyPlanRevise(current: RunSnapshot, operation: ReviseOperation, context: ReportContext): RunSnapshot {
  validateTaskGraph(operation.tasks)
  const definitions = new Map(operation.tasks.map((definition) => [definition.id, definition]))
  const existing = new Map(current.tasks.map((task) => [task.id, task]))
  if (current.tasks.some((task) => task.finalReview && task.state !== "skipped") && !operation.tasks.some((definition) => definition.finalReview)) {
    throw domainError("invalid_input", "plan revision must retain a final-review task")
  }
  const changed = new Set(
    operation.tasks
      .filter((definition) => {
        const previous = existing.get(definition.id)
        return previous === undefined || previous.state === "skipped" || contractChanged(previous, definition)
      })
      .map((definition) => definition.id),
  )
  const closure = reviseClosure(operation.tasks, changed)
  const tasks = operation.tasks.map((definition) => {
    const previous = existing.get(definition.id)
    if (previous === undefined) return taskFromDefinition(definition)
    const updated = applyDefinition(previous, definition)
    if (!closure.has(definition.id)) return updated
    return taskWithState({ ...updated, attempt: previous.attempt + 1 }, "pending", undefined)
  })
  const removed = current.tasks
    .filter((task) => !definitions.has(task.id))
    .map((task) => (task.state === "skipped" ? task : taskWithState(task, "skipped", operation.reason)))
  const invalidated = new Set([...closure, ...removed.map((task) => task.id)])
  const assignments = closeAssignments(current.assignments, context.now, invalidated)
  return commit(
    {
      ...current,
      plan: { ...operation.plan, revision: current.plan.revision + 1 },
      tasks: [...tasks, ...removed],
      assignments,
    },
    "plan.revise",
    operation.reason,
    context,
  )
}

function applyFinish(current: RunSnapshot, context: ReportContext): RunSnapshot {
  const included = current.tasks.filter((task) => task.state !== "skipped")
  if (included.length === 0) throw domainError("invalid_transition", "run has no included tasks")
  const unfinished = included.filter((task) => task.state !== "verified")
  if (unfinished.length > 0) {
    throw domainError("invalid_transition", `tasks not verified: ${unfinished.map((task) => task.id).join(", ")}`)
  }
  if (!included.some((task) => task.finalReview)) {
    throw domainError("invalid_transition", "run has no verified final-review task")
  }
  const assignments = closeAssignments(current.assignments, context.now)
  return commit({ ...current, status: "completed", assignments }, "run.finish", "run completed", context)
}

function applyCancel(current: RunSnapshot, operation: CancelOperation, context: ReportContext): RunSnapshot {
  const assignments = closeAssignments(current.assignments, context.now)
  return commit({ ...current, status: "cancelled", assignments }, "run.cancel", operation.reason, context)
}

function taskFromDefinition(definition: TaskDefinition): Task {
  return {
    ...definition,
    dependsOn: [...definition.dependsOn],
    requiredGates: [...definition.requiredGates],
    state: "pending",
    attempt: 1,
  }
}

function applyDefinition(task: Task, definition: TaskDefinition): Task {
  return {
    ...task,
    title: definition.title,
    phase: definition.phase,
    order: definition.order,
    dependsOn: [...definition.dependsOn],
    requiredGates: [...definition.requiredGates],
    finalReview: definition.finalReview,
  }
}

function contractChanged(previous: Task, definition: TaskDefinition): boolean {
  return (
    previous.finalReview !== definition.finalReview ||
    !sameValues(previous.requiredGates, definition.requiredGates) ||
    !sameValues(previous.dependsOn, definition.dependsOn)
  )
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function requireTask(current: RunSnapshot, taskID: string): Task {
  const task = current.tasks.find((candidate) => candidate.id === taskID)
  if (task === undefined) throw domainError("not_found", `task not found: ${taskID}`)
  return task
}

function requireAttempt(task: Task, attempt: number): void {
  if (task.attempt !== attempt) {
    throw domainError("stale_attempt", `task ${task.id} is on attempt ${task.attempt}, not ${attempt}`)
  }
}

function requireDependenciesVerified(current: RunSnapshot, task: Task): void {
  const states = new Map(current.tasks.map((candidate) => [candidate.id, candidate.state]))
  const blocking = task.dependsOn.filter((id) => {
    const state = states.get(id)
    return state !== undefined && state !== "verified" && state !== "skipped"
  })
  if (blocking.length > 0) {
    throw domainError("invalid_transition", `dependencies not verified: ${blocking.join(", ")}`)
  }
}

function latestOutcome(evidence: readonly Evidence[], taskID: string, attempt: number, gate: Gate): Outcome | undefined {
  return evidence.reduce<Evidence | undefined>(
    (latest, record) =>
      record.taskID === taskID && record.attempt === attempt && record.gate === gate ? record : latest,
    undefined,
  )?.outcome
}

function invalidationClosure(tasks: readonly Task[], roots: ReadonlySet<string>): Set<string> {
  const active = tasks.filter((task) => task.state !== "skipped")
  const closure = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const id = queue.pop()
    if (id === undefined || closure.has(id)) continue
    closure.add(id)
    for (const task of active) {
      if (!closure.has(task.id) && task.dependsOn.includes(id)) queue.push(task.id)
    }
  }
  return closure
}

function reviseClosure(definitions: readonly TaskDefinition[], roots: ReadonlySet<string>): Set<string> {
  const closure = new Set<string>()
  const queue = [...roots]
  while (queue.length > 0) {
    const id = queue.pop()
    if (id === undefined || closure.has(id)) continue
    closure.add(id)
    for (const definition of definitions) {
      if (!closure.has(definition.id) && definition.dependsOn.includes(id)) queue.push(definition.id)
    }
  }
  return closure
}

function replaceTask(tasks: readonly Task[], next: Task): Task[] {
  return tasks.map((task) => (task.id === next.id ? next : task))
}

function taskWithState(task: Task, state: TaskState, reason: string | undefined): Task {
  const next = { ...task, state }
  if (reason === undefined) delete next.reason
  else next.reason = reason
  return next
}

function closeAssignments(assignments: readonly Assignment[], now: number, taskIDs?: ReadonlySet<string>): Assignment[] {
  return assignments.map((assignment) =>
    assignment.endedAt === undefined && (taskIDs === undefined || taskIDs.has(assignment.taskID))
      ? { ...assignment, endedAt: now }
      : assignment,
  )
}

function commit(
  current: RunSnapshot,
  type: OperationType,
  summary: string,
  context: ReportContext,
  taskID?: string,
): RunSnapshot {
  const revision = current.revision + 1
  const event: RunEvent =
    taskID === undefined
      ? { revision, type, summary, createdAt: context.now }
      : { revision, type, summary, createdAt: context.now, taskID }
  return { ...current, revision, updatedAt: context.now, events: [...current.events, event] }
}

function domainError(code: ErrorCode, detail: string, currentRevision?: number): DomainError {
  return new DomainError(currentRevision === undefined ? { code, detail } : { code, detail, currentRevision })
}
