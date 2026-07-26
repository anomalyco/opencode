import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import DESCRIPTION from "./task-return.txt"

const Parameters = Schema.Struct({
  result: Schema.Record(Schema.String, Schema.Any).annotate({
    description: "Structured result for the parent/orchestrator. Free-form JSON, max 4KB serialized.",
  }),
})

export const TASK_RETURN_MAX_BYTES = 4096

type Metadata = {
  result?: Schema.Schema.Type<typeof Parameters>["result"]
}

export const TaskReturnTool = Tool.define<typeof Parameters, Metadata, Session.Service>(
  "task_return",
  Effect.gen(function* () {
    const sessions = yield* Session.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.suspend(() => {
          const bytes = Buffer.byteLength(JSON.stringify(params.result), "utf8")
          if (bytes > TASK_RETURN_MAX_BYTES)
            return Effect.die(
              new Error(`result is ${bytes} bytes; cap is ${TASK_RETURN_MAX_BYTES}. Trim it.`),
            )
          return Effect.gen(function* () {
            const session = yield* sessions.get(ctx.sessionID)
            if (!session.parentID)
              return {
                title: "task_return",
                metadata: {},
                output: "no parent session; result not recorded (task_return is for subagent sessions)",
              }
            yield* sessions.setResult({ sessionID: ctx.sessionID, result: params.result })
            return {
              title: "task_return",
              metadata: { result: params.result },
              output: JSON.stringify(params.result, null, 2),
            }
          })
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
