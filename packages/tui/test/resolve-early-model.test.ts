import { expect, test } from "bun:test"
import { resolveEarlyModel } from "../src/context/local"

test("prefers args model", () => {
  expect(resolveEarlyModel({ argsModel: "anthropic/opus", configModel: "openai/gpt", recent: [] })).toEqual({
    providerID: "anthropic",
    modelID: "opus",
  })
})

test("falls back to config model", () => {
  expect(
    resolveEarlyModel({ configModel: "openai/gpt-5", recent: [{ providerID: "x", modelID: "y" }] }),
  ).toEqual({ providerID: "openai", modelID: "gpt-5" })
})

test("falls back to most recent", () => {
  expect(resolveEarlyModel({ recent: [{ providerID: "anthropic", modelID: "opus" }] })).toEqual({
    providerID: "anthropic",
    modelID: "opus",
  })
})

test("undefined when nothing known", () => {
  expect(resolveEarlyModel({ recent: [] })).toBeUndefined()
})
