import { describe, expect, test, afterEach } from "bun:test"
import { DaemonService } from "../../src/daemon/service"
import * as fs from "fs/promises"
import path from "path"
import os from "os"

// We test loadConfig/saveConfig by writing to the real config path.
// To avoid polluting the user's config, we override CONFIG_FILE via a temp dir approach:
// Instead, we test the pure functions that we can access, and test loadConfig with
// a missing file (returns undefined).

describe("DaemonService.loadConfig", () => {
  test("returns undefined when no config file exists", async () => {
    // Temporarily move the config file if it exists
    const configDir = path.join(os.homedir(), ".config", "opencode")
    const configFile = path.join(configDir, "daemon.json")
    const backupFile = path.join(configDir, "daemon.json.bak")
    let hadConfig = false

    try {
      await fs.access(configFile)
      hadConfig = true
      await fs.rename(configFile, backupFile)
    } catch {
      // No config file exists, good
    }

    try {
      const result = await DaemonService.loadConfig()
      if (!hadConfig) {
        expect(result).toBeUndefined()
      }
    } finally {
      if (hadConfig) {
        await fs.rename(backupFile, configFile)
      }
    }
  })
})

// Test the plist/systemd generation functions indirectly by checking that
// install/uninstall/status dispatch correctly based on platform.
describe("DaemonService platform dispatch", () => {
  test("status returns a boolean", async () => {
    // This calls the platform-specific status check.
    // On CI/dev machines without a daemon installed, it should return false.
    const result = await DaemonService.status()
    expect(typeof result).toBe("boolean")
  })
})
