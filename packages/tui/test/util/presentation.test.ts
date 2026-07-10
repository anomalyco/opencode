import { expect, test } from "bun:test"
import { sessionEpilogue } from "../../src/util/presentation"

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123", mode: "dark" })
  expect(epilogue).toContain("\x1b[38;2;159;108;69m███    ███")
  expect(epilogue).toContain("A session")
  expect(epilogue).toContain("mammouth -s ses_123")
})
