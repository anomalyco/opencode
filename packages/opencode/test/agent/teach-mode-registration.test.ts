import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { expect, describe, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Agent.node))

describe("Teach Mode - Agent Registration", () => {
  it.instance("teach agent is registered and visible", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.use.list()
      const teach = agents.find((a) => a.name === "teach")
      
      expect(teach).toBeDefined()
      expect(teach?.name).toBe("teach")
      expect(teach?.mode).toBe("primary")
      expect(teach?.native).toBe(true)
      expect(teach?.hidden).toBeFalsy()
    }),
  )

  it.instance("teach agent has correct description", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      
      expect(agent.description).toBeDefined()
      expect(agent.description).toContain("Teach")
      expect(agent.description?.toLowerCase()).toContain("pedagogical")
    }),
  )

  it.instance("teach agent can be retrieved by name", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      
      expect(agent).toBeDefined()
      expect(agent.name).toBe("teach")
    }),
  )

  it.instance("teach agent appears in default agent list", () =>
    Effect.gen(function* () {
      const defaultAgent = yield* Agent.use.defaultAgent()
      const agents = yield* Agent.use.list()
      
      // teach should be in the list of all agents
      const teach = agents.find((a) => a.name === "teach")
      expect(teach).toBeDefined()
      
      // Default agent might be build or something else, but teach should exist
      expect(agents.map((a) => a.name)).toContain("teach")
    }),
  )
})
