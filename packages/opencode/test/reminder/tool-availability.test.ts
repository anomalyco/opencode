import { describe, it, expect, beforeEach } from "bun:test"
import { ToolRegistry } from "../../src/tool/registry"
import { Config } from "../../src/config/config"

// Mock config for testing
const mockConfig = {
  reminders: {
    enabled: false,
    max_reminders_per_project: 50,
    min_interval_seconds: 30,
  },
}

const mockAgent = {
  name: "test",
  description: "test",
  mode: "primary" as const,
  builtIn: true,
  permission: {
    edit: "allow" as const,
    bash: { "*": "allow" as const },
    webfetch: "allow" as const,
  },
  tools: {},
  options: {},
}

describe("Tool Availability Control", () => {
  beforeEach(() => {
    // Setup test environment
    process.chdir("/tmp")
  })

  it("should filter out reminder tools when disabled", async () => {
    // Mock Config.get to return disabled config
    const originalGet = Config.get
    Config.get = async () => mockConfig as any

    try {
      const enabledTools = await ToolRegistry.enabled("openai", "gpt-4", mockAgent)

      expect(enabledTools["add_reminder"]).toBe(false)
      expect(enabledTools["list_reminders"]).toBe(false)
      expect(enabledTools["remove_reminder"]).toBe(false)
    } finally {
      // Restore original function
      Config.get = originalGet
    }
  })

  it("should allow reminder tools when enabled", async () => {
    // Mock Config.get to return enabled config
    const enabledConfig = {
      ...mockConfig,
      reminders: { ...mockConfig.reminders, enabled: true },
    }

    const originalGet = Config.get
    Config.get = async () => enabledConfig as any

    try {
      const enabledTools = await ToolRegistry.enabled("openai", "gpt-4", mockAgent)

      // Should not explicitly disable reminder tools (undefined means enabled)
      expect(enabledTools["add_reminder"]).toBeUndefined()
      expect(enabledTools["list_reminders"]).toBeUndefined()
      expect(enabledTools["remove_reminder"]).toBeUndefined()
    } finally {
      // Restore original function
      Config.get = originalGet
    }
  })
})
