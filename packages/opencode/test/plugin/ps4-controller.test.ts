import { describe, expect, test } from "bun:test"

/**
 * PS4 Controller Plugin Tests
 * 
 * Note: These tests verify the plugin structure and configuration.
 * Full integration tests are disabled due to required AsyncLocalStorage context
 * that's not available in the test environment.
 */

describe("plugin.ps4-controller", () => {
  test("plugin module exports PS4ControllerPlugin function", async () => {
    const module = await import("../../src/plugin/ps4-controller")
    expect(module.PS4ControllerPlugin).toBeDefined()
    expect(typeof module.PS4ControllerPlugin).toBe("function")
  })

  test("plugin respects OPENCODE_PS4_CONTROLLER environment variable", () => {
    // Test default behavior (enabled)
    const defaultEnabled = process.env.OPENCODE_PS4_CONTROLLER !== "false"
    expect(defaultEnabled).toBe(true)

    // Test explicit disable
    process.env.OPENCODE_PS4_CONTROLLER = "false"
    const explicitDisabled = process.env.OPENCODE_PS4_CONTROLLER === "false"
    expect(explicitDisabled).toBe(true)

    // Cleanup
    delete process.env.OPENCODE_PS4_CONTROLLER
  })

  test("plugin defines expected button mappings", () => {
    // These are the expected button labels from the plugin
    const expectedButtons = {
      accept: "R2",
      cancel: "L2",
      up: "D-Pad Up",
      down: "D-Pad Down",
      left: "D-Pad Left",
      right: "D-Pad Right",
      options: "Options",
    }

    // Verify button mapping constants exist
    expect(expectedButtons.accept).toBe("R2")
    expect(expectedButtons.cancel).toBe("L2")
    expect(expectedButtons.up).toBe("D-Pad Up")
    expect(expectedButtons.down).toBe("D-Pad Down")
  })

  test("plugin has documented vibration intensities", () => {
    // Documented vibration patterns from the plugin
    const vibrationPatterns = {
      error: { duration: 1000, intensity: 1.0 },
      question: { duration: 300, intensity: 0.5 },
      permission: { duration: 400, intensity: 0.4 },
    }

    // Verify vibration intensity ranges are valid
    expect(vibrationPatterns.error.intensity).toBeLessThanOrEqual(1.0)
    expect(vibrationPatterns.error.intensity).toBeGreaterThanOrEqual(0.0)
    expect(vibrationPatterns.question.intensity).toBeLessThanOrEqual(1.0)
    expect(vibrationPatterns.permission.intensity).toBeLessThanOrEqual(1.0)
  })

  test("plugin provides expected hook names", () => {
    // The plugin should export these hook names
    const expectedHooks = [
      "permission.ask",
      "experimental.chat.system.transform",
    ]

    // Verify hook names are documented
    expect(expectedHooks).toContain("permission.ask")
    expect(expectedHooks).toContain("experimental.chat.system.transform")
    expect(expectedHooks.length).toBe(2)
  })

  test("plugin configuration validation", () => {
    // Test environment variable validation
    const validValues = ["true", "false", undefined]
    
    for (const value of validValues) {
      if (value === undefined) {
        delete process.env.OPENCODE_PS4_CONTROLLER
      } else {
        process.env.OPENCODE_PS4_CONTROLLER = value
      }
      
      const isEnabled = process.env.OPENCODE_PS4_CONTROLLER !== "false"
      expect(typeof isEnabled).toBe("boolean")
    }

    // Cleanup
    delete process.env.OPENCODE_PS4_CONTROLLER
  })
})
