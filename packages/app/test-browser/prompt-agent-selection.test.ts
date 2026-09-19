import { expect, test } from "bun:test"
import { createPromptState, type PromptModel } from "@/context/prompt-state"
import { createPromptAgentSelection } from "@/pages/new-session/prompt-agent-selection"

const agents = [
  { name: "alpha", model: { providerID: "fixture", modelID: "alpha" }, variant: "low" },
  { name: "beta", model: { providerID: "fixture", modelID: "beta" }, variant: "high" },
  { name: "gamma", model: { providerID: "fixture", modelID: "beta" }, variant: "low" },
  { name: "inherited" },
]

function setup(model?: PromptModel) {
  const prompt = createPromptState({ model })
  let index = 0
  const agent = {
    current: () => agents[index],
    set: (name: string | undefined) => {
      index = agents.findIndex((agent) => agent.name === name)
    },
    move: (direction: 1 | -1) => {
      index = (index + direction + agents.length) % agents.length
    },
  }
  return { prompt, agent, select: createPromptAgentSelection({ agent, model: prompt.model }) }
}

test("agent selection replaces the model and variant inherited by a new draft", () => {
  const { prompt, select } = setup({ providerID: "fixture", modelID: "alpha", variant: "low" })
  select.set("beta")
  expect(prompt.model.current()).toEqual({ providerID: "fixture", modelID: "beta", variant: "high" })
  select.set("gamma")
  expect(prompt.model.current()).toEqual({ providerID: "fixture", modelID: "beta", variant: "low" })
})

test("both agent cycle directions update draft selection", () => {
  const { prompt, select } = setup()
  select.move(1)
  expect(prompt.model.current()).toEqual({ providerID: "fixture", modelID: "beta", variant: "high" })
  select.move(-1)
  expect(prompt.model.current()).toEqual({ providerID: "fixture", modelID: "alpha", variant: "low" })
})

test("agents without defaults preserve manual model and explicit default variant", () => {
  const model = { providerID: "other", modelID: "manual", variant: null }
  const { prompt, select } = setup(model)
  select.set("inherited")
  expect(prompt.model.current()).toEqual(model)
})

test("initialization and session restoration do not overwrite the draft model", () => {
  const model = { providerID: "other", modelID: "manual", variant: "high" }
  const { prompt, agent, select } = setup(model)
  expect(prompt.model.current()).toEqual(model)
  agent.set("beta")
  expect(prompt.model.current()).toEqual(model)
  select.set("beta")
  prompt.model.set(model)
  expect(prompt.model.current()).toEqual(model)
})

test("a missing agent does not clear the draft model", () => {
  const model = { providerID: "fixture", modelID: "alpha", variant: "low" }
  const { prompt, select } = setup(model)
  select.set("missing")
  expect(prompt.model.current()).toEqual(model)
})
