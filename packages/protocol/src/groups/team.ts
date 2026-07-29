import { Agent, Model, Session, Team } from "@opencode-ai/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, TeamNotFoundError } from "../errors"

const TeamIDParams = { teamID: Team.ID }

export const TeamGroup = HttpApiGroup.make("server.team")
  .add(
    HttpApiEndpoint.get("team.list", "/api/team", { success: Schema.Array(Team.Info) }).annotateMerge(
      OpenApi.annotations({ identifier: "v2.team.list", summary: "List agent teams" }),
    ),
  )
  .add(
    HttpApiEndpoint.post("team.create", "/api/team", {
      payload: Schema.Struct({ name: Schema.String, leadSessionID: Session.ID }),
      success: Team.Info,
      error: ConflictError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.team.create", summary: "Create an agent team" })),
  )
  .add(
    HttpApiEndpoint.get("team.get", "/api/team/:teamID", {
      params: TeamIDParams,
      success: Team.Info,
      error: TeamNotFoundError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.team.get", summary: "Get an agent team" })),
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
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.team.spawn", summary: "Spawn a teammate" })),
  )
  .add(
    HttpApiEndpoint.get("team.messages", "/api/team/:teamID/message", {
      params: TeamIDParams,
      success: Schema.Array(Team.Message),
      error: TeamNotFoundError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.team.messages", summary: "List team messages" })),
  )
  .add(
    HttpApiEndpoint.post("team.sendMessage", "/api/team/:teamID/message", {
      params: TeamIDParams,
      payload: Schema.Struct({ from: Schema.String, to: Schema.String, text: Schema.String }),
      success: Team.Message,
      error: [TeamNotFoundError, ConflictError],
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.team.sendMessage", summary: "Send a team message" })),
  )
  .add(
    HttpApiEndpoint.get("team.tasks", "/api/team/:teamID/task", {
      params: TeamIDParams,
      success: Schema.Array(Team.Task),
      error: TeamNotFoundError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.team.tasks", summary: "List team tasks" })),
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
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.team.addTask", summary: "Create a team task" })),
  )
  .add(
    HttpApiEndpoint.post("team.claimTask", "/api/team/:teamID/task/:taskID/claim", {
      params: { teamID: Team.ID, taskID: Team.TaskID },
      payload: Schema.Struct({ assignee: Schema.String }),
      success: Schema.Struct({ claimed: Schema.Boolean }),
      error: TeamNotFoundError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.team.claimTask", summary: "Claim a team task" })),
  )
  .add(
    HttpApiEndpoint.post("team.completeTask", "/api/team/:teamID/task/:taskID/complete", {
      params: { teamID: Team.ID, taskID: Team.TaskID },
      success: HttpApiSchema.NoContent,
      error: TeamNotFoundError,
    }).annotateMerge(OpenApi.annotations({ identifier: "v2.team.completeTask", summary: "Complete a team task" })),
  )
  .annotateMerge(OpenApi.annotations({ title: "agent teams", description: "Persistent concurrent agent teams." }))
