import z from "zod"
import { Tool } from "./tool"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import DESCRIPTION from "./new-session.txt"

export const NewSessionTool = Tool.define("new_session", {
  description: DESCRIPTION,
  parameters: z.object({
    initial_message: z.string().describe("The message to send as the first user message in the new session"),
  }),
  async execute(args, ctx) {
    await Bus.publish(TuiEvent.SessionNew, {
      message: args.initial_message,
      sessionID: ctx.sessionID,
    })

    return {
      title: "Starting new session",
      metadata: {},
      output: `New session requested with message: "${args.initial_message}". Current session will be terminated.`,
    }
  },
})
