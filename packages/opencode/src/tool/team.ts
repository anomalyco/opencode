import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import * as Tool from "./tool"
import { Team, TeamTasks, WRITE_TOOLS, type TeamTask } from "../team"
import { TeamMessaging } from "../team/messaging"
import { Session } from "../session/session"
import { SessionID } from "../session/schema"
import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { Bus } from "../bus"
import { TeamEvent } from "../team/events"
import { Truncate } from "./truncate"
import { attach } from "../effect/run-service"

type Metadata = Record<string, any>

const Priority = Schema.Literals(["high", "medium", "low"])
const TaskStatus = Schema.Literals(["pending", "in_progress", "completed", "cancelled", "blocked"])
const InitialTask = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  priority: Priority,
  depends_on: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})
const TeamTaskInput = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  status: TaskStatus,
  priority: Priority,
  assignee: Schema.optional(Schema.String),
  depends_on: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
})

const runPromise = <A>(evaluate: () => Promise<A>) => Effect.promise(evaluate)

const emptyMetadata = {} satisfies Metadata
const legacyToolRuntime = ManagedRuntime.make(
  Layer.mergeAll(Agent.defaultLayer, Provider.defaultLayer, Session.defaultLayer, Truncate.defaultLayer),
)

function installLegacyInit<Parameters extends Schema.Decoder<unknown>, Result extends Metadata>(
  tool: Effect.Effect<Tool.Info<Parameters, Result>, never, unknown> & {
    init: () => Promise<Tool.LegacyDef<Parameters, Result>>
  },
) {
  tool.init = async () => {
    const info = await legacyToolRuntime.runPromise(
      attach(tool as unknown as Effect.Effect<Tool.Info<Parameters, Result>, never, never>),
    )
    const next = await legacyToolRuntime.runPromise(attach(Tool.init(info)))
    return {
      ...next,
      execute: (args, ctx) => legacyToolRuntime.runPromise(attach(next.execute(args, ctx))),
    }
  }
}

function error(output: string) {
  return { title: "Error", output, metadata: emptyMetadata }
}

function toTeamTask(input: Schema.Schema.Type<typeof TeamTaskInput>): TeamTask {
  return {
    id: input.id,
    content: input.content,
    status: input.status,
    priority: input.priority,
    assignee: input.assignee,
    depends_on: input.depends_on ? [...input.depends_on] : undefined,
  }
}

export const TeamCreateParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Team name, for example auth-review or feature-impl" }),
  tasks: Schema.optional(Schema.mutable(Schema.Array(InitialTask))).annotate({
    description: "Optional initial task list for the team",
  }),
  delegate: Schema.optional(Schema.Boolean).annotate({
    description: "Restrict the lead to coordination-only tools",
  }),
})

