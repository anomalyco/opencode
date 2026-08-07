import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionsQuery } from "../src/sessions-query.js"
import { SessionMessagesCursor } from "../src/session-messages-cursor.js"
import { SessionMessage } from "../src/session-message.js"
import { Session } from "../src/session.js"

describe("SessionsQuery.Cursor", () => {
  test("round trips without Node globals", async () => {
    const input = {
      workspace: undefined,
      search: "protocol",
      order: "desc" as const,
      anchor: { id: Session.ID.make("ses_test"), time: 1, direction: "next" as const },
    }
    const cursor = SessionsQuery.Cursor.make(input)

    expect(await Effect.runPromise(SessionsQuery.Cursor.parse(cursor))).toEqual(input)
  })
})

describe("SessionMessagesCursor", () => {
  test("round trips", async () => {
    const input = {
      id: SessionMessage.ID.make("msg_test"),
      order: "desc" as const,
      direction: "next" as const,
    }
    const cursor = SessionMessagesCursor.make(input)

    expect(await Effect.runPromise(SessionMessagesCursor.parse(cursor))).toEqual(input)
  })
})
