import { describe, expect, test } from "bun:test"
import { modelForAgent, setModelForAgent, type AgentModelState } from "./agent-model-selection"

const build = { providerID: "openai", modelID: "gpt-5" }
const plan = { providerID: "anthropic", modelID: "claude-sonnet" }

describe("agent model selection", () => {
  test("keeps model selections independent per agent", () => {
    let state: AgentModelState = {}
    state = setModelForAgent(state, "build", build)
    state = setModelForAgent(state, "plan", plan)

    expect(modelForAgent(state, "build")).toEqual(build)
    expect(modelForAgent(state, "plan")).toEqual(plan)
  })

  test("falls back to the legacy session model when no agent selection exists", () => {
    expect(modelForAgent({ model: build }, "plan")).toEqual(build)
  })

  test("does not use the legacy model once per-agent selections exist", () => {
    expect(modelForAgent({ model: build, models: { plan } }, "build")).toBeUndefined()
  })

  test("allows an agent selection to be cleared without changing another agent", () => {
    const state = setModelForAgent({ models: { plan } }, "build", undefined)

    expect(modelForAgent(state, "build")).toBeUndefined()
    expect(modelForAgent(state, "plan")).toEqual(plan)
  })
})
