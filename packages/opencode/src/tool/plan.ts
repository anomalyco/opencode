import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"
import { persistPlanArtifacts } from "../session/plan-persist"
import { canFinalize } from "../session/plan-guard"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"

async function getLastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

async function questionRounds(sessionID: string) {
  let total = 0
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role !== "assistant") continue
    if (item.info.agent !== "plan") continue
    const has = item.parts.some((part) => part.type === "tool" && part.tool === "question")
    if (has) total += 1
  }
  return total
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const absolute = Session.plan(session)
    const relative = path.relative(Instance.worktree, absolute)
    const markdown = await Bun.file(absolute).text()
    const guard = canFinalize(markdown)
    if (!guard.ok) {
      const list = guard.missing.length ? ` Missing sections: ${guard.missing.join(", ")}.` : ""
      const confirm = guard.confirmed ? "" : " Add a 'Confirmed Understanding' section before finalizing."
      throw new Error("Plan is not ready for finalize." + list + confirm)
    }
    const rounds = await questionRounds(ctx.sessionID)
    const { artifact, jsonPath } = await persistPlanArtifacts({
      sessionID: ctx.sessionID,
      planPath: absolute,
      agent: "plan",
      questionRounds: rounds,
    })

    const model = await getLastModel(ctx.sessionID)

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: "build",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: [
        `The plan artifacts are ready at ${relative} and ${path.relative(Instance.worktree, jsonPath)}.`,
        `Plan completeness score: ${artifact.metadata.completeness_score}.`,
        "Switch to build mode and execute the approved plan.",
      ].join("\n"),
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to build agent",
      output: "Plan finalized and build agent selected automatically.",
      metadata: {
        planPath: relative,
        jsonPath: path.relative(Instance.worktree, jsonPath),
      },
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
      metadata: {},
    }
  },
})
