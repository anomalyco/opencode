import { test, expect } from "bun:test"

import { hashIdentity } from "@/provider/provider"

test("hashIdentity: stable for plain objects", () => {
  const a = hashIdentity({ providerID: "x", npm: "@ai-sdk/x", options: { apiKey: "k" } })
  const b = hashIdentity({ providerID: "x", npm: "@ai-sdk/x", options: { apiKey: "k" } })
  expect(a).toBe(b)
})

test("hashIdentity: distinct for differing primitive values", () => {
  const a = hashIdentity({ providerID: "x", options: { apiKey: "k1" } })
  const b = hashIdentity({ providerID: "x", options: { apiKey: "k2" } })
  expect(a).not.toBe(b)
})

test("hashIdentity: handles BigInt without throwing (regression for plugin options)", () => {
  expect(() => hashIdentity({ providerID: "x", options: { someBig: 1n } })).not.toThrow()
})

test("hashIdentity: BigInt distinct from same-magnitude Number", () => {
  const big = hashIdentity({ providerID: "x", options: { v: 1n } })
  const num = hashIdentity({ providerID: "x", options: { v: 1 } })
  expect(big).not.toBe(num)
})

test("hashIdentity: named functions disambiguate by name", () => {
  function coalesceProvider() {}
  function otherFactory() {}
  const a = hashIdentity({ providerID: "x", options: { credentialProvider: coalesceProvider } })
  const b = hashIdentity({ providerID: "x", options: { credentialProvider: otherFactory } })
  expect(a).not.toBe(b)
})

test("hashIdentity: anonymous arrows collide intentionally (per-call fetch wrapper)", () => {
  const a = hashIdentity({ providerID: "x", options: { fetch: () => undefined } })
  const b = hashIdentity({ providerID: "x", options: { fetch: () => undefined } })
  expect(a).toBe(b)
})
