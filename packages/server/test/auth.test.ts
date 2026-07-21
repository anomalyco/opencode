import { expect, test } from "bun:test"
import { ServerAuth } from "@opencode-ai/server/auth"
import { Option, Redacted } from "effect"

test("accepts only the fixed opencode username", () => {
  const config = { password: Option.some("secret"), username: "opencode" }
  expect(ServerAuth.authorized({ username: "opencode", password: Redacted.make("secret") }, config)).toBe(true)
  expect(ServerAuth.authorized({ username: "custom", password: Redacted.make("secret") }, config)).toBe(false)
})

test("encodes the fixed opencode username", () => {
  expect(ServerAuth.header({ password: "secret" })).toBe(`Basic ${Buffer.from("opencode:secret").toString("base64")}`)
})
