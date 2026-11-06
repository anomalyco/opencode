export * as SubagentTool from "./subagent.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect, Schema } from "effect"
import { Agent } from "../../agent.js"
import { Config } from "../../config.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import { SessionSchema } from "../../session/schema.js"
import { SessionTeam } from "../../session/team.js"
import { SubagentJob } from "../../session/subagent-job.js"

export const name = "subagent"

const backgroundResult = (sessionID: SessionSchema.ID) => ({
  sessionID,
  status: "running" as const,
  output: [
    `The subagent is working in the background (sessionID: ${sessionID}). You will be notified automatically when it finishes.`,
    "DO NOT sleep, poll for progress, ask the subagent for status, or duplicate this subagent's work; avoid working with the same files or topics it is using.",
    "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
  ].join("\n"),
})

export const Input = Schema.Struct({
  agent: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  description: Schema.String.annotate({ description: "A short 3-5 word label for the task, displayed to the user" }),
  prompt: Schema.optionalKey(Schema.String).annotate({
    description:
      "The task for the subagent to perform. Required for plain spawns; must be omitted for team spawns (the leader assigns work via message_to_peer).",
  }),
  team: Schema.optionalKey(Schema.String).annotate({
    description:
      "Spawn this subagent into a team identified by this id. Team members share a roster and can message each other with message_to_peer; the first spawn becomes the team's leader and the only member that can message you. Use this when several subagents need to coordinate instead of reporting back independently. Team ids must be kebab-case.",
  }),
})

export const Output = Schema.Struct({
  sessionID: SessionSchema.ID,
  status: Schema.Literals(["completed", "running", "dormant"]),
  output: Schema.String,
})
export const description = [
  "Spawns an agent in a child session to work on the specified task. Runs in the background and returns immediately.",
  "Plain spawns notify you automatically when the subagent finishes.",
  "Team spawns (team=...) do not notify on completion: teammates communicate by message instead (see message_to_peer).",
  "Do not sleep, poll for progress, or duplicate its work. If you need a status update from a team, message it with message_to_peer instead of waiting.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")

const dormantResult = (membership: {
  name: string
  role: SessionTeam.Role
  teamID: string
  sessionID: SessionSchema.ID
}) => ({
  sessionID: membership.sessionID,
  status: "dormant" as const,
  output:
    membership.role === "leader"
      ? [
          `Spawned ${membership.name} (leader) in team ${membership.teamID} (sessionID: ${membership.sessionID}).`,
          "Dormant: no work has started yet. Wake the leader with message_to_peer to begin.",
          `The leader is the only team member that can message you (as "Boss").`,
          "Members communicate with each other via message_to_peer.",
        ].join("\n")
      : [
          `Spawned ${membership.name} (member) in team ${membership.teamID} (sessionID: ${membership.sessionID}).`,
          "Dormant: no work has started yet.",
        ].join("\n"),
})

export const Plugin = {
  id: "opencode.tool.subagent",
  effect: Effect.fn("SubagentTool.Plugin")(function* (ctx: Context) {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const team = yield* SessionTeam.Service
    const subagents = yield* SubagentJob.Service

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              const parent = yield* sessions
                .get(context.sessionID)
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                  ),
                )
              let current = parent
              let depth = 0
              while (current.parentID) {
                depth++
                current = yield* sessions
                  .get(current.parentID)
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Parent session not found: ${current.parentID}`, error }),
                    ),
                  )
              }
              const limit = Config.latest(yield* config.entries(), "experimental")?.subagent_depth ?? 1
              if (depth >= limit)
                return yield* new ToolFailure({
                  message: `Subagent depth limit reached (${limit}). Increase "experimental.subagent_depth" to allow nested subagents.`,
                })
              const agent = yield* agents.resolve(input.agent)
              if (agent === undefined) return yield* new ToolFailure({ message: `Unknown agent: ${input.agent}` })
              if (agent.mode === "primary")
                return yield* new ToolFailure({ message: `Agent ${input.agent} cannot run as a subagent` })
              yield* permission
                .assert({
                  action: name,
                  resources: [agent.id],
                  save: [agent.id],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: {
                    type: "tool",
                    messageID: context.messageID,
                    id: context.id,
                  },
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: `Subagent denied: ${agent.id}`, error })))

              const teamID = input.team?.trim()
              if (teamID && input.prompt !== undefined)
                return yield* new ToolFailure({
                  message: [
                    "Team spawns start dormant: the prompt is not executed at spawn time.",
                    "The leader assigns work to members via message_to_peer. Omit \"prompt\" for team spawns.",
                  ].join("\n"),
                })
              if (!teamID && input.prompt === undefined)
                return yield* new ToolFailure({ message: "The \"prompt\" parameter is required for plain spawns." })
              if (teamID && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(teamID))
                return yield* new ToolFailure({
                  message: `Invalid team id "${teamID}": team ids must be kebab-case (lowercase letters, digits, and hyphens).`,
                })

              const model = agent.model ?? parent.model
              const child = yield* sessions
                .create({
                  parentID: context.sessionID,
                  title: input.description,
                  agent: Agent.ID.make(input.agent),
                  model,
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Parent session not found: ${context.sessionID}`, error }),
                  ),
                )

              if (!teamID) {
                yield* context.progress({ sessionID: child.id, status: "running" })
                yield* sessions
                  .prompt({
                    sessionID: child.id,
                    text: ["You are a subagent spawned by another session.", input.prompt!].join("\n"),
                    resume: false,
                  })
                  .pipe(
                    Effect.mapError(
                      (error) => new ToolFailure({ message: `Failed to prompt subagent: ${child.id}`, error }),
                    ),
                  )
                const recovery = {
                  kind: "subagent" as const,
                  parentSessionID: context.sessionID,
                  childSessionID: child.id,
                  agent: agent.name,
                  description: input.description,
                }
                yield* subagents.start(recovery)
                yield* subagents.background(recovery)
                return backgroundResult(child.id)
              }

              const membership = yield* team
                .register({ parentID: context.sessionID, teamID, sessionID: child.id })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to register team member: ${child.id}`, error }),
                  ),
                )
              yield* sessions
                .rename({
                  sessionID: child.id,
                  title: `${membership.name} (${membership.role}) — ${input.description}`,
                })
                .pipe(
                  Effect.mapError(
                    (error) => new ToolFailure({ message: `Failed to rename team member: ${child.id}`, error }),
                  ),
                )
              return dormantResult(membership)
            }).pipe(
              Effect.map((output) => ({
                output,
                content: output.output,
                metadata: { sessionID: output.sessionID, status: output.status },
              })),
            ),
        }),
      )
      .pipe(Effect.orDie)

    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const tool = event.tools[name]
        if (!tool) return
        const selected = yield* agents.resolve(event.agent)
        if (!selected) return
        const available = (yield* agents.list())
          .filter(
            (agent) =>
              agent.mode !== "primary" &&
              !agent.hidden &&
              Permission.evaluate(name, agent.id, selected.permissions).effect !== "deny",
          )
          .toSorted((a, b) => a.id.localeCompare(b.id))
        if (available.length === 0) return
        tool.description = [
          tool.description,
          "",
          "Available subagents:",
          ...available.map(
            (agent) =>
              `- ${agent.id}: ${agent.description ?? "This subagent should only be called when explicitly requested."}`,
          ),
        ].join("\n")
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
