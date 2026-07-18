import { expect, test } from "bun:test"
import { sessionEpilogue } from "../../src/util/presentation"

test("formats session continuation summary", () => {
  const epilogue = sessionEpilogue({ title: "A session", sessionID: "ses_123" })
  expect(epilogue).toContain("A session")
  expect(epilogue).toContain("kancode -c")
  expect(epilogue).toContain("kancode -s ses_123")
  expect(epilogue).toContain("Continue")
  expect(epilogue).toContain("Session ID")
  expect(epilogue).not.toContain("auto_resume")
  expect(epilogue).not.toContain("▀")
})

test("omits session id line when session id is missing", () => {
  const epilogue = sessionEpilogue({ title: "Untitled" })
  expect(epilogue).toContain("Untitled")
  expect(epilogue).toContain("kancode -c")
  expect(epilogue).not.toContain("kancode -s")
  expect(epilogue).not.toContain("auto_resume")
})
