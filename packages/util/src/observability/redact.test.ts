import { expect, test } from "bun:test"
import { redact } from "./redact.js"

test("redacts an authorization header value", () => {
  expect(redact('authorization: "Bearer xpl_d2b4examplekeyvalue1234"')).toBe('authorization: "Bearer [redacted]"')
  expect(redact("Authorization=Bearer abcdefghijklmnopqrstuvwxyz")).toBe("Authorization=Bearer [redacted]")
})

test("redacts a bare bearer token", () => {
  expect(redact("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9payload")).toBe("Bearer [redacted]")
})

test("keeps the key prefix so the credential is still identifiable", () => {
  expect(redact("apiKey=xpl_d2b4examplekeyvalue1234")).toBe("apiKey=xpl-[redacted]")
  expect(redact("value sk-abcdefghijklmnopqrstuvwxyz012345")).toBe("value sk-[redacted]")
})

test("leaves ordinary log content untouched", () => {
  const line = "sessionID=ses_f2aa7c5b1ffe7EQF1QgXwUymmD cause=table session_inbox has no column named type"
  expect(redact(line)).toBe(line)
})
