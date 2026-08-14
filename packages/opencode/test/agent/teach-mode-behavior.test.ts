import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { expect, describe, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { Session } from "../../src/session/session"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(Agent.node))

describe("Teach Mode - Agent Behavior", () => {
  it.instance("teach agent has primary mode for tab cycling", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      
      expect(agent.mode).toBe("primary")
    }),
  )

  it.instance("teach agent is not hidden", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      
      expect(agent.hidden).toBeFalsy()
    }),
  )

  it.instance("teach agent is native (built-in)", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      
      expect(agent.native).toBe(true)
    }),
  )

  it.instance("teach agent has options object", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      
      expect(agent.options).toBeDefined()
      expect(typeof agent.options).toBe("object")
    }),
  )

  it.instance("teach agent has permission ruleset", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      
      expect(agent.permission).toBeDefined()
      expect(Array.isArray(agent.permission)).toBe(true)
      expect(agent.permission.length).toBeGreaterThan(0)
    }),
  )

  it.instance("teach agent can be switched to via API", () =>
    Effect.gen(function* () {
      const agents = yield* Agent.use.list()
      
      // Verify teach agent exists in the list
      const teach = agents.find((a) => a.name === "teach")
      expect(teach).toBeDefined()
      
      // The switchAgent API should accept "teach" as a valid agent name
      // We can't actually switch without a session, but we can verify the agent exists
      expect(teach?.name).toBe("teach")
    }),
  )

  it.instance("teach agent has pedagogical description", () =>
    Effect.gen(function* () {
      const agent = yield* Agent.use.get("teach")
      const description = agent.description?.toLowerCase() ?? ""
      
      expect(description).toContain("teach")
      expect(description).toContain("pedagogical")
    }),
  )
})
