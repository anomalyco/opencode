import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"

async function getLastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export const GuideEnterTool = Tool.define("guide_enter", {
  description: "Switch to guide mode for interactive onboarding. Guide mode will ask discovery questions to understand what you want to build and teach you vibe coding principles.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: "Would you like to switch to guide mode for a guided, step-by-step onboarding experience?",
          header: "Guide Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to guide mode for interactive discovery and learning" },
            { label: "No", description: "Stay with current agent" },
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
      agent: "guide",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: "User has requested to enter guide mode. Switch to guide mode and begin the discovery process. Ask questions to understand what they want to build.",
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to guide mode",
      output: "User confirmed to switch to guide mode. Guide agent will help with discovery and onboarding.",
      metadata: {},
    }
  },
})

export const GuideExitTool = Tool.define("guide_exit", {
  description: "Exit guide mode and switch to plan or build mode after discovery is complete.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: "Discovery complete! What would you like to do next?",
          header: "Guide Complete",
          custom: false,
          options: [
            { label: "Create Plan", description: "Switch to plan mode to create a detailed implementation plan" },
            { label: "Start Coding", description: "Switch to build mode and start implementing" },
            { label: "Continue Guide", description: "Stay in guide mode to refine the discovery" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    
    if (answer === "Continue Guide") throw new Question.RejectedError()

    const model = await getLastModel(ctx.sessionID)
    const targetAgent = answer === "Create Plan" ? "plan" : "build"

    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: {
        created: Date.now(),
      },
      agent: targetAgent,
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `Discovery is complete. Switching to ${targetAgent} mode to continue with ${answer === "Create Plan" ? "planning" : "implementation"}.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: `Switching to ${targetAgent} mode`,
      output: `Discovery phase complete. Transitioning to ${targetAgent} mode for ${answer === "Create Plan" ? "planning" : "implementation"}.`,
      metadata: {},
    }
  },
})
