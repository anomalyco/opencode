export * as ScheduleTool from "./schedule"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { Service as ScheduleService } from "../schedule/service"

export const name = "zero_schedule_task"

export const Input = Schema.Struct({
  cron: Schema.String.annotate({ description: "Cron expression (e.g. '*/5 * * * *') or duration string (e.g. '5m', '1h', '1d')" }),
  command: Schema.String.annotate({ description: "The shell command to execute in the background" }),
})

export const Output = Schema.Struct({
  id: Schema.String,
  success: Schema.Boolean,
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const scheduler = yield* ScheduleService
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description: "Schedule a bash command to run repeatedly in the background at specified cron intervals or durations.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: `Tarefa agendada com ID: ${output.id}` }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: name,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const task = yield* scheduler.create(input.cron, input.command)
              return { id: task.id, success: true }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to schedule task" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
