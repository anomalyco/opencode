import { Tool } from "./tool"
import DESCRIPTION from "./team.txt"
import z from "zod"
import { Session } from "../session"
import { Team, SessionPromptState } from "../team"
import { TeamMessage } from "../team/message"
import { TeamTask } from "../team/task"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { Identifier } from "../id/id"
import { Bus } from "../bus"
import { Provider } from "../provider/provider"
import { Log } from "@/util/log"
import type { MessageV2 } from "../session/message-v2"

const log = Log.create({ service: "team" })

const TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const pending = new Map<string, Promise<string>>()

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Teammate timed out")), ms)
  })
  return Promise.race([promise, timeout])
}

const parameters = z.object({
  action: z
    .enum(["create", "spawn", "message", "broadcast", "tasks", "status", "wait", "shutdown", "cleanup"])
    .describe("The team action to perform"),
  name: z.string().optional().describe("Team name (for create) or display name (for spawn)"),
  agent: z.string().optional().describe("Agent type for the teammate, e.g. 'build', 'plan' (for spawn)"),
  prompt: z.string().optional().describe("Initial prompt/task for the teammate (for spawn)"),
  to: z.string().optional().describe("Target session ID (for message)"),
  content: z.string().optional().describe("Message content (for message/broadcast)"),
  sub_action: z.enum(["create", "claim", "complete", "list"]).optional().describe("Task sub-action (for tasks)"),
  title: z.string().optional().describe("Task title (for tasks.create)"),
  description: z.string().optional().describe("Task description (for tasks.create)"),
  depends_on: z.array(z.string()).optional().describe("Task IDs this depends on (for tasks.create)"),
  task_id: z.string().optional().describe("Task ID (for tasks.claim/complete)"),
  session_id: z.string().optional().describe("Teammate session ID (for shutdown)"),
})

