export * as Workflow from "./workflow"

import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { desc, eq } from "drizzle-orm"
import { Workflow as WorkflowSchema } from "@opencode-ai/schema/workflow"
import { AbsolutePath, type DeepMutable } from "./schema"
import { Database } from "./database/database"
import { makeGlobalNode } from "./effect/app-node"
import { ProjectV2 } from "./project"
import { ProjectTable } from "./project/sql"
import { WorkflowPreferenceTable, WorkflowTable } from "./workflow/sql"

export const ID = WorkflowSchema.ID
export type ID = WorkflowSchema.ID

export const Preferences = WorkflowSchema.Preferences
export type Preferences = DeepMutable<WorkflowSchema.Preferences>

export const PreferencesInput = WorkflowSchema.PreferencesInput
export type PreferencesInput = DeepMutable<WorkflowSchema.PreferencesInput>

export const CreateInput = WorkflowSchema.CreateInput
export type CreateInput = DeepMutable<WorkflowSchema.CreateInput>

export const SetTasksInput = WorkflowSchema.SetTasksInput
export type SetTasksInput = DeepMutable<WorkflowSchema.SetTasksInput>

export const AppendSessionInput = WorkflowSchema.AppendSessionInput
export type AppendSessionInput = DeepMutable<WorkflowSchema.AppendSessionInput>

export const TransitionTaskInput = WorkflowSchema.TransitionTaskInput
export type TransitionTaskInput = DeepMutable<WorkflowSchema.TransitionTaskInput>

export const RecordAttemptInput = WorkflowSchema.RecordAttemptInput
export type RecordAttemptInput = DeepMutable<WorkflowSchema.RecordAttemptInput>

export const Info = WorkflowSchema.Info
export type Info = DeepMutable<WorkflowSchema.Info>

type Task = DeepMutable<WorkflowSchema.Task>
type PlannedTask = DeepMutable<WorkflowSchema.PlannedTask>

type ProjectRef = {
  readonly id: ProjectV2.ID
  readonly directory: AbsolutePath
}

export class MissingRoleSelectionError extends Schema.TaggedErrorClass<MissingRoleSelectionError>()(
  "Workflow.MissingRoleSelectionError",
  {
    role: Schema.Literals(["architect", "coder"]),
  },
) {}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Workflow.NotFoundError", {
  workflowID: ID,
}) {}

export class TaskNotFoundError extends Schema.TaggedErrorClass<TaskNotFoundError>()("Workflow.TaskNotFoundError", {
  workflowID: ID,
  taskID: Schema.String,
}) {}

export class DuplicateTaskError extends Schema.TaggedErrorClass<DuplicateTaskError>()("Workflow.DuplicateTaskError", {
  workflowID: ID,
  taskID: Schema.String,
}) {}

export class InvalidTaskDependencyError extends Schema.TaggedErrorClass<InvalidTaskDependencyError>()(
  "Workflow.InvalidTaskDependencyError",
  {
    workflowID: ID,
    taskID: Schema.String,
    dependency: Schema.String,
  },
) {}

export class InvalidStateTransitionError extends Schema.TaggedErrorClass<InvalidStateTransitionError>()(
  "Workflow.InvalidStateTransitionError",
  {
    workflowID: ID,
    taskID: Schema.String.pipe(Schema.optional),
    from: Schema.String,
    to: Schema.String,
    reason: Schema.String,
  },
) {}

export type Error =
  | MissingRoleSelectionError
  | NotFoundError
  | TaskNotFoundError
  | DuplicateTaskError
  | InvalidTaskDependencyError
  | InvalidStateTransitionError

export interface Interface {
  readonly preferences: {
    readonly get: (project: ProjectRef) => Effect.Effect<Preferences>
    readonly update: (project: ProjectRef, input: PreferencesInput) => Effect.Effect<Preferences>
  }
  readonly create: (project: ProjectRef, input: CreateInput) => Effect.Effect<Info, MissingRoleSelectionError>
  readonly list: (project: ProjectRef) => Effect.Effect<Info[]>
  readonly get: (workflowID: ID) => Effect.Effect<Info, NotFoundError>
  readonly setTasks: (workflowID: ID, input: SetTasksInput) => Effect.Effect<Info, Error>
  readonly appendSession: (workflowID: ID, input: AppendSessionInput) => Effect.Effect<Info, NotFoundError>
  readonly transitionStatus: (workflowID: ID, status: WorkflowSchema.Status) => Effect.Effect<Info, Error>
  readonly transitionTask: (workflowID: ID, input: TransitionTaskInput) => Effect.Effect<Info, Error>
  readonly recordAttempt: (workflowID: ID, input: RecordAttemptInput) => Effect.Effect<Info, Error>
  readonly pause: (workflowID: ID) => Effect.Effect<Info, NotFoundError | InvalidStateTransitionError>
  readonly resume: (workflowID: ID) => Effect.Effect<Info, NotFoundError | InvalidStateTransitionError>
  readonly cancel: (workflowID: ID) => Effect.Effect<Info, NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Workflow") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db

