import { describe, expect, test } from "bun:test"
import { LLMError, TransportReason } from "@opencode-ai/llm"
import { terminal } from "@opencode-ai/core/session/execution/local"
import { UserInterruptedError } from "@opencode-ai/core/session/error"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { Effect, Exit } from "effect"

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
})
