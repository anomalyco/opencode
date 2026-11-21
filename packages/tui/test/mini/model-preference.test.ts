import { describe, expect, test } from "bun:test"
import { agentModelRef, resolveAgentModel } from "../../src/mini/model-preference"
import type { RunAgent, RunProvider } from "../../src/mini/types"

const providers: RunProvider[] = [
  {
    id: "mock",
    name: "Mock",
    models: {
      "agent-model": { name: "Agent Model From Frontmatter", variants: { high: {} } },
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    models: {
      "tidepool-alpha-free": { name: "Tidepool Alpha Free" },
    },
  },
]

function agent(id: string, model?: RunAgent["model"]): RunAgent {
  return { id, name: id, mode: "primary", hidden: false, ...(model ? { model } : {}) }
}

describe("resolve agent model", () => {
  test("resolves the agent model when the catalog offers it", () => {
    expect(
      resolveAgentModel([agent("example", { providerID: "mock", modelID: "agent-model" })], "example", providers),
    ).toEqual({ model: { providerID: "mock", modelID: "agent-model" }, variant: undefined })
  })

  test("keeps the agent model variant when the catalog offers it", () => {
    expect(
      resolveAgentModel(
        [agent("example", { providerID: "mock", modelID: "agent-model", variant: "high" })],
        "example",
        providers,
      ),
    ).toEqual({ model: { providerID: "mock", modelID: "agent-model" }, variant: "high" })
  })

  test("drops the agent model variant when the catalog does not offer it", () => {
    expect(
      resolveAgentModel(
        [agent("example", { providerID: "mock", modelID: "agent-model", variant: "max" })],
        "example",
        providers,
      ),
    ).toEqual({ model: { providerID: "mock", modelID: "agent-model" }, variant: undefined })
  })

  test("returns undefined when the agent has no model", () => {
    expect(resolveAgentModel([agent("plain")], "plain", providers)).toBeUndefined()
  })

  test("returns undefined when the agent is unknown", () => {
    expect(
      resolveAgentModel([agent("example", { providerID: "mock", modelID: "agent-model" })], "missing", providers),
    ).toBeUndefined()
  })

  test("returns undefined when the agent model is not in the catalog", () => {
    expect(
      resolveAgentModel([agent("example", { providerID: "mock", modelID: "ghost-model" })], "example", providers),
    ).toBeUndefined()
    expect(
      resolveAgentModel([agent("example", { providerID: "offline", modelID: "agent-model" })], "example", providers),
    ).toBeUndefined()
  })
})

describe("agent model ref", () => {
  test("returns the configured ref even when the catalog does not offer it", () => {
    const agents = [agent("example", { providerID: "offline", modelID: "agent-model" })]
    expect(agentModelRef(agents, "example")).toEqual({ providerID: "offline", modelID: "agent-model" })
    expect(agentModelRef(agents, "missing")).toBeUndefined()
    expect(agentModelRef([agent("plain")], "plain")).toBeUndefined()
  })
})
