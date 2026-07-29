import { AgentTeam } from "@opencode-ai/core/team"
import { ConflictError, TeamNotFoundError } from "@opencode-ai/protocol/errors"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"

const notFound = (error: AgentTeam.NotFoundError) =>
  new TeamNotFoundError({ teamID: error.teamID, message: `Agent team not found: ${error.teamID}` })
const conflict = (message: string) => new ConflictError({ message, resource: "agent-team" })

export const TeamHandler = HttpApiBuilder.group(Api, "server.team", (handlers) =>
  Effect.gen(function* () {
    const team = yield* AgentTeam.Service
    return handlers
      .handle("team.list", () => team.list)
      .handle("team.create", (ctx) =>
        team
          .create(ctx.payload)
          .pipe(Effect.catchTag("Session.NotFoundError", (error) => conflict(`Session not found: ${error.sessionID}`))),
      )
      .handle("team.get", (ctx) => team.get(ctx.params.teamID).pipe(Effect.catchTag("Team.NotFoundError", notFound)))
      .handle("team.spawn", (ctx) =>
        team.spawn({ teamID: ctx.params.teamID, ...ctx.payload }).pipe(
          Effect.catchTags({
            "Team.NotFoundError": notFound,
            "Team.MemberNotFoundError": (error) => conflict(`Team member not found: ${error.name}`),
            "Team.MemberExistsError": (error) => conflict(`Team member already exists: ${error.name}`),
            "Session.NotFoundError": (error) => conflict(`Session not found: ${error.sessionID}`),
            "Session.PromptConflictError": () => conflict("Teammate session is already accepting a prompt"),
          }),
        ),
      )
      .handle("team.messages", (ctx) =>
        team.messages({ teamID: ctx.params.teamID }).pipe(Effect.catchTag("Team.NotFoundError", notFound)),
      )
      .handle("team.sendMessage", (ctx) =>
        team.sendAndWake({ teamID: ctx.params.teamID, ...ctx.payload }).pipe(
          Effect.catchTags({
            "Team.NotFoundError": notFound,
            "Team.MemberNotFoundError": (error) => conflict(`Team member not found: ${error.name}`),
            "Session.NotFoundError": (error) => conflict(`Session not found: ${error.sessionID}`),
            "Session.PromptConflictError": () => conflict("Teammate session is already accepting a prompt"),
          }),
        ),
      )
      .handle("team.tasks", (ctx) =>
        team.tasks(ctx.params.teamID).pipe(Effect.catchTag("Team.NotFoundError", notFound)),
      )
      .handle("team.addTask", (ctx) =>
        team.addTask({ teamID: ctx.params.teamID, task: ctx.payload }).pipe(Effect.catchTag("Team.NotFoundError", notFound)),
      )
      .handle("team.claimTask", (ctx) =>
        team
          .claimTask({ teamID: ctx.params.teamID, taskID: ctx.params.taskID, assignee: ctx.payload.assignee })
          .pipe(Effect.map((claimed) => ({ claimed })), Effect.catchTag("Team.NotFoundError", notFound)),
      )
      .handle("team.completeTask", (ctx) =>
        team
          .completeTask({ teamID: ctx.params.teamID, taskID: ctx.params.taskID })
          .pipe(Effect.as(HttpApiSchema.NoContent.make()), Effect.catchTag("Team.NotFoundError", notFound)),
      )
  }),
)
