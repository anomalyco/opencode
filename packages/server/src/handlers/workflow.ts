import { Location } from "@opencode-ai/core/location"
import { Workflow } from "@opencode-ai/core/workflow"
import { WorkflowCoordinator } from "@opencode-ai/core/workflow/coordinator"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { WorkflowError } from "@opencode-ai/protocol/groups/workflow"

export const WorkflowHandler = HttpApiBuilder.group(Api, "server.workflow", (handlers) =>
  Effect.gen(function* () {
    const workflows = yield* Workflow.Service
    const coordinator = yield* WorkflowCoordinator.Service

    const currentProject = Effect.fnUntraced(function* () {
      const location = yield* Location.Service
      return {
        id: location.project.id,
        directory: location.project.directory,
      }
    })

    return handlers
      .handle(
        "workflow.preferences.get",
        Effect.fn(function* () {
          return { data: yield* workflows.preferences.get(yield* currentProject()) }
        }),
      )
      .handle(
        "workflow.preferences.update",
        Effect.fn(function* (ctx) {
          return { data: yield* workflows.preferences.update(yield* currentProject(), ctx.payload) }
        }),
      )
      .handle(
        "workflow.create",
        Effect.fn(function* (ctx) {
          const location = yield* Location.Service
          const created = yield* workflows
            .create(yield* currentProject(), ctx.payload)
            .pipe(Effect.mapError(toWorkflowError))
          yield* coordinator.start({
            workflowID: created.id,
            location: Location.Ref.make({ directory: location.directory, workspaceID: location.workspaceID }),
          })
          return { data: created }
        }),
      )
      .handle(
        "workflow.list",
        Effect.fn(function* () {
          return { data: yield* workflows.list(yield* currentProject()) }
        }),
      )
      .handle(
        "workflow.get",
        Effect.fn(function* (ctx) {
          return { data: yield* workflows.get(ctx.params.workflowID).pipe(Effect.mapError(toWorkflowError)) }
        }),
      )
      .handle(
        "workflow.pause",
        Effect.fn(function* (ctx) {
          return { data: yield* workflows.pause(ctx.params.workflowID).pipe(Effect.mapError(toWorkflowError)) }
        }),
      )
      .handle(
        "workflow.resume",
        Effect.fn(function* (ctx) {
          return { data: yield* workflows.resume(ctx.params.workflowID).pipe(Effect.mapError(toWorkflowError)) }
        }),
      )
      .handle(
        "workflow.cancel",
        Effect.fn(function* (ctx) {
          return { data: yield* workflows.cancel(ctx.params.workflowID).pipe(Effect.mapError(toWorkflowError)) }
        }),
      )
  }),
)

function toWorkflowError(error: Workflow.Error) {
  if (error instanceof Workflow.MissingRoleSelectionError) {
    return new WorkflowError({
      name: "WorkflowError",
      data: {
        message: `Missing ${error.role} role selection`,
        role: error.role,
      },
    })
  }
  if (error instanceof Workflow.InvalidStateTransitionError) {
    return new WorkflowError({
      name: "WorkflowError",
      data: {
        message: error.reason,
        workflowID: error.workflowID,
        taskID: error.taskID,
        from: error.from,
        to: error.to,
        reason: error.reason,
      },
    })
  }
  if (error instanceof Workflow.TaskNotFoundError) {
    return new WorkflowError({
      name: "WorkflowError",
      data: {
        message: `Workflow task not found: ${error.taskID}`,
        workflowID: error.workflowID,
        taskID: error.taskID,
      },
    })
  }
  if (error instanceof Workflow.DuplicateTaskError) {
    return new WorkflowError({
      name: "WorkflowError",
      data: {
        message: `Duplicate workflow task: ${error.taskID}`,
        workflowID: error.workflowID,
        taskID: error.taskID,
      },
    })
  }
  if (error instanceof Workflow.InvalidTaskDependencyError) {
    return new WorkflowError({
      name: "WorkflowError",
      data: {
        message: `Workflow task ${error.taskID} depends on unknown task: ${error.dependency}`,
        workflowID: error.workflowID,
        taskID: error.taskID,
        dependency: error.dependency,
      },
    })
  }
  return new WorkflowError({
    name: "WorkflowError",
    data: {
      message: `Workflow not found: ${error.workflowID}`,
      workflowID: error.workflowID,
    },
  })
}
