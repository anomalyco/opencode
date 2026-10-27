import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Session } from "../src/session.js"

describe("Session.ListCursor", () => {
  test("round trips without Node globals", async () => {
    const input = {
      search: "protocol",
      order: "desc" as const,
      anchor: { id: Session.ID.make("ses_test"), time: 1, direction: "next" as const },
    }
    const cursor = Session.ListCursor.make(input)

    expect(await Effect.runPromise(Session.ListCursor.parse(cursor))).toEqual(input)
  })
})
