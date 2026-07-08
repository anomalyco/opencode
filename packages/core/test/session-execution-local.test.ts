import { describe, expect, test } from "bun:test"
import { LLMError, TransportReason } from "@opencode-ai/llm"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { sessionsInterruptedByShutdown, terminal } from "@opencode-ai/core/session/execution/local"
import { SessionV2 } from "@opencode-ai/core/session"
import { UserInterruptedError } from "@opencode-ai/core/session/error"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { Effect, Exit } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Database.node, EventV2.node])))

describe("SessionExecutionLocal lifecycle", () => {
  test("classifies success and typed failure terminals", () => {
    expect(terminal(Exit.succeed(undefined))).toEqual({ type: "succeeded" })
    expect(
      terminal(
        Exit.fail(
          new LLMError({
            module: "test",
            method: "stream",
            reason: new TransportReason({ message: "Disconnected" }),
          }),
        ),
      ),
    ).toEqual({ type: "failed", error: { type: "provider.transport", message: "Disconnected" } })
    const storage = new ToolOutputStore.StorageError({ operation: "encode", cause: new Error("invalid output") })
    expect(terminal(Exit.fail(storage))).toEqual({
      type: "failed",
      error: { type: "unknown", message: storage.message },
    })
  })

  test("defaults owner-scope interruption to shutdown and preserves explicit reasons", () => {
    const interrupted = Effect.runSyncExit(Effect.interrupt)
    expect(terminal(interrupted)).toEqual({ type: "interrupted", reason: "shutdown" })
    expect(terminal(interrupted, "user")).toEqual({ type: "interrupted", reason: "user" })
    expect(terminal(interrupted, "superseded")).toEqual({ type: "interrupted", reason: "superseded" })
    expect(terminal(Exit.fail(new UserInterruptedError()))).toEqual({ type: "interrupted", reason: "user" })
  })

  it.effect("selects only sessions whose latest execution ended for shutdown", () =>
    Effect.gen(function* () {
      const events = yield* EventV2.Service
      const { db } = yield* Database.Service
      const recover = SessionV2.ID.make("ses_recover")
      const completed = SessionV2.ID.make("ses_completed")
      const user = SessionV2.ID.make("ses_user")
      const crashed = SessionV2.ID.make("ses_crashed")

      yield* events.publish(SessionEvent.Execution.Started, { sessionID: recover })
      yield* events.publish(SessionEvent.Execution.Interrupted, { sessionID: recover, reason: "shutdown" })
      yield* events.publish(SessionEvent.InstructionsUpdated, { sessionID: recover, text: "later non-lifecycle event" })
      yield* events.publish(SessionEvent.Execution.Interrupted, { sessionID: completed, reason: "shutdown" })
      yield* events.publish(SessionEvent.Execution.Started, { sessionID: completed })
      yield* events.publish(SessionEvent.Execution.Succeeded, { sessionID: completed })
      yield* events.publish(SessionEvent.Execution.Interrupted, { sessionID: user, reason: "user" })
      yield* events.publish(SessionEvent.Execution.Started, { sessionID: crashed })

      expect(yield* sessionsInterruptedByShutdown(db)).toEqual([recover])
    }),
  )
})
