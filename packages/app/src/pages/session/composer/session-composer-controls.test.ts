import { describe, expect, test } from "bun:test"
import { createNewSessionAgentSelect } from "./session-composer-controls"

describe("createNewSessionAgentSelect", () => {
  test("uses the selected agent model for a new session", () => {
    let agent: { model?: { providerID: string; modelID: string } } | undefined
    const models: Array<{ providerID: string; modelID: string } | undefined> = []
    const select = createNewSessionAgentSelect({
      selectAgent: (name) => {
        agent = name === "plan" ? { model: { providerID: "openai", modelID: "gpt-5.4" } } : undefined
      },
      currentAgent: () => agent,
      selectModel: (model) => models.push(model),
    })

    select("plan")

    expect(models).toEqual([{ providerID: "openai", modelID: "gpt-5.4" }])
  })

  test("clears the previous prompt model when the selected agent has no model", () => {
    let agent: { model?: { providerID: string; modelID: string } } | undefined = {
      model: { providerID: "openai", modelID: "gpt-5.4" },
    }
    const models: Array<{ providerID: string; modelID: string } | undefined> = []
    const select = createNewSessionAgentSelect({
      selectAgent: () => {
        agent = {}
      },
      currentAgent: () => agent,
      selectModel: (model) => models.push(model),
    })

    select("build")

    expect(models).toEqual([undefined])
  })
})
