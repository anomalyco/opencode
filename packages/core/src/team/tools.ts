export * as AgentTeamTools from "./tools"

import { ToolFailure } from "@opencode-ai/llm"
import { Agent, Model, Team } from "@opencode-ai/schema"
import { Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { ApplicationTools } from "../tool/application-tools"
import { Tool } from "../tool/tool"
import { AgentTeam } from "../team"

const text = <A>(value: A) => [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
const failed = (action: string) => (error: unknown) =>
  new ToolFailure({ message: `${action}: ${error instanceof Error ? error.message : String(error)}` })

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ApplicationTools.Service
    const teams = yield* AgentTeam.Service

    const current = (sessionID: Team.Member["sessionID"]) =>
      teams
        .forSession(sessionID)
        .pipe(
          Effect.flatMap((team) =>
            team ? Effect.succeed(team) : Effect.fail(new Error("This session does not belong to an agent team")),
          ),
        )

    const actor = (team: Team.Info, sessionID: Team.Member["sessionID"]) =>
      team.leadSessionID === sessionID
        ? { name: "lead", permission: "lead" as const }
        : team.members.find((member) => member.sessionID === sessionID)

    yield* registry.register({
      team_create: Tool.make({
        description: "Create a persistent agent team led by the current session.",
        input: Schema.Struct({ name: Schema.String }),
        output: Team.Info,
        toModelOutput: ({ output }) => text(output),
        execute: (input, context) =>
          teams
            .create({ name: input.name, leadSessionID: context.sessionID })
            .pipe(Effect.mapError(failed("Unable to create team"))),
      }),
      team_status: Tool.make({
        description: "Read this session's persistent team, members, shared tasks, and named messages.",
        input: Schema.Struct({}),
        output: Schema.Struct({
          team: Team.Info,
          tasks: Schema.Array(Team.Task),
          messages: Schema.Array(Team.Message),
        }),
        toModelOutput: ({ output }) => text(output),
        execute: (_, context) =>
          current(context.sessionID).pipe(
            Effect.flatMap((team) =>
              Effect.all({
                team: Effect.succeed(team),
                tasks: teams.tasks(team.id),
                messages: teams.messages({ teamID: team.id }),
              }),
            ),
            Effect.mapError(failed("Unable to read team status")),
          ),
      }),
      team_spawn: Tool.make({
        description: "Start a named teammate in a persistent concurrent background session. Team lead only.",
        input: Schema.Struct({
          name: Schema.String,
          agent: Agent.ID,
          model: Model.Ref,
          permission: Team.PermissionProfile,
          prompt: Schema.String,
        }),
        output: Team.Member,
        toModelOutput: ({ output }) => text(output),
        execute: (input, context) =>
          current(context.sessionID).pipe(
            Effect.flatMap((team) =>
              team.leadSessionID === context.sessionID
                ? teams.spawn({ teamID: team.id, ...input })
                : Effect.fail(new Error("Only the team lead can spawn teammates")),
            ),
            Effect.mapError(failed("Unable to spawn teammate")),
          ),
      }),
      team_message: Tool.make({
        description: "Send a durable named message to the lead or a teammate and wake their background session.",
        input: Schema.Struct({ to: Schema.String, text: Schema.String }),
        output: Team.Message,
        toModelOutput: ({ output }) => text(output),
        execute: (input, context) =>
          current(context.sessionID).pipe(
            Effect.flatMap((team) => {
              const sender = actor(team, context.sessionID)
              return sender
                ? teams.sendAndWake({ teamID: team.id, from: sender.name, to: input.to, text: input.text })
                : Effect.fail(new Error("Current session is not a team member"))
            }),
            Effect.mapError(failed("Unable to send team message")),
          ),
      }),
      team_task: Tool.make({
        description: "List, create, atomically claim, or complete work in the persistent shared team task board.",
        input: Schema.Union([
          Schema.Struct({ action: Schema.Literal("list") }),
          Schema.Struct({ action: Schema.Literal("create"), title: Schema.String, description: Schema.String }),
          Schema.Struct({ action: Schema.Literal("claim"), taskID: Team.TaskID }),
          Schema.Struct({ action: Schema.Literal("complete"), taskID: Team.TaskID }),
        ]),
        output: Schema.Struct({ tasks: Schema.Array(Team.Task), claimed: Schema.Boolean.pipe(Schema.optional) }),
        toModelOutput: ({ output }) => text(output),
        execute: (input, context) =>
          current(context.sessionID).pipe(
            Effect.flatMap((team) => {
              const member = actor(team, context.sessionID)
              if (!member) return Effect.fail(new Error("Current session is not a team member"))
              if (input.action === "list") return teams.tasks(team.id).pipe(Effect.map((tasks) => ({ tasks })))
              if (input.action === "create") {
                if (member.permission !== "lead") return Effect.fail(new Error("Only the team lead can create tasks"))
                return teams
                  .addTask({
                    teamID: team.id,
                    task: {
                      title: input.title,
                      description: input.description,
                      status: "pending",
                      dependencies: [],
                    },
                  })
                  .pipe(
                    Effect.flatMap(() => teams.tasks(team.id)),
                    Effect.map((tasks) => ({ tasks })),
                  )
              }
              if (input.action === "claim")
                return teams
                  .claimTask({ teamID: team.id, taskID: input.taskID, assignee: member.name })
                  .pipe(
                    Effect.flatMap((claimed) => teams.tasks(team.id).pipe(Effect.map((tasks) => ({ tasks, claimed })))),
                  )
              return teams.completeTask({ teamID: team.id, taskID: input.taskID }).pipe(
                Effect.flatMap(() => teams.tasks(team.id)),
                Effect.map((tasks) => ({ tasks })),
              )
            }),
            Effect.mapError(failed("Unable to update team task")),
          ),
      }),
    })
  }),
)

export const node = makeGlobalNode({
  name: "agent-team-tools",
  layer: layer.pipe(Layer.orDie),
  deps: [ApplicationTools.node, AgentTeam.node],
})

// Re-expose the team service after the side-effect registration layer so consumers
// receive AgentTeam without allowing the final no-output node to consume it.
export const readyNode = makeGlobalNode({
  service: AgentTeam.Service,
  layer: Layer.effect(AgentTeam.Service, AgentTeam.Service),
  deps: [node, AgentTeam.node],
})