export const TeamCreateTool = Tool.define<typeof TeamCreateParameters, Metadata, Session.Service>(
  "team_create",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description:
        "Create a new agent team for coordinating parallel work across multiple sessions. " +
        "You become the team lead. After creating a team, use team_spawn to add teammates and team_tasks to create a shared task list.",
      parameters: TeamCreateParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const existingTeam = yield* runPromise(() => Team.findBySession(ctx.sessionID))
          if (existingTeam?.role === "member") {
            return error(
              "Teammates cannot create new teams. Only the lead session or an independent session can create a team.",
            )
          }
          if (existingTeam?.role === "lead") {
            return error(
              `You are already leading team "${existingTeam.team.name}". Only one team per session is allowed.`,
            )
          }

          yield* runPromise(() =>
            Team.create({
              name: params.name,
              leadSessionID: ctx.sessionID,
              delegate: params.delegate,
            }),
          )

          if (params.tasks?.length) {
            const tasks = params.tasks.map((task) => ({
              id: task.id,
              content: task.content,
              priority: task.priority,
              depends_on: task.depends_on ? [...task.depends_on] : undefined,
              status: "pending" as const,
            }))
            yield* runPromise(() => TeamTasks.add(params.name, tasks))
          }

          if (params.delegate) {
            const current = yield* session.get(ctx.sessionID)
            yield* session.setPermission({
              sessionID: ctx.sessionID,
              permission: [
                ...(current.permission ?? []),
                ...WRITE_TOOLS.map((tool) => ({
                  permission: tool,
                  pattern: "*",
                  action: "deny" as const,
                })),
              ],
            })
          }

          return {
            title: `Created team: ${params.name}`,
            output: [
              `Team "${params.name}" created. You are the lead.`,
              params.delegate ? "Delegate mode enabled: coordination tools only." : "",
              "",
              "Next steps:",
              "- Use team_spawn to add teammates",
              "- Use team_tasks to manage the shared task list",
              "- Use team_message to communicate with teammates",
              "",
              "Lifecycle:",
              "- When teammates finish, use team_shutdown to shut them down",
              "- Once all teammates are shut down, use team_cleanup to remove team resources",
              params.tasks?.length ? `Initial tasks: ${params.tasks.length}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            metadata: { teamName: params.name, delegate: params.delegate === true },
          }
        }),
    }
  }),
)

export const TeamSpawnParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Unique name for this teammate" }),
  agent: Schema.optional(Schema.String).annotate({ description: "Agent type to use. Defaults to general." }),
  model: Schema.optional(Schema.String).annotate({ description: "Model in provider/model format" }),
  prompt: Schema.String.annotate({ description: "Initial instructions for the teammate" }),
  claim_task: Schema.optional(Schema.String).annotate({ description: "Task ID to auto-claim for this teammate" }),
  require_plan_approval: Schema.optional(Schema.Boolean).annotate({
    description: "Start the teammate in read-only plan mode until the lead approves the plan",
  }),
})

export const TeamSpawnTool = Tool.define<typeof TeamSpawnParameters, Metadata, Agent.Service | Provider.Service>(
  "team_spawn",
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service

    return {
      description:
        "Spawn a new teammate for the current team. Each teammate runs in its own session with its own context window.",
      parameters: TeamSpawnParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          if (params.name === "lead") return error('Name "lead" is reserved. Choose a different teammate name.')

          const teamInfo = yield* runPromise(() => Team.findBySession(ctx.sessionID))
          if (!teamInfo) return error("You are not the lead of any team. Create a team first with team_create.")
          if (teamInfo.role === "member") {
            return error("Teammates cannot spawn other teammates. Only the team lead can spawn new members.")
          }

          const agentName = params.agent ?? "general"
          const next = yield* agents.get(agentName)
          if (!next) {
            const names = (yield* agents.list()).map((item) => item.name).join(", ")
            return error(`Agent "${agentName}" not found. Available agents: ${names}`)
          }

          const model = yield* Effect.gen(function* () {
            if (params.model) {
              const parsed = Provider.parseModel(params.model)
              return yield* provider.getModel(parsed.providerID, parsed.modelID).pipe(
                Effect.as(parsed),
                Effect.catch((err) =>
                  Effect.succeed({
                    error: `Model not found: ${params.model}.${
                      err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
                    }`,
                  } as const),
                ),
              )
            }
            if (next.model) return next.model
            const lastUser = ctx.messages.findLast((message) => message.info.role === "user")
            if (lastUser?.info.role === "user") return lastUser.info.model
            return yield* provider.defaultModel().pipe(Effect.orDie)
          })
          if ("error" in model) return error(model.error)

          const spawned = yield* runPromise(() =>
            Team.spawnMember({
              teamName: teamInfo.team.name,
              name: params.name,
              parentSessionID: ctx.sessionID,
              agent: {
                name: next.name,
                prompt: next.prompt,
              },
              model,
              prompt: params.prompt,
              claimTask: params.claim_task,
              planApproval: params.require_plan_approval === true,
            }),
          )

          return {
            title: `Spawned teammate: ${params.name}`,
            output: [
              `Teammate "${params.name}" spawned with agent "${agentName}" using model ${spawned.label}.`,
              `Session ID: ${spawned.sessionID}`,
              params.claim_task ? `Auto-claimed task: ${params.claim_task}` : "",
              params.require_plan_approval
                ? "Plan approval required: approve the plan with team_approve_plan before implementation."
                : "",
              "",
              "The teammate is now working independently in the background.",
            ]
              .filter(Boolean)
              .join("\n"),
            metadata: {
              teamName: teamInfo.team.name,
              memberName: params.name,
              sessionID: spawned.sessionID,
              model: spawned.label,
              planApproval: params.require_plan_approval === true,
            },
          }
        }),
    }
  }),
)

export const TeamMessageParameters = Schema.Struct({
  to: Schema.String.annotate({ description: "Recipient teammate name, or lead" }),
  text: Schema.String.annotate({ description: "Message content" }),
})

export const TeamMessageTool = Tool.define<typeof TeamMessageParameters, Metadata, never>(
  "team_message",
  Effect.succeed({
    description: "Send a message to a specific teammate or the team lead.",
    parameters: TeamMessageParameters,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        const teamInfo = yield* runPromise(() => Team.findBySession(ctx.sessionID))
        if (!teamInfo) return error("You are not part of any team.")
        const from = teamInfo.role === "lead" ? "lead" : teamInfo.memberName
        if (!from) return error("Could not determine team sender.")
        yield* runPromise(() =>
          TeamMessaging.send({ teamName: teamInfo.team.name, from, to: params.to, text: params.text }),
        )
        return {
          title: `Message sent to ${params.to}`,
          output: `Message delivered to "${params.to}".`,
          metadata: { to: params.to },
        }
      }),
  }),
)

export const TeamBroadcastParameters = Schema.Struct({
  text: Schema.String.annotate({ description: "Message to broadcast to all teammates" }),
})

export const TeamBroadcastTool = Tool.define<typeof TeamBroadcastParameters, Metadata, never>(
  "team_broadcast",
  Effect.succeed({
    description: "Send a message to all teammates simultaneously. Prefer targeted messages when possible.",
    parameters: TeamBroadcastParameters,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        const teamInfo = yield* runPromise(() => Team.findBySession(ctx.sessionID))
        if (!teamInfo) return error("You are not part of any team.")
        const from = teamInfo.role === "lead" ? "lead" : teamInfo.memberName
        if (!from) return error("Could not determine team sender.")
        yield* runPromise(() => TeamMessaging.broadcast({ teamName: teamInfo.team.name, from, text: params.text }))
        return {
          title: "Broadcast sent",
          output: `Broadcast sent to all teammates in "${teamInfo.team.name}".`,
          metadata: emptyMetadata,
        }
      }),
  }),
)

export const TeamTasksParameters = Schema.Struct({
  action: Schema.Literals(["list", "add", "complete", "update"]).annotate({
    description: "Task-list action",
  }),
  tasks: Schema.optional(Schema.mutable(Schema.Array(TeamTaskInput))).annotate({
    description: "Tasks to add or the full replacement list",
  }),
  task_id: Schema.optional(Schema.String).annotate({ description: "Task ID for complete" }),
})

export const TeamTasksTool = Tool.define<typeof TeamTasksParameters, Metadata, never>(
  "team_tasks",
  Effect.succeed({
    description: "View or update the shared task list for the team. Use list, add, complete, or update.",
    parameters: TeamTasksParameters,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        const teamInfo = yield* runPromise(() => Team.findBySession(ctx.sessionID))
        if (!teamInfo) return error("You are not part of any team.")
        const teamName = teamInfo.team.name

        switch (params.action) {
          case "list": {
            const tasks = yield* runPromise(() => TeamTasks.list(teamName))
            if (tasks.length === 0) {
              return { title: "Task list", output: "No tasks in the team task list.", metadata: emptyMetadata }
            }
            return {
              title: "Task list",
              output: tasks
                .map((task) => {
                  const status = task.status === "in_progress" ? `in_progress (${task.assignee ?? "?"})` : task.status
                  const deps = task.depends_on?.length ? ` [deps: ${task.depends_on.join(", ")}]` : ""
                  return `[${task.id}] ${task.content} - ${status} (${task.priority})${deps}`
                })
                .join("\n"),
              metadata: { count: tasks.length },
            }
          }
          case "add": {
            if (!params.tasks?.length) return error("No tasks provided to add.")
            const tasks = params.tasks.map((task) => ({ ...toTeamTask(task), status: "pending" as const }))
            yield* runPromise(() => TeamTasks.add(teamName, tasks))
            return {
              title: `Added ${params.tasks.length} tasks`,
              output: `Added ${params.tasks.length} task(s) to the shared list.`,
              metadata: emptyMetadata,
            }
          }
          case "complete": {
            if (!params.task_id) return error("No task_id provided.")
            yield* runPromise(() => TeamTasks.complete(teamName, params.task_id!))
            return {
              title: `Completed task ${params.task_id}`,
              output: `Task "${params.task_id}" marked as completed. Dependent tasks may have been unblocked.`,
              metadata: emptyMetadata,
            }
          }
          case "update": {
            if (!params.tasks) return error("No tasks provided for update.")
            const tasks = params.tasks.map(toTeamTask)
            yield* runPromise(() => TeamTasks.update(teamName, tasks))
            return {
              title: "Task list updated",
              output: `Replaced task list with ${params.tasks.length} task(s).`,
              metadata: emptyMetadata,
            }
          }
        }
      }),
  }),
)

export const TeamClaimParameters = Schema.Struct({
  task_id: Schema.String.annotate({ description: "Task ID to claim" }),
})

export const TeamClaimTool = Tool.define<typeof TeamClaimParameters, Metadata, never>(
  "team_claim",
  Effect.succeed({
    description: "Claim a pending task from the team's shared task list.",
    parameters: TeamClaimParameters,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        const teamInfo = yield* runPromise(() => Team.findBySession(ctx.sessionID))
        if (!teamInfo) return error("You are not part of any team.")
        const memberName = teamInfo.role === "lead" ? "lead" : teamInfo.memberName
        if (!memberName) return error("Could not determine team member name.")
        const claimed = yield* runPromise(() => TeamTasks.claim(teamInfo.team.name, params.task_id, memberName))
        if (!claimed) {
          return {
            title: "Claim failed",
            output: `Could not claim task "${params.task_id}". It may already be taken, blocked, or not found.`,
            metadata: emptyMetadata,
          }
        }
        return {
          title: `Claimed task ${params.task_id}`,
          output: `You claimed task "${params.task_id}". It is now in_progress assigned to you.`,
          metadata: { taskId: params.task_id },
        }
      }),
  }),
)

export const TeamApprovePlanParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Teammate whose plan to review" }),
  approved: Schema.Boolean.annotate({ description: "true to approve, false to reject" }),
  feedback: Schema.optional(Schema.String).annotate({ description: "Feedback for the teammate" }),
})

export const TeamApprovePlanTool = Tool.define<typeof TeamApprovePlanParameters, Metadata, Session.Service>(
  "team_approve_plan",
  Effect.gen(function* () {
    const session = yield* Session.Service

    return {
      description: "Approve or reject a teammate's implementation plan.",
      parameters: TeamApprovePlanParameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const teamInfo = yield* runPromise(() => Team.findBySession(ctx.sessionID))
          if (!teamInfo || teamInfo.role !== "lead") return error("Only the team lead can approve plans.")

          const member = teamInfo.team.members.find((item) => item.name === params.name)
          if (!member) return error(`Teammate "${params.name}" not found.`)
          if (member.planApproval !== "pending" && member.planApproval !== "rejected") {
            return error(
              `Teammate "${params.name}" is not awaiting plan approval (current: ${member.planApproval ?? "none"}).`,
            )
          }

          if (params.approved) {
            const current = yield* session.get(SessionID.make(member.sessionID))
            yield* session.setPermission({
              sessionID: SessionID.make(member.sessionID),
              permission: (current.permission ?? []).filter((rule) => rule.pattern !== "*:plan-approval"),
            })
            yield* runPromise(() => Team.setMemberPlanApproval(teamInfo.team.name, params.name, "approved"))
            yield* runPromise(() =>
              TeamMessaging.send({
                teamName: teamInfo.team.name,
                from: "lead",
                to: params.name,
                text: params.feedback
                  ? `Your plan has been APPROVED. You now have full write access. Feedback: ${params.feedback}`
                  : "Your plan has been APPROVED. You now have full write access. Proceed with implementation.",
              }),
            )
            yield* runPromise(() =>
              Bus.publish(TeamEvent.PlanApproval, {
                teamName: teamInfo.team.name,
                memberName: params.name,
                approved: true,
                feedback: params.feedback,
              }),
            )
            return {
              title: `Plan approved: ${params.name}`,
              output: `Approved "${params.name}"'s plan. Write tools are now unlocked for this teammate.`,
              metadata: { approved: true },
            }
          }

          yield* runPromise(() => Team.setMemberPlanApproval(teamInfo.team.name, params.name, "rejected"))
          yield* runPromise(() =>
            TeamMessaging.send({
              teamName: teamInfo.team.name,
              from: "lead",
              to: params.name,
              text: `Your plan has been REJECTED. Please revise and resubmit. Feedback: ${
                params.feedback ?? "No specific feedback provided."
              }`,
            }),
          )
          yield* runPromise(() =>
            Bus.publish(TeamEvent.PlanApproval, {
              teamName: teamInfo.team.name,
              memberName: params.name,
              approved: false,
              feedback: params.feedback,
            }),
          )
          return {
            title: `Plan rejected: ${params.name}`,
            output: `Rejected "${params.name}"'s plan. They remain in read-only mode and should revise.`,
            metadata: { approved: false },
          }
        }),
    }
  }),
)

