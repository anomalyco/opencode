import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { SessionHistoryCursor, SessionHistoryQuery, SessionsCursor } from "../src/groups/session"
import { Session } from "@opencode-ai/schema/session"

describe("SessionsCursor", () => {
  test("round trips without Node globals", async () => {
    const input = {
      workspace: undefined,
      search: "protocol",
      order: "desc" as const,
      anchor: { id: Session.ID.make("ses_test"), time: 1, direction: "next" as const },
    }
    const cursor = SessionsCursor.make(input)

    expect(await Effect.runPromise(SessionsCursor.parse(cursor))).toEqual(input)
  })
})

describe("SessionHistoryCursor", () => {
  test("round trips the empty aggregate head", async () => {
    const cursor = SessionHistoryCursor.make({ after: -1, through: -1 })

    expect(await Effect.runPromise(SessionHistoryCursor.parse(cursor))).toEqual({ after: -1, through: -1 })
  })

  test("rejects combining after with cursor", () => {
    const cursor = SessionHistoryCursor.make({ after: 1, through: 2 })

    expect(Schema.is(SessionHistoryQuery)({ after: 0, cursor })).toBe(false)
  })

  test("fails malformed cursors in the typed channel", async () => {
    const error = await Effect.runPromise(SessionHistoryCursor.parse("malformed").pipe(Effect.flip))

    expect(error).toBeDefined()
  })
})
