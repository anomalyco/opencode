import { Tool } from "./tool"
import DESCRIPTION from "./task.txt"
import z from "zod"
import { Session } from "../session"
import { SessionID, MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Agent } from "../agent/agent"
import { SessionPrompt } from "../session/prompt"
import { iife } from "@/util/iife"
import { defer } from "@/util/defer"
import { Config } from "../config/config"
import { Permission } from "@/permission"
import { Team } from "../team"
import { TeamID } from "../team/schema"
import { Instance } from "@/project/instance"
import { SessionInject } from "@/session/inject"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool.task" })

/** Tracks active background agent count per instance for concurrency limiting */
let running = 0

const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z
    .string()
    .describe(
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
    )
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
  background: z
    .boolean()
    .describe(
      "If true, the agent runs in the background and returns immediately with the task_id. Use this with team_id for parallel multi-agent workflows.",
    )
    .optional(),
  team_id: z
    .string()
    .describe(
      "The team ID to register this agent as a member. Required when background is true for team-based workflows.",
    )
    .optional(),
})

export const TaskTool = Tool.define("task", async (ctx) => {
  const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))

  // Filter agents by permissions if agent provided
  const caller = ctx?.agent
  const accessibleAgents = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  const list = accessibleAgents.toSorted((a, b) => a.name.localeCompare(b.name))

  const description = DESCRIPTION.replace(
    "{agents}",
    list
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
  return {
    description,
    parameters,
    async execute(params: z.infer<typeof parameters>, ctx) {
      const config = await Config.get()

      // Skip permission check when user explicitly invoked via @ or command subtask
      if (!ctx.extra?.bypassAgentCheck) {
        await ctx.ask({
          permission: "task",
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const agent = await Agent.get(params.subagent_type)
      if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`)

      const hasTaskPermission = agent.permission.some((rule) => rule.permission === "task")

      // Build permission overrides for child session
      const childPermissions = [
        {
          permission: "todowrite" as const,
          pattern: "*" as const,
          action: "deny" as const,
        },
        {
          permission: "todoread" as const,
          pattern: "*" as const,
          action: "deny" as const,
        },
        ...(hasTaskPermission
          ? []
          : [
              {
                permission: "task" as const,
                pattern: "*" as const,
                action: "deny" as const,
              },
            ]),
        ...(config.experimental?.primary_tools?.map((t) => ({
          pattern: "*" as const,
          action: "allow" as const,
          permission: t,
        })) ?? []),
      ]

      // For team members, grant team communication permissions
      if (params.team_id) {
        childPermissions.push(
          { permission: "send_message", pattern: "*", action: "allow" },
          { permission: "team_task", pattern: "*", action: "allow" },
        )
      }

      const session = await iife(async () => {
        if (params.task_id) {
          const found = await Session.get(SessionID.make(params.task_id)).catch(() => {})
          if (found) return found
        }

        return await Session.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${agent.name} subagent)`,
          permission: childPermissions,
        })
      })

      // Register as team member if team_id provided
      if (params.team_id) {
        const teamID = TeamID.make(params.team_id)
        Team.addMember({
          teamID,
          sessionID: session.id,
          agent: agent.name,
        })
      }

      const msg = await MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID })
      if (msg.info.role !== "assistant") throw new Error("Not an assistant message")

      const model = agent.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
          background: params.background,
          teamID: params.team_id,
        },
      })

      const messageID = MessageID.ascending()
      const promptParts = await SessionPrompt.resolvePromptParts(params.prompt)

      const promptInput = {
        messageID,
        sessionID: session.id,
        model: {
          modelID: model.modelID,
          providerID: model.providerID,
        },
        agent: agent.name,
        tools: {
          todowrite: false,
          todoread: false,
          ...(hasTaskPermission ? {} : { task: false }),
          ...Object.fromEntries((config.experimental?.primary_tools ?? []).map((t) => [t, false])),
        },
        parts: promptParts,
      }

      // Background execution — launch and return immediately
      if (params.background) {
        const limit = config.team?.max_agents ?? 10
        if (running >= limit) {
          throw new Error(
            `Max concurrent background agents reached (${limit}). Wait for existing agents to complete or increase team.max_agents in config.`,
          )
        }

        running++
        const teamID = params.team_id ? TeamID.make(params.team_id) : undefined
        const bound = Instance.bind(() => {
          SessionPrompt.prompt(promptInput)
            .catch(async (err) => {
              log.error("background agent failed", {
                sessionID: session.id,
                agent: agent.name,
                error: err,
              })
              if (teamID) {
                Team.failMember({
                  teamID,
                  sessionID: session.id,
                  agent: agent.name,
                })
                // Notify the lead about the failure
                const lead = Team.leadSession(teamID)
                if (lead) {
                  await SessionInject.send({
                    sessionID: lead.sessionID,
                    from: agent.name,
                    fromSessionID: session.id,
                    content: `[AGENT FAILURE] @${agent.name} crashed with error: ${err instanceof Error ? err.message : String(err)}`,
                    teamID: params.team_id,
                  }).catch((e) => log.error("failed to notify lead of agent failure", { error: e }))
                }
              }
            })
            .finally(() => {
              running--
            })
        })
        bound()

        // Wire up abort to cancel the child session
        function cancel() {
          SessionPrompt.cancel(session.id)
        }
        ctx.abort.addEventListener("abort", cancel)

        return {
          title: `${params.description} (background)`,
          metadata: {
            sessionId: session.id,
            model,
            background: true,
            teamID: params.team_id,
          },
          output: [
            `task_id: ${session.id} (background agent launched)`,
            "",
            `Agent @${agent.name} is now running in the background.`,
            params.team_id ? `Registered as member of team ${params.team_id}.` : "",
            "The agent will send messages via SendMessage when it has findings.",
          ]
            .filter(Boolean)
            .join("\n"),
        }
      }

      // Synchronous execution — existing behavior
      function cancel() {
        SessionPrompt.cancel(session.id)
      }
      ctx.abort.addEventListener("abort", cancel)
      using _ = defer(() => ctx.abort.removeEventListener("abort", cancel))

      const result = await SessionPrompt.prompt(promptInput)

      const text = result.parts.findLast((x) => x.type === "text")?.text ?? ""

      const output = [
        `task_id: ${session.id} (for resuming to continue this task if needed)`,
        "",
        "<task_result>",
        text,
        "</task_result>",
      ].join("\n")

      return {
        title: params.description,
        metadata: {
          sessionId: session.id,
          model,
        },
        output,
      }
    },
  }
})
