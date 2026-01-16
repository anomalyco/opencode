import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import { Agent } from "../agent/agent"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"

/**
 * Resolve target agent for plan_exit.
 * Prefers "build" if available, otherwise falls back to default_agent or first visible primary.
 * Exported for testing.
 */
export async function resolveImplementationAgent(): Promise<string> {
  const build = await Agent.get("build")
  if (build && Agent.isPrimaryVisible(build)) return "build"

  const agents = await Agent.list()
  const defaultName = await Agent.defaultAgent().catch(() => undefined)

  // Prefer default_agent if it's a usable implementation agent (not plan, not subagent, not hidden)
  if (defaultName && defaultName !== "plan") {
    const agent = agents.find((a) => a.name === defaultName)
    if (agent && Agent.isPrimaryVisible(agent)) return defaultName
  }

  // Fallback: first visible primary agent that is not "plan"
  const fallback = agents.find((a) => Agent.isPrimaryVisible(a) && a.name !== "plan")
  if (fallback) return fallback.name

  // Last resort: use defaultAgent result even if it's "plan"
  return defaultName ?? "plan"
}

async function getLastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))
    const target = await resolveImplementationAgent()

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Plan at ${plan} is complete. Would you like to switch to the ${target} agent and start implementing?`,
          header: "Switch Agent",
          custom: false,
          options: [
            { label: "Yes", description: `Switch to ${target} agent and start implementing the plan` },
            { label: "No", description: "Stay with plan agent to continue refining the plan" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: target,
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: `Switching to ${target} agent`,
      output: `User approved switching to ${target} agent. Wait for further instructions.`,
      metadata: { agent: target },
    }
  },
})

export const PlanEnterTool = Tool.define("plan_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = path.relative(Instance.worktree, Session.plan(session))

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to switch to the plan agent and create a plan saved to ${plan}?`,
          header: "Plan Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to plan agent for research and planning" },
            { label: "No", description: "Stay with build agent to continue making changes" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]

    if (answer === "No") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "plan",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: "User has requested to enter plan mode. Switch to plan mode and begin planning.",
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to plan agent",
      output: `User confirmed to switch to plan mode. A new message has been created to switch you to plan mode. The plan file will be at ${plan}. Begin planning.`,
      metadata: { agent: "plan" },
    }
  },
})
