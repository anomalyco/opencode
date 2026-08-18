import { expect, test } from "bun:test"
import { matchProviderByNeedle } from "../../src/component/dialog-model"

const providers = [
  { id: "opencode", name: "opencode" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "m3", name: "m3" },
  { id: "m5", name: "m5" },
  { id: "z4", name: "z4" },
]

test("exact id match wins outright", () => {
  expect(matchProviderByNeedle(providers, "m3")?.id).toBe("m3")
})

test("is case-insensitive", () => {
  expect(matchProviderByNeedle(providers, "M3")?.id).toBe("m3")
  expect(matchProviderByNeedle(providers, "OPENCODE")?.id).toBe("opencode")
})

test("falls back to a prefix hit on id or name", () => {
  expect(matchProviderByNeedle(providers, "open")?.id).toBe("opencode")
})

test("exact match beats a prefix match on a different, longer id", () => {
  // "m3" must not be shadowed by some other provider whose id merely starts with it.
  const withPrefixCollision = [...providers, { id: "m30-legacy", name: "m30-legacy" }]
  expect(matchProviderByNeedle(withPrefixCollision, "m3")?.id).toBe("m3")
})

test("returns undefined when nothing matches", () => {
  expect(matchProviderByNeedle(providers, "gpt")).toBeUndefined()
})
