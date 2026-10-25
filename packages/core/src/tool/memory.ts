import { Effect } from "effect"
import { MemoryControls } from "@bolt-ai/memory/controls"
import { MemoryService } from "@bolt-ai/memory/effect/service"
import { MemoryTool } from "@bolt-ai/memory/tool"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "@/session/session"
import * as Tool from "./tool"

const memory = MemoryService.make()

export const MemorySaveTool = Tool.define(
  "memory_save",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return {
      description: MemoryTool.SaveDescription,
      parameters: MemoryTool.SaveParameters,
      execute: (params: MemoryTool.SaveParams, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          // A session that opted out of contribution via the /memory controls never writes memory.
          if (!MemoryControls.contribute(info.metadata))
            return {
              title: "Bolt memory: off for this session",
              output: "Memory contribution is turned off for this session. Turn it back on with /memory contribute on.",
              metadata: { sources: [] },
            }
          const instance = yield* InstanceState.context
          return yield* MemoryTool.save({
            memory,
            params,
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            ctx: instance,
            ask: (input) => ctx.ask(input),
          }).pipe(
            Effect.catchIf(MemoryTool.failure, (err) => Effect.succeed(MemoryTool.error("save", err))),
            Effect.orDie,
          )
        }),
    }
  }),
)

export const MemoryRecallTool = Tool.define(
  "memory_recall",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return {
      description: MemoryTool.RecallDescription,
      parameters: MemoryTool.RecallParameters,
      execute: (params: MemoryTool.RecallParams, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* sessions.get(ctx.sessionID).pipe(Effect.orDie)
          if (!MemoryControls.use(info.metadata))
            return {
              title: "Bolt memory: off for this session",
              output: "Memory use is turned off for this session. Turn it back on with /memory use on.",
              metadata: { sources: [], count: 0 },
            }
          const instance = yield* InstanceState.context
          return yield* MemoryTool.recall({
            memory,
            params,
            sessionID: ctx.sessionID,
            ctx: instance,
            ask: (input) => ctx.ask(input),
          }).pipe(
            Effect.catchIf(MemoryTool.failure, (err) => Effect.succeed(MemoryTool.error("recall", err))),
            Effect.orDie,
          )
        }),
    }
  }),
)
