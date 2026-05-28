import { test, expect } from "bun:test"
import { Wildcard } from "@opencode-ai/core/util/wildcard"

test("**/ matches zero path segments (root-level files)", () => {
  // The critical case from issue #29674
  expect(Wildcard.match(".env", "**/.env*")).toBe(true)
  expect(Wildcard.match(".env.local", "**/.env*")).toBe(true)
})

test("**/ still matches files in subdirectories", () => {
  expect(Wildcard.match("subdir/.env", "**/.env*")).toBe(true)
  expect(Wildcard.match("a/b/c/.env.production", "**/.env*")).toBe(true)
})

test("**/ does not match unrelated files", () => {
  expect(Wildcard.match("main.ts", "**/.env*")).toBe(false)
  expect(Wildcard.match("notenv", "**/.env*")).toBe(false)
})

test("existing * patterns are unaffected", () => {
  expect(Wildcard.match(".env", "*.env")).toBe(true)
  expect(Wildcard.match("foo.env", "*.env")).toBe(true)
  expect(Wildcard.match("foo.env.local", "*.env.*")).toBe(true)
})
