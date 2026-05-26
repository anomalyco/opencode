import { test, expect } from "bun:test"
import * as PermissionV2 from "@opencode-ai/core/permission"

test("evaluate - single string still works", () => {
  const result = PermissionV2.evaluate("bash", "ls", [{ permission: "bash", pattern: "*", action: "allow" }])
  expect(result.action).toBe("allow")
})

test("evaluate - array of candidates: absolute rule matches absolute candidate", () => {
  const ruleset: PermissionV2.Ruleset = [
    { permission: "read", pattern: "*", action: "deny" },
    { permission: "read", pattern: "/home/user/.config/opencode/**", action: "allow" },
  ]

  const result = PermissionV2.evaluate("read", ["../../.config/opencode/opencode.jsonc", "/home/user/.config/opencode/opencode.jsonc"], ruleset)
  expect(result.action).toBe("allow")
})

test("evaluate - array of candidates: relative rule still matches relative candidate", () => {
  const ruleset: PermissionV2.Ruleset = [
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "read", pattern: "src/secret.ts", action: "deny" },
  ]

  const result = PermissionV2.evaluate("read", ["src/secret.ts", "/abs/project/src/secret.ts"], ruleset)
  expect(result.action).toBe("deny")
})

test("evaluate - array of candidates: config order is respected across candidates", () => {
  const ruleset: PermissionV2.Ruleset = [
    { permission: "read", pattern: "*", action: "deny" },
    { permission: "read", pattern: "src/ok.ts", action: "allow" },
  ]

  const result = PermissionV2.evaluate("read", ["src/ok.ts", "/abs/project/src/ok.ts"], ruleset)
  expect(result.action).toBe("allow")
})
