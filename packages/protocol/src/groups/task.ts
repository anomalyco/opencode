import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Task } from "@opencode-ai/schema/task"
import { Location } from "@opencode-ai/schema/location"
import { InvalidRequestError, TaskNotFoundError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

export const TaskGroup = HttpApiGroup.make("server.task")
  .add(
    HttpApiEndpoint.post("task.start", "/api/task", {
      query: LocationQuery,
      payload: Schema.Struct({
        name: Schema.String,
        command: Schema.String,
        cwd: Schema.optional(Schema.String),
        port: Schema.optional(Schema.Number),
        metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      }),
      success: Location.response(Task.Info),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.start",
          summary: "Start a background task",
          description: "Spawns a shell command in the background, redirects output to a log, and tracks its PID and port.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("task.stop", "/api/task/:taskID/stop", {
      query: LocationQuery,
      params: { taskID: Task.ID },
      success: Location.response(Task.Info),
      error: TaskNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.stop",
          summary: "Stop a background task",
          description: "Gracefully terminates a background task by PID.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("task.restart", "/api/task/:taskID/restart", {
      query: LocationQuery,
      params: { taskID: Task.ID },
      success: Location.response(Task.Info),
      error: TaskNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.restart",
          summary: "Restart a background task",
          description: "Stops the running task and launches it again with the same command and configuration.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("task.kill", "/api/task/:taskID/kill", {
      query: LocationQuery,
      params: { taskID: Task.ID },
      success: Location.response(Task.Info),
      error: TaskNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.kill",
          summary: "Force kill a background task",
          description: "Sends SIGKILL (or taskkill /F on Windows) to terminate the background task immediately.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("task.list", "/api/task", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Task.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.list",
          summary: "List background tasks",
          description: "Returns all tasks registered in the system.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("task.get", "/api/task/:taskID", {
      query: LocationQuery,
      params: { taskID: Task.ID },
      success: Location.response(Task.Info),
      error: TaskNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.get",
          summary: "Get background task status",
          description: "Returns the details of a single background task by its ID.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("task.delete", "/api/task/:taskID", {
      query: LocationQuery,
      params: { taskID: Task.ID },
      success: HttpApiSchema.NoContent,
      error: TaskNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.delete",
          summary: "Delete a background task",
          description: "Deletes a stopped/completed background task's records and logs from the system.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("task.logs", "/api/task/:taskID/logs", {
      query: Schema.Struct({
        ...LocationQuery.fields,
        lines: Schema.optional(Schema.NumberFromString),
      }),
      params: { taskID: Task.ID },
      success: Location.response(Schema.String),
      error: TaskNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.logs",
          summary: "Get task logs",
          description: "Reads the log file for the specified background task.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("task.streamLogs", "/api/task/:taskID/logs/stream", {
      query: LocationQuery,
      params: { taskID: Task.ID },
      success: HttpApiSchema.StreamSse({ data: Schema.String }),
      error: TaskNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.task.streamLogs",
          summary: "Stream task logs",
          description: "Establishes an SSE stream to receive real-time stdout/stderr lines from the task.",
        }),
      ),
  )