export const TeamTool = Tool.define("team", async () => {
  return {
    description: DESCRIPTION,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const session = await Session.get(ctx.sessionID)

      function out(title: string, output: string, extra?: Record<string, any>) {
        return { title, metadata: extra ?? {}, output }
      }

      switch (params.action) {
        case "create": {
          if (!params.name) throw new Error("name is required for create action")
          if (session.teamID) throw new Error("This session is already in a team")
          const team = await Team.create({
            name: params.name,
            sessionID: ctx.sessionID,
          })
          return out(
            `Created team: ${params.name}`,
            `Team "${params.name}" created (ID: ${team.id}). You are the lead.\n\nWorkflow:\n1. Use spawn (multiple times) to add teammates - they start working immediately in parallel\n2. Use wait to block until all teammates finish and collect their results\n3. Use message/broadcast to communicate with teammates\n4. Use cleanup when done`,
            { teamID: team.id },
          )
        }

        case "spawn": {
          if (!params.agent) throw new Error("agent is required for spawn action")
          if (!params.prompt) throw new Error("prompt is required for spawn action")
          const team = await requireTeam(session)
          if (session.teamRole !== "lead") throw new Error("Only the lead can spawn teammates")

          const agent = await Agent.get(params.agent)
          if (!agent) throw new Error(`Unknown agent type: ${params.agent}`)

          const title = params.name ?? `Teammate - ${params.agent}`
          const teammate = await Session.create({
            title,
            teamID: team.id,
            teamRole: "member",
            permission: [
              { permission: "team", pattern: "create", action: "deny" },
              { permission: "team", pattern: "cleanup", action: "deny" },
              { permission: "team", pattern: "shutdown", action: "deny" },
              { permission: "team", pattern: "wait", action: "deny" },
            ],
          })
          await Team.join(team.id, teammate.id)

          // Auto-create and claim task for the teammate
          const taskID = await TeamTask.create({
            teamID: team.id,
            title,
            description: params.prompt,
          })
          await TeamTask.claim(taskID, teammate.id)

          const model = agent.model ?? (await Provider.defaultModel())

          const promise = withTimeout(
            runTeammate({
              sessionID: teammate.id,
              teamID: team.id,
              model,
              agentName: agent.name,
              prompt: params.prompt,
              taskID,
            }),
            TIMEOUT_MS,
          )
          pending.set(teammate.id, promise)

          return out(
            `Spawned teammate: ${title}`,
            `Teammate "${title}" spawned (session: ${teammate.id}, agent: ${params.agent}). Working on: ${params.prompt}\n\nThe teammate is running in parallel. Spawn more teammates or use 'wait' to collect all results.`,
            { sessionID: teammate.id },
          )
        }

        case "wait": {
          const team = await requireTeam(session)
          const members = await Team.members(team.id)
          const teammates = members.filter((m) => m.team_role === "member")

          if (teammates.length === 0) return out("No teammates", "No teammates to wait for.")

          const results: string[] = []
          for (const m of teammates) {
            const p = pending.get(m.id)
            if (p) {
              const text = await p
              pending.delete(m.id)
              results.push(`### ${m.title} (${m.id})\n${text}`)
            } else if (SessionPromptState.isRunning(m.id)) {
              results.push(`### ${m.title} (${m.id})\n(still running, no pending promise)`)
            } else {
              results.push(`### ${m.title} (${m.id})\n(already idle)`)
            }
          }

          return out(`Collected ${results.length} teammate results`, results.join("\n\n"))
        }

        case "message": {
          if (!params.to) throw new Error("to is required for message action")
          if (!params.content) throw new Error("content is required for message action")
          const team = await requireTeam(session)
          await TeamMessage.send({
            teamID: team.id,
            fromSessionID: ctx.sessionID,
            toSessionID: params.to,
            content: params.content,
          })
          if (!SessionPromptState.isRunning(params.to)) {
            const reply = await wakeForMessage(params.to, team.id)
            return out("Message sent & reply received", `Message sent to ${params.to}.\n\nReply:\n${reply}`)
          }
          return out("Message sent", `Message sent to ${params.to}. (teammate is busy, will process when ready)`)
        }

        case "broadcast": {
          if (!params.content) throw new Error("content is required for broadcast action")
          const team = await requireTeam(session)
          await TeamMessage.broadcast({
            teamID: team.id,
            fromSessionID: ctx.sessionID,
            content: params.content,
          })
          const members = await Team.members(team.id)
          const idle = members.filter((m) => m.id !== ctx.sessionID && !SessionPromptState.isRunning(m.id))
          const replies: string[] = []
          await Promise.all(
            idle.map(async (m) => {
              const reply = await wakeForMessage(m.id, team.id)
              if (reply) replies.push(`[${m.title}]: ${reply}`)
            }),
          )
          const body =
            replies.length > 0
              ? `Broadcast sent. Replies from idle teammates:\n${replies.join("\n\n")}`
              : "Broadcast sent to all teammates. Active teammates will process when ready."
          return out("Broadcast sent", body)
        }

        case "tasks": {
          if (!params.sub_action) throw new Error("sub_action is required for tasks action")
          const team = await requireTeam(session)
          switch (params.sub_action) {
            case "create": {
              if (!params.title) throw new Error("title is required for task creation")
              const id = await TeamTask.create({
                teamID: team.id,
                title: params.title,
                description: params.description,
                depends_on: params.depends_on,
              })
              return out(`Created task: ${params.title}`, `Task created (ID: ${id}): ${params.title}`, { taskID: id })
            }
            case "claim": {
              if (!params.task_id) throw new Error("task_id is required")
              const task = await TeamTask.claim(params.task_id, ctx.sessionID)
              return out(`Claimed task: ${task.title}`, `Task claimed: ${task.title} (${task.id})`, { taskID: task.id })
            }
            case "complete": {
              if (!params.task_id) throw new Error("task_id is required")
              const task = await TeamTask.complete(params.task_id, ctx.sessionID)
              return out(`Completed task: ${task.title}`, `Task completed: ${task.title} (${task.id})`, {
                taskID: task.id,
              })
            }
            case "list": {
              const tasks = TeamTask.list(team.id)
              const lines = tasks.map(
                (t) => `- [${t.status}] ${t.title} (${t.id})${t.assigned_to ? ` → ${t.assigned_to}` : ""}`,
              )
              return out("Task list", tasks.length > 0 ? lines.join("\n") : "No tasks in the team.", {
                count: tasks.length,
              })
            }
          }
          throw new Error(`Unknown tasks sub_action`)
        }

        case "status": {
          const team = await requireTeam(session)
          const info = await Team.status(team.id)
          const memberLines = info.members.map(
            (m) =>
              `- ${m.title} (${m.id}) [${m.team_role}] ${SessionPromptState.isRunning(m.id) ? "🟢 active" : "⚪ idle"}`,
          )
          return out(
            "Team status",
            [
              `Team: ${info.name} (${info.id})`,
              `Status: ${info.status}`,
              `Members (${info.members.length}):`,
              ...memberLines,
              `Tasks: ${info.tasks.total} total, ${info.tasks.pending} pending, ${info.tasks.in_progress} in progress, ${info.tasks.completed} completed`,
            ].join("\n"),
          )
        }

        case "shutdown": {
          if (!params.session_id) throw new Error("session_id is required for shutdown action")
          const team = await requireTeam(session)
          if (session.teamRole !== "lead") throw new Error("Only the lead can shut down teammates")
          SessionPrompt.cancel(params.session_id)
          pending.delete(params.session_id)
          return out(
            `Shutdown requested: ${params.session_id}`,
            `Shutdown signal sent to ${params.session_id}. They will finish their current work and stop.`,
          )
        }

        case "cleanup": {
          const team = await requireTeam(session)
          await Team.cleanup(team.id, ctx.sessionID)
          for (const [id] of pending) pending.delete(id)
          return out("Team cleaned up", `Team "${team.name}" has been archived and cleaned up.`)
        }
      }
    },
  }
})