    const ensureProject = Effect.fnUntraced(function* (project: ProjectRef) {
      yield* db
        .insert(ProjectTable)
        .values({ id: project.id, worktree: project.directory, sandboxes: [] })
        .onConflictDoNothing()
        .run()
        .pipe(Effect.orDie)
    })

    function date(millis: number) {
      return DateTime.makeUnsafe(millis)
    }

    function preferencesFromRow(row: typeof WorkflowPreferenceTable.$inferSelect): Preferences {
      return {
        projectID: row.project_id,
        architect: row.architect ?? undefined,
        coder: row.coder ?? undefined,
        concurrency: row.concurrency ?? undefined,
        time: {
          updated: date(row.time_updated),
        },
      }
    }

    function workflowFromRow(row: typeof WorkflowTable.$inferSelect): Info {
      return {
        id: row.id,
        projectID: row.project_id,
        story: row.story,
        status: row.status,
        architect: row.architect,
        coder: row.coder,
        concurrency: row.concurrency,
        tasks: row.tasks,
        attempts: row.attempts,
        sessions: row.sessions,
        branch: row.branch ?? undefined,
        time: {
          created: date(row.time_created),
          updated: date(row.time_updated),
        },
      }
    }

    const getPreferences = Effect.fn("Workflow.preferences.get")(function* (project: ProjectRef) {
      yield* ensureProject(project)
      const row = yield* db
        .select()
        .from(WorkflowPreferenceTable)
        .where(eq(WorkflowPreferenceTable.project_id, project.id))
        .get()
        .pipe(Effect.orDie)
      if (row) return preferencesFromRow(row)
      return {
        projectID: project.id,
        architect: undefined,
        coder: undefined,
        concurrency: undefined,
        time: {
          updated: date(Date.now()),
        },
      }
    })

    const updatePreferences = Effect.fn("Workflow.preferences.update")(function* (
      project: ProjectRef,
      input: PreferencesInput,
    ) {
      yield* ensureProject(project)
      const now = Date.now()
      yield* db
        .insert(WorkflowPreferenceTable)
        .values({
          project_id: project.id,
          architect: input.architect,
          coder: input.coder,
          concurrency: input.concurrency,
          time_created: now,
          time_updated: now,
        })
        .onConflictDoUpdate({
          target: WorkflowPreferenceTable.project_id,
          set: {
            architect: input.architect,
            coder: input.coder,
            concurrency: input.concurrency,
            time_updated: now,
          },
        })
        .run()
        .pipe(Effect.orDie)
      return yield* getPreferences(project)
    })

    const get = Effect.fn("Workflow.get")(function* (workflowID: ID) {
      const row = yield* db.select().from(WorkflowTable).where(eq(WorkflowTable.id, workflowID)).get().pipe(Effect.orDie)
      if (!row) return yield* new NotFoundError({ workflowID })
      return workflowFromRow(row)
    })

