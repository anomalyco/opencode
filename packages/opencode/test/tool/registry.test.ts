import { describe, expect, test } from "bun:test"
import path from "path"
import { ToolRegistry } from "../../src/tool/registry"
import { Instance } from "../../src/project/instance"

const projectRoot = path.join(__dirname, "../..")

describe("ToolRegistry.tools() permission filtering", () => {
  test("filters out tool with all-deny rules", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const agent = {
          name: "test-agent",
          mode: "subagent" as const,
          permission: [
            { permission: "bash", pattern: "*", action: "deny" as const }
          ],
          options: {}
        }

        const result = await ToolRegistry.tools("anthropic", agent as any)
        const toolIds = result.map(t => t.id)

        expect(toolIds).not.toContain("bash")
      },
    })
  })

  test("includes tool with mixed allow/deny rules", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const agent = {
          name: "test-agent",
          mode: "subagent" as const,
          permission: [
            { permission: "bash", pattern: "git*", action: "allow" as const },
            { permission: "bash", pattern: "*", action: "deny" as const }
          ],
          options: {}
        }

        const result = await ToolRegistry.tools("anthropic", agent as any)
        const toolIds = result.map(t => t.id)

        expect(toolIds).toContain("bash")
      },
    })
  })

  test("catch-all deny filters tools without explicit rules", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const agent = {
          name: "test-agent",
          mode: "subagent" as const,
          permission: [
            { permission: "bash", pattern: "*", action: "allow" as const },
            { permission: "*", pattern: "*", action: "deny" as const }
          ],
          options: {}
        }

        const result = await ToolRegistry.tools("anthropic", agent as any)
        const toolIds = result.map(t => t.id)

        expect(toolIds).toContain("bash")
        expect(toolIds).not.toContain("edit")
      },
    })
  })

  test("includes all tools when permission is empty array", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const agent = {
          name: "test-agent",
          mode: "subagent" as const,
          permission: [],
          options: {}
        }

        const result = await ToolRegistry.tools("anthropic", agent as any)

        expect(result.length).toBeGreaterThan(0)
      },
    })
  })

  test("includes all tools when agent has no permission field", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // When no agent is passed, all tools should be included
        const result = await ToolRegistry.tools("anthropic", undefined)

        expect(result.length).toBeGreaterThan(0)
      },
    })
  })

  test("returns bash tool when no permissions set", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await ToolRegistry.tools("anthropic")

        const bashTool = result.find(t => t.id === "bash")
        expect(bashTool).toBeDefined()
      },
    })
  })

  test("returns edit tool when no permissions set", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await ToolRegistry.tools("anthropic")

        const editTool = result.find(t => t.id === "edit")
        expect(editTool).toBeDefined()
      },
    })
  })

  test("tool has proper structure with description and parameters", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await ToolRegistry.tools("anthropic")

        const bashTool = result.find(t => t.id === "bash")
        expect(bashTool).toBeDefined()
        expect(bashTool?.description).toBeDefined()
        expect(typeof bashTool?.description).toBe("string")
        expect(bashTool?.parameters).toBeDefined()
      },
    })
  })

  test("handles allow rule for specific tool", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const agent = {
          name: "test-agent",
          mode: "subagent" as const,
          permission: [
            { permission: "bash", pattern: "*", action: "allow" as const }
          ],
          options: {}
        }

        const result = await ToolRegistry.tools("anthropic", agent as any)
        const toolIds = result.map(t => t.id)

        expect(toolIds).toContain("bash")
      },
    })
  })

  test("ask action is treated as allow", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const agent = {
          name: "test-agent",
          mode: "subagent" as const,
          permission: [
            { permission: "bash", pattern: "*", action: "ask" as const }
          ],
          options: {}
        }

        const result = await ToolRegistry.tools("anthropic", agent as any)
        const toolIds = result.map(t => t.id)

        expect(toolIds).toContain("bash")
      },
    })
  })

  test("empty permission array bypasses filtering", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const allToolsResult = await ToolRegistry.tools("anthropic")
        
        const agent = {
          name: "test-agent",
          mode: "subagent" as const,
          permission: [],
          options: {}
        }

        const filteredResult = await ToolRegistry.tools("anthropic", agent as any)

        expect(filteredResult.length).toBe(allToolsResult.length)
      },
    })
  })

  test("multiple specific allow rules work correctly", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const agent = {
          name: "test-agent",
          mode: "subagent" as const,
          permission: [
            { permission: "bash", pattern: "*", action: "allow" as const },
            { permission: "read", pattern: "*", action: "allow" as const },
            { permission: "edit", pattern: "*", action: "deny" as const }
          ],
          options: {}
        }

        const result = await ToolRegistry.tools("anthropic", agent as any)
        const toolIds = result.map(t => t.id)

        expect(toolIds).toContain("bash")
        expect(toolIds).toContain("read")
        expect(toolIds).not.toContain("edit")
      },
    })
  })
})
