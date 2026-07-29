import { Agent, Model, Session, Team } from "@opencode-ai/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, TeamNotFoundError } from "../errors"

const TeamIDParams = { teamID: Team.ID }

export const TeamGroup = HttpApiGroup.make("server.team")
  .add(HttpApiEndpoint.get("team.list", "/api/team", { success: Schema.Array(Team.Info) }))
  .add(
    HttpApiEndpoint.post("team.create", "/api/team", {
      payload: Schema.Struct({ name: Schema.String, leadSessionID: Session.ID }),
      success: Team.Info,
      error: ConflictError,
    }),
  )
  .add(
    HttpApiEndpoint.get("team.get", "/api/team/:teamID", {
      params: TeamIDParams,
      success: Team.Info,
      error: TeamNotFoundError,
    }),
  )
  .add(
    HttpApiEndpoint.post("team.spawn", "/api/team/:teamID/member", {
      params: TeamIDParams,
      payload: Schema.Struct({
        name: Schema.String,
        agent: Agent.ID,
        model: Model.Ref,
        permission: Team.PermissionProfile,
        prompt: Schema.String,
      }),
      success: Team.Member,
      error: [TeamNotFoundError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.get("team.messages", "/api/team/:teamID/message", {
      params: TeamIDParams,
      success: Schema.Array(Team.Message),
      error: TeamNotFoundError,
    }),
  )
  .add(
    HttpApiEndpoint.post("team.sendMessage", "/api/team/:teamID/message", {
      params: TeamIDParams,
      payload: Schema.Struct({ from: Schema.String, to: Schema.String, text: Schema.String }),
      success: Team.Message,
      error: [TeamNotFoundError, ConflictError],
    }),
  )
  .add(
    HttpApiEndpoint.get("team.tasks", "/api/team/:teamID/task", {
      params: TeamIDParams,
      success: Schema.Array(Team.Task),
      error: TeamNotFoundError,
    }),
  )
  .add(
    HttpApiEndpoint.post("team.addTask", "/api/team/:teamID/task", {
      params: TeamIDParams,
      payload: Schema.Struct({
        title: Schema.String,
        description: Schema.String,
        status: Team.TaskStatus,
        assignee: Schema.String.pipe(Schema.optional),
        dependencies: Schema.Array(Team.TaskID),
      }),
      success: Team.Task,
      error: TeamNotFoundError,
    }),
  )
  .add(
    HttpApiEndpoint.post("team.claimTask", "/api/team/:teamID/task/:taskID/claim", {
      params: { teamID: Team.ID, taskID: Team.TaskID },
      payload: Schema.Struct({ assignee: Schema.String }),
      success: Schema.Struct({ claimed: Schema.Boolean }),
      error: TeamNotFoundError,
    }),
  )
  .add(
    HttpApiEndpoint.post("team.completeTask", "/api/team/:teamID/task/:taskID/complete", {
      params: { teamID: Team.ID, taskID: Team.TaskID },
      success: HttpApiSchema.NoContent,
      error: TeamNotFoundError,
    }),
  )
  .annotateMerge(OpenApi.annotations({ title: "agent teams", description: "Persistent concurrent agent teams." }))
