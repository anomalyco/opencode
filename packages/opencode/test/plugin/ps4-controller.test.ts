import { describe, expect, test, beforeEach } from "bun:test"
import { PS4ControllerPlugin } from "../../src/plugin/ps4-controller"
import type { PluginInput } from "@opencode-ai/plugin"

// Mock plugin input
const createMockPluginInput = (): PluginInput => {
  return {
    client: {} as any,
    project: "test-project",
    worktree: "/test/worktree",
    directory: "/test/directory",
    serverUrl: new URL("http://localhost:4096"),
    $: {} as any,
  }
}

describe("plugin.ps4-controller", () => {
  let pluginInput: PluginInput
  const originalEnv = process.env.OPENCODE_PS4_CONTROLLER

  beforeEach(() => {
    pluginInput = createMockPluginInput()
    // Reset environment variable to default
    delete process.env.OPENCODE_PS4_CONTROLLER
  })

  afterEach(() => {
    // Restore original environment
    if (originalEnv !== undefined) {
      process.env.OPENCODE_PS4_CONTROLLER = originalEnv
    } else {
      delete process.env.OPENCODE_PS4_CONTROLLER
    }
  })

  test("plugin initializes successfully", async () => {
    const hooks = await PS4ControllerPlugin(pluginInput)
    expect(hooks).toBeDefined()
    expect(hooks["permission.ask"]).toBeDefined()
    expect(hooks["experimental.chat.system.transform"]).toBeDefined()
  })

  test("plugin adds controller information to system prompts when enabled", async () => {
    const hooks = await PS4ControllerPlugin(pluginInput)
    
    const input = { sessionID: "ses_test123" }
    const output = { system: [] as string[] }
    
    await hooks["experimental.chat.system.transform"]?.(input, output)
    
    expect(output.system.length).toBeGreaterThan(0)
    expect(output.system[0]).toContain("Controller Support Active")
    expect(output.system[0]).toContain("R2")
    expect(output.system[0]).toContain("L2")
    expect(output.system[0]).toContain("Accept")
    expect(output.system[0]).toContain("Cancel")
  })

  test("plugin does not add controller info when disabled via env var", async () => {
    process.env.OPENCODE_PS4_CONTROLLER = "false"
    
    const hooks = await PS4ControllerPlugin(pluginInput)
    
    const input = { sessionID: "ses_test123" }
    const output = { system: [] as string[] }
    
    await hooks["experimental.chat.system.transform"]?.(input, output)
    
    expect(output.system.length).toBe(0)
  })

  test("plugin hook exists for permission asks", async () => {
    const hooks = await PS4ControllerPlugin(pluginInput)
    
    const permissionInput = {
      type: "tool" as const,
      tool: "test-tool",
      sessionID: "ses_test123",
    }
    const output = { status: "ask" as const }
    
    // Should not throw and should execute
    await hooks["permission.ask"]?.(permissionInput, output)
    expect(output.status).toBe("ask")
  })

  test("plugin provides correct button mappings", async () => {
    const hooks = await PS4ControllerPlugin(pluginInput)
    
    const input = { sessionID: "ses_test123" }
    const output = { system: [] as string[] }
    
    await hooks["experimental.chat.system.transform"]?.(input, output)
    
    const systemPrompt = output.system[0]
    
    // Verify all expected button mappings are present
    expect(systemPrompt).toContain("R2") // Accept button
    expect(systemPrompt).toContain("L2") // Cancel button
    expect(systemPrompt).toContain("D-Pad Up") // Navigation
    expect(systemPrompt).toContain("D-Pad Down")
    expect(systemPrompt).toContain("D-Pad Left")
    expect(systemPrompt).toContain("D-Pad Right")
  })

  test("plugin includes button hints instruction", async () => {
    const hooks = await PS4ControllerPlugin(pluginInput)
    
    const input = { sessionID: "ses_test123" }
    const output = { system: [] as string[] }
    
    await hooks["experimental.chat.system.transform"]?.(input, output)
    
    expect(output.system[0]).toContain("include button hints")
    expect(output.system[0]).toContain("[R2] Accept")
    expect(output.system[0]).toContain("[L2] Cancel")
  })
})
