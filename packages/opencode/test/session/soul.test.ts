import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { SystemPrompt } from "../../src/session/system"
import { Agent } from "../../src/agent/agent"
import { tmpdir } from "../fixture/fixture"

describe("session.system — soul/routing separation", () => {
  test("environment() returns soul identity as first element", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("build")
        const model = { api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any
        const parts = await SystemPrompt.environment(model)

        // First element is the soul identity (NOT routing)
        expect(parts[0]).toContain("You are")
        // Soul identity is NOT the routing table
        expect(parts[0]).not.toContain("| User Intent")
        expect(parts[0]).not.toContain("Skill Domain")
      },
    })
  })

  test("environment() includes routing table as separate element from soul", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = { api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any
        const parts = await SystemPrompt.environment(model)

        // Routing table must appear somewhere in the output
        const full = parts.join("\n")
        expect(full).toContain("| User Intent")
        expect(full).toContain("Skill Domain")
      },
    })
  })

  test("soul identity and routing are distinct strings in environment()", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = { api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any
        const parts = await SystemPrompt.environment(model)

        // Must return at least 3 elements: soul, routing, env context
        expect(parts.length).toBeGreaterThanOrEqual(3)
        // Soul (first) must not contain routing table
        expect(parts[0]).not.toContain("| User Intent")
      },
    })
  })

  test("environment() includes model info in env context element", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const model = { api: { id: "claude-sonnet-4" }, providerID: "anthropic" } as any
        const parts = await SystemPrompt.environment(model)

        const envSection = parts.find((p) => p.includes("claude-sonnet-4"))
        expect(envSection).toBeDefined()
        expect(envSection).toContain("Working directory")
      },
    })
  })
})
