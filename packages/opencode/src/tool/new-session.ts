import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import DESCRIPTION from "./new-session.txt"

export const Parameters = Schema.Struct({
  initial_message: Schema.String.annotate({
    description: "The message to send as the first user message in the new session",
  }),
})

type Metadata = {}

export const NewSessionTool = Tool.define<typeof Parameters, Metadata, Bus.Service>(
  "new_session",
  Effect.gen(function* () {
    const bus = yield* Bus.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
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
