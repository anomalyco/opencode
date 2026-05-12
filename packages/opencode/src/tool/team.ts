import * as Tool from "./tool"
import DESCRIPTION from "./team.txt"
import { Session } from "@/session/session"
import { MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { TaskPromptOps } from "./task"
import { Config } from "@/config/config"
import * as Team from "@/team/team"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Schema } from "effect"

const id = "team"

const ActionCreate = Schema.Struct({
  action: Schema.Literal("create"),
})

const TaskItem = Schema.Struct({
  description: Schema.String.annotate({ description: "Description of the task for a teammate to complete" }),
})

const ActionAddTasks = Schema.Struct({
  action: Schema.Literal("add_tasks"),
  team_id: Schema.String.annotate({ description: "The team ID returned from a previous 'create' action" }),
  tasks: Schema.mutable(Schema.Array(TaskItem)).annotate({ description: "Tasks to add to the shared task list" }),
})

const ActionSpawn = Schema.Struct({
  action: Schema.Literal("spawn"),
  team_id: Schema.String.annotate({ description: "The team ID" }),
  agent_type: Schema.String.annotate({ description: "The type of agent to spawn as a teammate" }),
  prompt: Schema.String.annotate({
    description:
      "Initial instructions for the teammate. Include the team_id so the teammate can claim tasks and send messages.",
  }),
})

const ActionStatus = Schema.Struct({
  action: Schema.Literal("status"),
  team_id: Schema.String.annotate({ description: "The team ID to check status for" }),
})

const ActionClaimTask = Schema.Struct({
  action: Schema.Literal("claim_task"),
  team_id: Schema.String.annotate({ description: "The team ID" }),
  task_id: Schema.String.annotate({ description: "The ID of the task to claim" }),
})

const ActionCompleteTask = Schema.Struct({
  action: Schema.Literal("complete_task"),
  team_id: Schema.String.annotate({ description: "The team ID" }),
  task_id: Schema.String.annotate({ description: "The ID of the task to complete" }),
  result: Schema.String.annotate({ description: "The result or summary of the completed task" }),
})

const Parameters = Schema.Union([ActionCreate, ActionAddTasks, ActionSpawn, ActionStatus, ActionClaimTask, ActionCompleteTask])