export const TeamShutdownParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Teammate to shut down" }),
  reason: Schema.optional(Schema.String).annotate({ description: "Reason for the shutdown request" }),
})

export const TeamShutdownTool = Tool.define<typeof TeamShutdownParameters, Metadata, never>(
  "team_shutdown",
  Effect.succeed({
    description: "Request a teammate to shut down gracefully. Only the team lead should use this.",
    parameters: TeamShutdownParameters,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        const teamInfo = yield* runPromise(() => Team.findBySession(ctx.sessionID))
        if (!teamInfo || teamInfo.role !== "lead") return error("Only the team lead can shut down teammates.")

        const member = teamInfo.team.members.find((item) => item.name === params.name)
        if (!member) return error(`Teammate "${params.name}" not found.`)
        if (member.status === "shutdown") {
          return {
            title: "Already shutdown",
            output: `Teammate "${params.name}" is already shut down.`,
            metadata: emptyMetadata,
          }
        }

        const reason = params.reason ?? "The lead has requested you shut down."
        yield* runPromise(() => Team.transitionMemberStatus(teamInfo.team.name, params.name, "shutdown_requested"))
        yield* runPromise(() =>
          Bus.publish(TeamEvent.ShutdownRequest, {
            teamName: teamInfo.team.name,
            memberName: params.name,
          }),
        )
        const sent = yield* Effect.tryPromise(() =>
          TeamMessaging.send({
            teamName: teamInfo.team.name,
            from: "lead",
            to: params.name,
            text: [
              `SHUTDOWN REQUEST: ${reason}`,
              "",
              "Please wrap up your current work:",
              "1. Summarize your findings and send them to the lead.",
              "2. Stop working after sending your summary.",
            ].join("\n"),
          }),
        ).pipe(
          Effect.as(true),
          Effect.catch(() => Effect.succeed(false)),
        )
        if (!sent) yield* runPromise(() => Team.transitionMemberStatus(teamInfo.team.name, params.name, "shutdown"))
        if (member.status === "busy") yield* runPromise(() => Team.cancelMember(teamInfo.team.name, params.name))

        return {
          title: `Shutdown requested: ${params.name}`,
          output: `Shutdown request sent to "${params.name}". They will wrap up current work and stop.`,
          metadata: emptyMetadata,
        }
      }),
  }),
)

