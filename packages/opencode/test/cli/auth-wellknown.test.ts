import { test, expect } from "bun:test"
import { parseWellKnownAuth, shouldConfirmWellKnownAuth } from "../../src/cli/cmd/auth"

test("parseWellKnownAuth rejects invalid payloads", () => {
  expect(() => parseWellKnownAuth({})).toThrow()
  expect(() => parseWellKnownAuth({ auth: {} })).toThrow()
  expect(() => parseWellKnownAuth({ auth: { command: [], env: "TOKEN" } })).toThrow()
  expect(() => parseWellKnownAuth({ auth: { command: ["echo"], env: "" } })).toThrow()
})

test("parseWellKnownAuth accepts valid payloads", () => {
  expect(parseWellKnownAuth({ auth: { command: ["echo", "hi"], env: "TOKEN" } })).toEqual({
    command: ["echo", "hi"],
    env: "TOKEN",
  })
})

test("shouldConfirmWellKnownAuth requires confirmation by default", () => {
  expect(shouldConfirmWellKnownAuth({ yes: false })).toBe(true)
  expect(shouldConfirmWellKnownAuth({ yes: true })).toBe(false)
})

