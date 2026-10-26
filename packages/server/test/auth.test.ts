import { expect, test } from "bun:test"
import { ServerAuth } from "@opencode/server/auth"
import { Option, Redacted } from "effect"

test("passwords require the configured username", () => {
  const config = { password: Option.some("secret"), username: "custom" }
  expect(ServerAuth.authorized({ username: "custom", password: Redacted.make("secret") }, config)).toBe(true)
  expect(ServerAuth.authorized({ username: "opencode", password: Redacted.make("secret") }, config)).toBe(false)
})

test("session tokens are accepted with any username", () => {
  const config = { password: Option.some("secret"), username: "custom" }
  const token = ServerAuth.issueSession(config)
  if (!token) throw new Error("Expected a session token")
  expect(ServerAuth.authorized({ username: "opencode", password: Redacted.make(token) }, config)).toBe(true)
})

test("session tokens expire, resist tampering, and are revoked by changing the password", () => {
  const config = { password: Option.some("secret"), username: "opencode" }
  const now = Date.now()
  const token = ServerAuth.issueSession(config, now)
  if (!token) throw new Error("Expected a session token")
  expect(ServerAuth.verifySession(token, config, now)).toBe(true)
  expect(ServerAuth.authorized({ username: "opencode", password: Redacted.make(token) }, config)).toBe(true)
  expect(ServerAuth.verifySession(token, config, now + ServerAuth.SESSION_TTL_SECONDS * 1000)).toBe(false)
  expect(ServerAuth.verifySession(`${token}x`, config, now)).toBe(false)
  const parts = token.split(".")
  expect(ServerAuth.verifySession(`${Number(parts[0]) + 1}.${parts[1]}`, config, now)).toBe(false)
  expect(ServerAuth.verifySession(token, { ...config, password: Option.some("rotated") }, now)).toBe(false)
  expect(ServerAuth.issueSession({ ...config, password: Option.none() })).toBeUndefined()
})