export const TeamCleanupParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "Team name to clean up" }),
})

export const TeamCleanupTool = Tool.define<typeof TeamCleanupParameters, Metadata, never>(
  "team_cleanup",
  Effect.succeed({
    description: "Clean up the team by removing all team resources. All teammates must be shut down first.",
    parameters: TeamCleanupParameters,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        const teamInfo = yield* runPromise(() => Team.findBySession(ctx.sessionID))
        if (!teamInfo || teamInfo.role !== "lead" || teamInfo.team.name !== params.name) {
          return error("Only the lead of this team can clean it up.")
        }

        const wasDelegate = teamInfo.team.delegate === true
        return yield* Effect.tryPromise(() => Team.cleanup(params.name)).pipe(
          Effect.as({
            title: `Team cleaned up: ${params.name}`,
            output: [
              `Team "${params.name}" has been cleaned up. All resources removed.`,
              wasDelegate ? "Delegate mode restrictions have been removed. You can now use all tools again." : "",
            ]
              .filter(Boolean)
              .join("\n"),
            metadata: emptyMetadata,
          }),
          Effect.catch((err) =>
            Effect.succeed({
              title: "Cleanup failed",
              output: `Failed to clean up team: ${err instanceof Error ? err.message : String(err)}`,
              metadata: emptyMetadata,
            }),
          ),
        )
      }),
  }),
)

installLegacyInit(TeamCreateTool)
installLegacyInit(TeamSpawnTool)
installLegacyInit(TeamMessageTool)
installLegacyInit(TeamBroadcastTool)
installLegacyInit(TeamTasksTool)
installLegacyInit(TeamClaimTool)
installLegacyInit(TeamApprovePlanTool)
installLegacyInit(TeamShutdownTool)
installLegacyInit(TeamCleanupTool)
