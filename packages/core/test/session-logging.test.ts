import { describe, expect, test } from "bun:test"
import { Cause, Effect, Logger } from "effect"
import { logFailure } from "@opencode-ai/core/session/logging"
import { SessionSchema } from "@opencode-ai/core/session/schema"

describe("Session logging", () => {
  test("renders a Session drain cause", async () => {
    const entries: Array<ReturnType<typeof Logger.formatStructured.log>> = []
    const logger = Logger.formatStructured.pipe(
      Logger.map((entry): void => {
        entries.push(entry)
      }),
    )

    await logFailure(
      "Failed to drain Session",
      SessionSchema.ID.make("session-123"),
      Cause.fail({ _tag: "SessionFailure", detail: { code: "nested-code" } }),
    ).pipe(Effect.provide(Logger.layer([logger])), Effect.runPromise)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.message).toBe("Failed to drain Session")
    expect(entries[0]?.annotations).toEqual({ sessionID: "session-123" })
    expect(entries[0]?.cause).toContain("SessionFailure")
    expect(entries[0]?.cause).toContain("nested-code")
    expect(entries[0]?.cause).not.toContain("[Object")
  })
})