async function requireTeam(session: Session.Info) {
  if (!session.teamID) throw new Error("This session is not in a team. Use 'create' first.")
  return Team.get(session.teamID)
}

async function runTeammate(input: {
  sessionID: string
  teamID: string
  model: { modelID: string; providerID: string }
  agentName: string
  prompt: string
  taskID?: string
}): Promise<string> {
  SessionPromptState.mark(input.sessionID)
  const resp = await SessionPrompt.prompt({
    messageID: Identifier.ascending("message"),
    sessionID: input.sessionID,
    model: input.model,
    agent: input.agentName,
    tools: {},
    parts: [{ type: "text", text: input.prompt }],
  }).finally(() => {
    SessionPromptState.unmark(input.sessionID)
    // Auto-complete spawned task (must be before reassign)
    if (input.taskID) {
      TeamTask.complete(input.taskID, input.sessionID).catch((err) => {
        log.warn("failed to complete task", { taskID: input.taskID, error: String(err) })
      })
    }
    TeamTask.reassign(input.sessionID)
  })
  const text = resp.parts.findLast((x) => x.type === "text")?.text ?? ""
  return text || "(teammate produced no text output)"
}

async function wakeForMessage(sessionID: string, teamID: string): Promise<string> {
  const { MessageV2 } = await import("../session/message-v2")
  const msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
  const last = msgs.findLast((m) => m.info.role === "user")
  if (!last) return ""

  const isUserMessage = (msg: MessageV2.Info): msg is MessageV2.User => msg.role === "user"
  const model = isUserMessage(last.info) ? last.info.model : await Provider.defaultModel()
  const agentName = last.info.agent ?? "build"

  const pendingMsgs = TeamMessage.pending(sessionID, teamID)
  if (pendingMsgs.length === 0) return ""

  const text = pendingMsgs.map((m) => `[Team message from ${m.from_session_id}]: ${m.content}`).join("\n")
  TeamMessage.markRead(pendingMsgs.map((m) => m.id))

  SessionPromptState.mark(sessionID)
  const resp = await SessionPrompt.prompt({
    messageID: Identifier.ascending("message"),
    sessionID,
    model,
    agent: agentName,
    tools: {},
    parts: [{ type: "text", text }],
  }).finally(() => {
    SessionPromptState.unmark(sessionID)
    TeamTask.reassign(sessionID)
  })
  return resp.parts.findLast((x) => x.type === "text")?.text ?? ""
}