    const create = Effect.fn("Workflow.create")(function* (project: ProjectRef, input: CreateInput) {
      yield* ensureProject(project)
      const preferences = yield* getPreferences(project)
      const architect = input.architect ?? preferences.architect
      if (!architect) return yield* new MissingRoleSelectionError({ role: "architect" })
      const coder = input.coder ?? preferences.coder
      if (!coder) return yield* new MissingRoleSelectionError({ role: "coder" })
      const now = Date.now()
      const workflowID = ID.create()
      yield* db
        .insert(WorkflowTable)
        .values({
          id: workflowID,
          project_id: project.id,
          story: input.story,
          status: "planning",
          architect,
          coder,
          concurrency: input.concurrency ?? preferences.concurrency ?? 2,
          tasks: [],
          attempts: [],
          sessions: { architect: [], coder: [] },
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)
      return yield* get(workflowID).pipe(Effect.orDie)
    })

    const list = Effect.fn("Workflow.list")(function* (project: ProjectRef) {
      yield* ensureProject(project)
      const rows = yield* db
        .select()
        .from(WorkflowTable)
        .where(eq(WorkflowTable.project_id, project.id))
        .orderBy(desc(WorkflowTable.time_created))
        .all()
        .pipe(Effect.orDie)
      return rows.map(workflowFromRow)
    })

    const updateWorkflow = Effect.fnUntraced(function* (workflow: Info) {
      yield* db
        .update(WorkflowTable)
        .set({
          status: workflow.status,
          tasks: workflow.tasks,
          attempts: workflow.attempts,
          sessions: workflow.sessions,
          branch: workflow.branch ?? null,
          time_updated: Date.now(),
        })
        .where(eq(WorkflowTable.id, workflow.id))
        .run()
        .pipe(Effect.orDie)
      return yield* get(workflow.id)
    })

    function canTransitionTask(from: WorkflowSchema.TaskStatus, to: WorkflowSchema.TaskStatus) {
      if (to === "cancelled") return from !== "integrated"
      const allowed: Record<WorkflowSchema.TaskStatus, WorkflowSchema.TaskStatus[]> = {
        blocked: ["ready", "failed"],
        ready: ["coding", "blocked", "failed"],
        coding: ["audit_pending", "remediation_ready", "needs_human", "failed"],
        audit_pending: ["approved", "remediation_ready", "needs_human", "failed"],
        remediation_ready: ["coding", "needs_human", "failed"],
        approved: ["integrating", "failed"],
        integrating: ["integrated", "failed"],
        integrated: [],
        needs_human: ["remediation_ready", "failed"],
        failed: [],
        cancelled: [],
      }
      return allowed[from].includes(to)
    }

    function canTransitionWorkflow(from: WorkflowSchema.Status, to: WorkflowSchema.Status) {
      if (to === "cancelled") return !["completed", "failed", "cancelled"].includes(from)
      const allowed: Record<WorkflowSchema.Status, WorkflowSchema.Status[]> = {
        planning: ["running", "paused", "needs_human", "failed"],
        running: ["paused", "final_audit", "needs_human", "failed", "completed"],
        final_audit: ["paused", "needs_human", "failed", "completed"],
        paused: ["running", "failed"],
        needs_human: ["running", "failed"],
        completed: [],
        failed: [],
        cancelled: [],
      }
      return allowed[from].includes(to)
    }

    function transitionWorkflow(workflow: Info, status: WorkflowSchema.Status) {
      if (canTransitionWorkflow(workflow.status, status)) return { ...workflow, status }
      return new InvalidStateTransitionError({
        workflowID: workflow.id,
        from: workflow.status,
        to: status,
        reason: "Workflow status transition is not allowed",
      })
    }

    function refreshBlockedTasks(tasks: Task[]) {
      const integrated = new Set(tasks.filter((task) => task.status === "integrated").map((task) => task.id))
      return tasks.map((task) => {
        if (task.status !== "blocked") return task
        if (!task.dependencies.every((dependency) => integrated.has(dependency))) return task
        return { ...task, status: "ready" as const }
      })
    }

    const setTasks = Effect.fn("Workflow.setTasks")(function* (workflowID: ID, input: SetTasksInput) {
      const workflow = yield* get(workflowID)
      if (workflow.status !== "planning")
        return yield* new InvalidStateTransitionError({
          workflowID,
          from: workflow.status,
          to: "running",
          reason: "Tasks can only be set while the workflow is planning",
        })
      const duplicate = input.tasks.find((task, index) => input.tasks.findIndex((item) => item.id === task.id) !== index)
      if (duplicate) return yield* new DuplicateTaskError({ workflowID, taskID: duplicate.id })
      const ids = new Set(input.tasks.map((task) => task.id))
      const invalid = input.tasks
        .map((task) => ({ task, dependency: task.dependencies.find((dependency) => !ids.has(dependency)) }))
        .find((item): item is { task: PlannedTask; dependency: string } => item.dependency !== undefined)
      if (invalid)
        return yield* new InvalidTaskDependencyError({
          workflowID,
          taskID: invalid.task.id,
          dependency: invalid.dependency,
        })
      return yield* updateWorkflow({
        ...workflow,
        status: "running",
        tasks: input.tasks.map((task) => ({
          ...task,
          status: task.dependencies.length ? "blocked" : "ready",
          attempts: 0,
        })),
      })
    })

    const appendSession = Effect.fn("Workflow.appendSession")(function* (workflowID: ID, input: AppendSessionInput) {
      const workflow = yield* get(workflowID)
      const sessions = workflow.sessions[input.role].includes(input.sessionID)
        ? workflow.sessions
        : {
            ...workflow.sessions,
            [input.role]: [...workflow.sessions[input.role], input.sessionID],
          }
      return yield* updateWorkflow({ ...workflow, sessions })
    })

    const transitionTask = Effect.fn("Workflow.transitionTask")(function* (workflowID: ID, input: TransitionTaskInput) {
      const workflow = yield* get(workflowID)
      const task = workflow.tasks.find((item) => item.id === input.taskID)
      if (!task) return yield* new TaskNotFoundError({ workflowID, taskID: input.taskID })
      if (!canTransitionTask(task.status, input.status))
        return yield* new InvalidStateTransitionError({
          workflowID,
          taskID: task.id,
          from: task.status,
          to: input.status,
          reason: "Task status transition is not allowed",
        })
      const tasks = refreshBlockedTasks(
        workflow.tasks.map((item) => (item.id === task.id ? { ...item, status: input.status } : item)),
      )
      const status =
        tasks.length > 0 && tasks.every((item) => item.status === "integrated") ? "final_audit" : workflow.status
      return yield* updateWorkflow({ ...workflow, status, tasks })
    })

    const recordAttempt = Effect.fn("Workflow.recordAttempt")(function* (workflowID: ID, input: RecordAttemptInput) {
      const workflow = yield* get(workflowID)
      const task = workflow.tasks.find((item) => item.id === input.taskID)
      if (!task) return yield* new TaskNotFoundError({ workflowID, taskID: input.taskID })
      const attempts = input.status === "submitted" ? task.attempts : task.attempts + 1
      const attemptID = input.status === "submitted" ? task.attempts + 1 : attempts
      const exhausted = ["rejected", "failed"].includes(input.status) && attempts > 3
      const nextTaskStatus =
        input.status === "approved"
          ? "approved"
          : input.status === "submitted"
            ? "audit_pending"
            : exhausted
              ? "needs_human"
              : "remediation_ready"
      if (!canTransitionTask(task.status, nextTaskStatus))
        return yield* new InvalidStateTransitionError({
          workflowID,
          taskID: task.id,
          from: task.status,
          to: nextTaskStatus,
          reason: "Attempt result cannot be applied from the current task status",
        })
      return yield* updateWorkflow({
        ...workflow,
        status: exhausted ? "needs_human" : workflow.status,
        tasks: workflow.tasks.map((item) =>
          item.id === task.id ? { ...item, attempts, status: nextTaskStatus } : item,
        ),
        attempts: [
          ...workflow.attempts,
          {
            id: `${task.id}:${attemptID}:${input.status}`,
            taskID: task.id,
            status: input.status,
            sessionID: input.sessionID,
            summary: input.summary,
            feedback: input.feedback,
            findings: input.findings ?? [],
            time: {
              created: date(Date.now()),
            },
          },
        ],
      })
    })

    return Service.of({
      preferences: {
        get: getPreferences,
        update: updatePreferences,
      },
      create,
      list,
      get,
      setTasks,
      appendSession,
      transitionStatus: Effect.fn("Workflow.transitionStatus")(function* (workflowID, status) {
        const workflow = yield* get(workflowID)
        const result = transitionWorkflow(workflow, status)
        if (result instanceof InvalidStateTransitionError) return yield* result
        return yield* updateWorkflow(result)
      }),
      transitionTask,
      recordAttempt,
      pause: Effect.fn("Workflow.pause")(function* (workflowID) {
        const workflow = yield* get(workflowID)
        const result = transitionWorkflow(workflow, "paused")
        if (result instanceof InvalidStateTransitionError) return yield* result
        return yield* updateWorkflow(result)
      }),
      resume: Effect.fn("Workflow.resume")(function* (workflowID) {
        const workflow = yield* get(workflowID)
        const result = transitionWorkflow(workflow, "running")
        if (result instanceof InvalidStateTransitionError) return yield* result
        return yield* updateWorkflow(result)
      }),
      cancel: Effect.fn("Workflow.cancel")(function* (workflowID) {
        const workflow = yield* get(workflowID)
        const result = transitionWorkflow(workflow, "cancelled")
        if (result instanceof InvalidStateTransitionError) return workflow
        return yield* updateWorkflow({
          ...result,
          tasks: result.tasks.map((task) => (task.status === "integrated" ? task : { ...task, status: "cancelled" })),
        })
      }),
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer,
  deps: [Database.node],
})