export const TeamTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const fs = yield* AppFileSystem.Service
    const inst = yield* InstanceState.context

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: id,
            patterns: ["*"],
            always: ["*"],
            metadata: { action: params.action },
          })

          if (params.action === "create") {
            const team = yield* Team.createTeam(fs, inst.worktree, { leadSessionID: ctx.sessionID })
            return {
              title: "Created team",
              metadata: { teamId: team.id, taskCount: 0 },
              output: [
                `Team created successfully.`,
                `team_id: ${team.id}`,
                ``,
                `Next steps:`,
                `1. Use action "add_tasks" with this team_id to add tasks to the shared list`,
                `2. Use action "spawn" with this team_id to spawn teammate agents`,
                `3. Include the team_id in each teammate's prompt so they can claim tasks and send messages`,
              ].join("\n"),
            }
          }

          if (params.action === "add_tasks") {
            const addedTasks = yield* Effect.forEach(
              params.tasks,
              (task) => Team.addTask(fs, inst.worktree, { teamID: params.team_id, description: task.description }),
              { concurrency: "unbounded" },
            )
            const taskList = addedTasks.map((t) => `- [${t.id}] ${t.description}`).join("\n")
            return {
              title: `Added ${addedTasks.length} tasks`,
              metadata: { teamId: params.team_id, taskCount: addedTasks.length },
              output: [`Added ${addedTasks.length} tasks to team ${params.team_id}:`, taskList].join("\n"),
            }
          }

          if (params.action === "spawn") {
            const next = yield* agent.get(params.agent_type)
            if (!next) return yield* Effect.fail(new Error(`Unknown agent type: ${params.agent_type}`))

            const cfg = yield* config.get()
            const parent = yield* sessions.get(ctx.sessionID)
            const parentAgent = parent.agent
              ? yield* agent.get(parent.agent).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
              : undefined

            const nextSession = yield* sessions.create({
              parentID: ctx.sessionID,
              title: `Team teammate — @${next.name}`,
              permission: [
                ...deriveSubagentSessionPermission({
                  parentSessionPermission: parent.permission ?? [],
                  parentAgent,
                  subagent: next,
                }),
                ...(cfg.experimental?.primary_tools?.map((item) => ({
                  pattern: "*" as const,
                  action: "allow" as const,
                  permission: item,
                })) ?? []),
              ],
            })

            yield* Team.addTeammate(fs, inst.worktree, { teamID: params.team_id, sessionID: nextSession.id })

            const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
            if (!ops) return yield* Effect.fail(new Error("Team tool requires promptOps in ctx.extra"))

            const msg = yield* Effect.sync(() =>
              MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }),
            )
            if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

            const model = next.model ?? {
              modelID: msg.info.modelID,
              providerID: msg.info.providerID,
            }

            const teammatePrompt = [
              params.prompt,
              "",
              "--- TEAM CONTEXT ---",
              `You are a teammate in team ${params.team_id}.`,
              `Your session ID is ${nextSession.id}.`,
              `You have access to the "send_message" tool to message other teammates directly.`,
              `You have access to the "team" tool with action "status" to see available tasks.`,
              "",
              "WORKFLOW:",
              "1. Use the team tool with action 'status' to see available tasks",
              "2. Work on the tasks described in your prompt",
              "3. Use send_message to coordinate with other teammates if needed",
              "4. When done, report your results in your final message",
            ].join("\n")

            const parts = yield* ops.resolvePromptParts(teammatePrompt)

            // Fire and forget — the teammate runs independently (non-blocking)
            yield* ops
              .prompt({
                messageID: MessageID.ascending(),
                sessionID: nextSession.id,
                model: { modelID: model.modelID, providerID: model.providerID },
                agent: next.name,
                tools: {
                  ...(next.permission.some((rule) => rule.permission === "todowrite") ? {} : { todowrite: false }),
                  ...(next.permission.some((rule) => rule.permission === "task") ? {} : { task: false }),
                  ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                },
                parts,
              })
              .pipe(
                Effect.catchCause(() => Effect.void),
                Effect.forkChild(),
              )

            return {
              title: `Spawned @${next.name} teammate`,
              metadata: {
                teamId: params.team_id,
                taskCount: 0,
                sessionId: nextSession.id,
                agent: next.name,
              },
              output: [
                `Spawned teammate @${next.name} with session ${nextSession.id}`,
                `The teammate is now working independently and will process the tasks.`,
                `Use action "status" with team_id "${params.team_id}" to check progress.`,
              ].join("\n"),
            } as any
          }

          if (params.action === "claim_task") {
            const task = yield* Team.claimTask(fs, inst.worktree, {
              teamID: params.team_id,
              taskID: params.task_id,
              sessionID: ctx.sessionID,
            })
            return {
              title: `Claimed task ${params.task_id}`,
              metadata: { teamId: params.team_id, taskId: params.task_id, taskCount: 0 },
              output: `Task ${params.task_id} claimed successfully by ${ctx.sessionID}.`,
            }
          }

          if (params.action === "complete_task") {
            const task = yield* Team.completeTask(fs, inst.worktree, {
              teamID: params.team_id,
              taskID: params.task_id,
              result: params.result,
            })
            return {
              title: `Completed task ${params.task_id}`,
              metadata: { teamId: params.team_id, taskId: params.task_id, taskCount: 0 },
              output: `Task ${params.task_id} marked as completed.`,
            }
          }

          // action === "status"
          const team = yield* Team.getTeam(fs, inst.worktree, params.team_id)
          if (!team) return yield* Effect.fail(new Error(`Team not found: ${params.team_id}`))
          const tasks = yield* Team.listTasks(fs, inst.worktree, params.team_id)

          const pending = tasks.filter((t: any) => t.status === "pending")
          const claimed = tasks.filter((t: any) => t.status === "claimed")
          const done = tasks.filter((t: any) => t.status === "done")
          const errored = tasks.filter((t: any) => t.status === "error")

          const lines: string[] = [
            `Team: ${team.id}`,
            `Lead: ${team.lead}`,
            `Teammates: ${team.teammates.length > 0 ? team.teammates.join(", ") : "(none)"}`,
            "",
            `Tasks: ${tasks.length} total`,
          ]

          if (pending.length > 0) {
            lines.push("", `Pending (${pending.length}):`)
            for (const t of pending) lines.push(`  - [${t.id}] ${t.description}`)
          }
          if (claimed.length > 0) {
            lines.push("", `In Progress (${claimed.length}):`)
            for (const t of claimed) lines.push(`  - [${t.id}] ${t.description} (by ${t.assignee})`)
          }
          if (done.length > 0) {
            lines.push("", `Done (${done.length}):`)
            for (const t of done) {
              lines.push(`  - [${t.id}] ${t.description}`)
              if (t.result) lines.push(`    Result: ${t.result.slice(0, 200)}${t.result.length > 200 ? "..." : ""}`)
            }
          }
          if (errored.length > 0) {
            lines.push("", `Errors (${errored.length}):`)
            for (const t of errored) lines.push(`  - [${t.id}] ${t.description}: ${t.error}`)
          }

          return {
            title: `Team status: ${done.length}/${tasks.length} done`,
            metadata: {
              teamId: params.team_id,
              taskCount: tasks.length,
              total: tasks.length,
              pending: pending.length,
              claimed: claimed.length,
              done: done.length,
              errored: errored.length,
            },
            output: lines.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)
