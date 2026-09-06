import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { LocationQuery, locationQueryOpenApi } from "./location"
import { TeamJulesNotFoundError } from "../errors"

const TaskID = Schema.String.pipe(Schema.brand("TeamJules.TaskID"))
const WorkerID = Schema.String.pipe(Schema.brand("TeamJules.WorkerID"))

const TaskType = Schema.Union([
  Schema.Literal("issue"),
  Schema.Literal("pr"),
  Schema.Literal("manual"),
])
const TaskStatus = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("queued"),
  Schema.Literal("running"),
  Schema.Literal("completed"),
  Schema.Literal("failed"),
  Schema.Literal("cancelled"),
])

const TaskResult = Schema.Struct({
  pr_url: Schema.optional(Schema.String),
  commit_sha: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
})

const TaskInfo = Schema.Struct({
  id: TaskID,
  type: TaskType,
  status: TaskStatus,
  repo: Schema.String,
  branch: Schema.String,
  prompt: Schema.String,
  result: Schema.optional(TaskResult),
  session_id: Schema.optional(Schema.String),
  worker_id: Schema.optional(Schema.String),
  attempt_count: Schema.Number,
  max_attempts: Schema.Number,
  time_created: Schema.Number,
  time_updated: Schema.Number,
  started_at: Schema.optional(Schema.Number),
  completed_at: Schema.optional(Schema.Number),
})

const CreateTaskPayload = Schema.Struct({
  type: TaskType,
  repo: Schema.String,
  branch: Schema.String,
  prompt: Schema.String,
})

const ListTasksQuery = Schema.Struct({
  status: Schema.optional(TaskStatus),
  repo: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
})

export const TeamJulesGroup = HttpApiGroup.make("server.teamjules")
  .add(
    HttpApiEndpoint.get("teamjules.list", "/api/teamjules/tasks", {
      query: ListTasksQuery,
      success: Schema.Array(TaskInfo),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.teamjules.list",
          summary: "List TeamJules tasks",
          description: "List all TeamJules tasks with optional filters.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("teamjules.create", "/api/teamjules/tasks", {
      payload: CreateTaskPayload,
      success: TaskInfo,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.teamjules.create",
          summary: "Create a TeamJules task",
          description: "Create a new async coding task.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("teamjules.get", "/api/teamjules/tasks/:taskID", {
      params: { taskID: TaskID },
      success: TaskInfo,
      error: [TeamJulesNotFoundError],
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.teamjules.get",
          summary: "Get TeamJules task",
          description: "Get a single TeamJules task by ID.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("teamjules.cancel", "/api/teamjules/tasks/:taskID", {
      params: { taskID: TaskID },
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.teamjules.cancel",
          summary: "Cancel a TeamJules task",
          description: "Cancel a running or pending TeamJules task.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("teamjules.retry", "/api/teamjules/tasks/:taskID/retry", {
      params: { taskID: TaskID },
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.teamjules.retry",
          summary: "Retry a TeamJules task",
          description: "Retry a failed TeamJules task.",
        }),
      ),
  )
