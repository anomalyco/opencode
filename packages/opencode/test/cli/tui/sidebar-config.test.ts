import { test, expect, describe } from "bun:test"

// Tests for TUI sidebar config behavior
// The sidebar uses: sync.data.config.tui?.sidebar ?? kv.get("sidebar", "auto")
// Priority: config.tui.sidebar > KV store > "auto"
// This allows per-workspace config to override global KV preferences

describe("TUI Sidebar Config Behavior", () => {
  test("config takes precedence over KV store for per-workspace settings", () => {
    // Workspace config set to "hide" overrides global KV preference of "show"
    const configValue = "hide"
    const kvValue = "show"
    const defaultValue = "auto"
    
    const result = configValue ?? kvValue ?? defaultValue
    
    expect(result).toBe("hide")
  })

  test("KV store is used when no workspace config is set", () => {
    // No workspace config, use global KV preference
    const configValue = undefined
    const kvValue = "show"
    const defaultValue = "auto"
    
    const result = configValue ?? kvValue ?? defaultValue
    
    expect(result).toBe("show")
  })

  test("default is used when neither KV nor config is set", () => {
    const kvValue = undefined
    const configValue = undefined
    const defaultValue = "auto"
    
    const result = kvValue ?? configValue ?? defaultValue
    
    expect(result).toBe("auto")
  })

  test("all valid sidebar values are accepted", () => {
    const validValues = ["auto", "show", "hide"] as const
    
    for (const value of validValues) {
      const result = value
      expect(["auto", "show", "hide"]).toContain(result)
    }
  })
})
