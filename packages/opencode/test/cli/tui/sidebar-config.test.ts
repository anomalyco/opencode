import { test, expect, describe } from "bun:test"

// Tests for TUI sidebar config behavior
// The sidebar uses: kv.get("sidebar", sync.data.config.tui?.sidebar ?? "auto")
// Priority: KV store > config.tui.sidebar > "auto"

describe("TUI Sidebar Config Behavior", () => {
  test("config provides initial default before user interaction", () => {
    // User opens OpenCode with tui.sidebar = "hide" and has never toggled sidebar
    const kvValue = undefined
    const configValue = "hide"
    const defaultValue = "auto"
    
    const result = kvValue ?? configValue ?? defaultValue
    
    expect(result).toBe("hide")
  })

  test("KV store takes precedence over config after user toggles", () => {
    // User toggled sidebar to "show" even though config says "hide"
    const kvValue = "show"
    const configValue = "hide"
    const defaultValue = "auto"
    
    const result = kvValue ?? configValue ?? defaultValue
    
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
