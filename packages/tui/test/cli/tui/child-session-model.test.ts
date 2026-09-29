import { expect, test } from "bun:test"
import { childSessionModelDisplay } from "../../../src/routes/session/composer/child-session-model"

const models = [
  { providerID: "openai", id: "gpt-6-sol", name: "GPT-6 Sol" },
  { providerID: "other", id: "gpt-6-sol", name: "Other Sol" },
]

test("shows the effective child session model and variant", () => {
  expect(childSessionModelDisplay({ providerID: "openai", id: "gpt-6-sol", variant: "high" }, models)).toEqual({
    name: "GPT-6 Sol",
    variant: "high",
  })
})

test("keeps unknown and default variants honest", () => {
  expect(childSessionModelDisplay({ providerID: "custom", id: "model", variant: "default" }, models)).toEqual({
    name: "custom/model",
    variant: "default",
  })
  expect(childSessionModelDisplay({ providerID: "openai", id: "gpt-6-sol" }, models)).toEqual({
    name: "GPT-6 Sol",
    variant: undefined,
  })
})

test("does not infer a model before the child session has one", () => {
  expect(childSessionModelDisplay(undefined, models)).toBeUndefined()
})
