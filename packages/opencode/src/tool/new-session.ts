import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import DESCRIPTION from "./new-session.txt"

const parameters = z.object({
  initial_message: z.string().describe("The message to send as the first user message in the new session"),
})

type Metadata = {}

export const NewSessionTool = Tool.define<typeof parameters, Metadata, Bus.Service>(
  "new_session",
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (args: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* bus.publish(TuiEvent.SessionNew, {
            message: args.initial_message,
            sessionID: ctx.sessionID,
          })

          return {
            title: "Starting new session",
            metadata: {},
            output: `New session requested with message: "${args.initial_message}". Current session will be terminated.`,
          }
        }),
    }
  }),
)
