import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import {
  SessionHistoryCursor,
  SessionHistoryCursorInternal,
  SessionHistoryQuery,
  SessionsCursor,
} from "../src/groups/session"
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
  test("constructs an initial durable checkpoint without a cutoff", async () => {
    const cursor = SessionHistoryCursor.after(1)

    expect(String(cursor)).toBe("eyJhZnRlciI6MX0")
    expect(await Effect.runPromise(SessionHistoryCursor.parse(cursor))).toEqual({ after: 1 })
  })

  test("round trips an empty aggregate continuation", async () => {
    const cursor = SessionHistoryCursorInternal.next(-1, -1)

    expect(await Effect.runPromise(SessionHistoryCursor.parse(cursor))).toEqual({ after: -1, through: -1 })
  })

  test("exposes cursor as the sole optional position", () => {
    expect(Schema.is(SessionHistoryQuery)({})).toBe(true)
    expect(Schema.is(SessionHistoryQuery)({ cursor: SessionHistoryCursor.after(0) })).toBe(true)
    expect("after" in SessionHistoryQuery.fields).toBe(false)
  })

  test("fails malformed cursors in the typed channel", async () => {
    const error = await Effect.runPromise(SessionHistoryCursor.parse("malformed").pipe(Effect.flip))

    expect(error).toBeDefined()
  })
})
