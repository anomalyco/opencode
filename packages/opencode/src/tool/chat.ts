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

export const ChatEnterTool = Tool.define("chat_enter", {
  description: "Use this tool to switch to Chat Mode for isolated tasks in a temporary directory.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const chatDir = Session.chat(session)

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to switch to Chat Mode? You will operate in an isolated temporary directory at ${chatDir}.`,
          header: "Chat Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to Chat Mode for isolated prototyping" },
            { label: "No", description: "Stay in current mode" },
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
      agent: "chat",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: "User has requested to enter Chat Mode. Switch to chat agent and begin isolated operation.",
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to chat agent",
      output: `User confirmed to switch to Chat Mode. A new message has been created to switch you to chat agent. You are now in ${chatDir}.`,
      metadata: {},
    }
  },
})

export const ChatExitTool = Tool.define("chat_exit", {
  description: "Use this tool to exit Chat Mode and return to Build Mode.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Would you like to exit Chat Mode and return to the Build agent?`,
          header: "Build Agent",
          custom: false,
          options: [
            { label: "Yes", description: "Return to build agent" },
            { label: "No", description: "Stay in chat mode" },
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
      agent: "build",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `Chat session complete, returning to build agent.`,
      synthetic: true,
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to build agent",
      output: "User approved switching to build agent. Returning to normal operation.",
      metadata: {},
    }
  },
})

