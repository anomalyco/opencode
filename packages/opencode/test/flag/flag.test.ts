import { describe, it, expect } from "bun:test"

describe("Flag functionality", () => {
  describe("flag exports", () => {
    it("should export all expected flags", async () => {
      const { Flag } = await import("../../src/flag/flag")

      // Test that all flags exist
      expect(typeof Flag.OPENCODE_AUTO_SHARE).toBe("boolean")
      expect(Flag.OPENCODE_CONFIG === undefined || typeof Flag.OPENCODE_CONFIG === "string").toBe(true)
      expect(Flag.OPENCODE_CONFIG_CONTENT === undefined || typeof Flag.OPENCODE_CONFIG_CONTENT === "string").toBe(true)
      expect(typeof Flag.OPENCODE_DISABLE_AUTOUPDATE).toBe("boolean")
      expect(typeof Flag.OPENCODE_DISABLE_PRUNE).toBe("boolean")
      expect(Flag.OPENCODE_PERMISSION === undefined || typeof Flag.OPENCODE_PERMISSION === "string").toBe(true)
      expect(typeof Flag.OPENCODE_DISABLE_DEFAULT_PLUGINS).toBe("boolean")
      expect(typeof Flag.OPENCODE_DISABLE_LSP_DOWNLOAD).toBe("boolean")
      expect(typeof Flag.OPENCODE_ENABLE_EXPERIMENTAL_MODELS).toBe("boolean")
      expect(typeof Flag.OPENCODE_DISABLE_AUTOCOMPACT).toBe("boolean")
      expect(typeof Flag.OPENCODE_DISABLE_REMINDERS).toBe("boolean")
      expect(typeof Flag.OPENCODE_EXPERIMENTAL_WATCHER).toBe("boolean")
    })
  })

  describe("OPENCODE_DISABLE_REMINDERS behavior", () => {
    it("should disable reminder tools when OPENCODE_DISABLE_REMINDERS is true", async () => {
      const { ToolRegistry } = await import("../../src/tool/registry")
      const { Config } = await import("../../src/config/config")
      const { Flag } = await import("../../src/flag/flag")

      // Mock Config.get to return default config with reminders.enabled = true
      const originalGet = Config.get
      Config.get = async () =>
        ({ reminders: { enabled: true, max_reminders_per_project: 50, min_interval_seconds: 30 } }) as any

      // Mock Flag.OPENCODE_DISABLE_REMINDERS to true
      const originalDisableReminders = Flag.OPENCODE_DISABLE_REMINDERS
      Object.defineProperty(Flag, "OPENCODE_DISABLE_REMINDERS", { value: true })

      const agent = { permission: { edit: "allow", bash: { "*": "allow" }, webfetch: "allow" } }

      const enabled = await ToolRegistry.enabled("testProvider", "testModel", agent as any)

      expect(enabled["reminderadd"]).toBe(false)
      expect(enabled["reminderlist"]).toBe(false)
      expect(enabled["reminderremove"]).toBe(false)

      // Restore
      Object.defineProperty(Flag, "OPENCODE_DISABLE_REMINDERS", { value: originalDisableReminders })
      Config.get = originalGet
    })

    it("should enable reminder tools when OPENCODE_DISABLE_REMINDERS is false and config enabled", async () => {
      const { ToolRegistry } = await import("../../src/tool/registry")
      const { Config } = await import("../../src/config/config")
      const { Flag } = await import("../../src/flag/flag")

      // Mock Config.get to return default config with reminders.enabled = true
      const originalGet2 = Config.get
      Config.get = async () =>
        ({ reminders: { enabled: true, max_reminders_per_project: 50, min_interval_seconds: 30 } }) as any

      // Mock Flag.OPENCODE_DISABLE_REMINDERS to false
      const originalDisableReminders2 = Flag.OPENCODE_DISABLE_REMINDERS
      Object.defineProperty(Flag, "OPENCODE_DISABLE_REMINDERS", { value: false })

      const agent = { permission: { edit: "allow", bash: { "*": "allow" }, webfetch: "allow" } }

      const enabled = await ToolRegistry.enabled("testProvider", "testModel", agent as any)

      expect(enabled["reminderadd"]).toBeUndefined()
      expect(enabled["reminderlist"]).toBeUndefined()
      expect(enabled["reminderremove"]).toBeUndefined()

      // Restore
      Object.defineProperty(Flag, "OPENCODE_DISABLE_REMINDERS", { value: originalDisableReminders2 })
      Config.get = originalGet2
    })
  })
})
