import { afterEach, describe, expect, test } from "bun:test"
import { Option, Redacted } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ServerAuth } from "../../src/server/auth"

const original = {
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
}

afterEach(() => {
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
})

describe("ServerAuth", () => {
  test("does not emit auth headers without a password", () => {
    Flag.OPENCODE_SERVER_PASSWORD = undefined
    Flag.OPENCODE_SERVER_USERNAME = "alice"

    expect(ServerAuth.header()).toBeUndefined()
    expect(ServerAuth.headers()).toBeUndefined()
  })

  test("defaults to the opencode username", () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"
    Flag.OPENCODE_SERVER_USERNAME = undefined

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("opencode:secret").toString("base64")}`,
    })
  })

  test("uses the configured username", () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"
    Flag.OPENCODE_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("alice:secret").toString("base64")}`,
    })
  })

  test("prefers explicit credentials", () => {
    Flag.OPENCODE_SERVER_PASSWORD = "secret"
    Flag.OPENCODE_SERVER_USERNAME = "alice"

    expect(ServerAuth.headers({ password: "cli-secret", username: "bob" })).toEqual({
      Authorization: `Basic ${Buffer.from("bob:cli-secret").toString("base64")}`,
    })
  })

  test("validates decoded credentials against effect config", () => {
    const config = { password: Option.some("secret"), username: "alice" }

    expect(ServerAuth.required(config)).toBe(true)
    expect(ServerAuth.authorized({ username: "alice", password: Redacted.make("secret") }, config)).toBe(true)
    expect(ServerAuth.authorized({ username: "opencode", password: Redacted.make("secret") }, config)).toBe(false)
  })

  test("recognizes only literal loopback hostnames", () => {
    expect(ServerAuth.isLoopbackHostname("localhost")).toBe(true)
    expect(ServerAuth.isLoopbackHostname("127.0.0.1")).toBe(true)
    expect(ServerAuth.isLoopbackHostname("127.1.2.3")).toBe(true)
    expect(ServerAuth.isLoopbackHostname("::1")).toBe(true)
    expect(ServerAuth.isLoopbackHostname("0:0:0:0:0:0:0:1")).toBe(true)
    expect(ServerAuth.isLoopbackHostname("127.evil.example")).toBe(false)
    expect(ServerAuth.isLoopbackHostname("0.0.0.0")).toBe(false)
  })

  test("requires authentication for mDNS and non-loopback binds", () => {
    expect(ServerAuth.requiresPasswordForBind({ hostname: "127.0.0.1" })).toBe(false)
    expect(ServerAuth.requiresPasswordForBind({ hostname: "127.0.0.1", mdns: true })).toBe(true)
    expect(ServerAuth.requiresPasswordForBind({ hostname: "0.0.0.0" })).toBe(true)
  })
})
