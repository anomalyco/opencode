import { Session } from "@opencode/schema/session"
import { expect, test } from "bun:test"
import { sessionEpilogue } from "../../src/util/presentation"

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({
    title: "A session",
    sessionID: Session.ID.make("ses_123", { disableChecks: true }),
  })
  expect(epilogue).toContain("A session")
  expect(epilogue).toContain("opencode -s ses_123")
})
