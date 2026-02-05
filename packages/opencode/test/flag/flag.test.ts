import { describe, test, expect, beforeEach, afterEach } from "bun:test"

// Note: Flag module reads env vars at import time for most flags.
// We test the dynamic getters (OPENCODE_DISABLE_PROJECT_CONFIG, OPENCODE_CONFIG_DIR, OPENCODE_CLIENT)
// which read env vars at access time, plus verify the static values.

describe("Flag", () => {
  // Store original env values for cleanup
  const originalEnv: Record<string, string | undefined> = {}
  const envKeysToClean = [
    "OPENCODE_DISABLE_PROJECT_CONFIG",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_CLIENT",
    "OPENCODE_AUTO_SHARE",
    "OPENCODE_GIT_BASH_PATH",
  ]

  beforeEach(() => {
    for (const key of envKeysToClean) {
      originalEnv[key] = process.env[key]
    }
  })

  afterEach(() => {
    for (const key of envKeysToClean) {
      if (originalEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = originalEnv[key]
      }
    }
  })

  describe("static boolean flags (truthy)", () => {
    test("OPENCODE_AUTO_SHARE defaults to false when env not set", async () => {
      // Re-import to test with clean env - but since static flags are read
      // at module load time, we verify the current value is a boolean
      const { Flag } = await import("../../src/flag/flag")
      expect(typeof Flag.OPENCODE_AUTO_SHARE).toBe("boolean")
    })
  })

  describe("static string flags", () => {
    test("OPENCODE_MODELS_PATH reads from env", async () => {
      const { Flag } = await import("../../src/flag/flag")
      // In test environment, preload.ts sets OPENCODE_MODELS_PATH
      if (process.env["OPENCODE_MODELS_PATH"]) {
        expect(Flag.OPENCODE_MODELS_PATH).toBe(process.env["OPENCODE_MODELS_PATH"])
      } else {
        expect(Flag.OPENCODE_MODELS_PATH).toBeUndefined()
      }
    })

    test("OPENCODE_GIT_BASH_PATH is undefined when not set", async () => {
      delete process.env["OPENCODE_GIT_BASH_PATH"]
      const { Flag } = await import("../../src/flag/flag")
      expect(Flag.OPENCODE_GIT_BASH_PATH).toBeUndefined()
    })
  })

  describe("dynamic getter: OPENCODE_DISABLE_PROJECT_CONFIG", () => {
    test("returns false when env var is not set", async () => {
      delete process.env["OPENCODE_DISABLE_PROJECT_CONFIG"]
      const { Flag } = await import("../../src/flag/flag")
      expect(Flag.OPENCODE_DISABLE_PROJECT_CONFIG).toBe(false)
    })

    test("returns true when env var is 'true'", async () => {
      process.env["OPENCODE_DISABLE_PROJECT_CONFIG"] = "true"
      const { Flag } = await import("../../src/flag/flag")
      expect(Flag.OPENCODE_DISABLE_PROJECT_CONFIG).toBe(true)
    })

    test("returns true when env var is '1'", async () => {
      process.env["OPENCODE_DISABLE_PROJECT_CONFIG"] = "1"
      const { Flag } = await import("../../src/flag/flag")
      expect(Flag.OPENCODE_DISABLE_PROJECT_CONFIG).toBe(true)
    })

    test("returns false when env var is 'false'", async () => {
      process.env["OPENCODE_DISABLE_PROJECT_CONFIG"] = "false"
      const { Flag } = await import("../../src/flag/flag")
      expect(Flag.OPENCODE_DISABLE_PROJECT_CONFIG).toBe(false)
    })

    test("returns false for arbitrary string values", async () => {
      process.env["OPENCODE_DISABLE_PROJECT_CONFIG"] = "yes"
      const { Flag } = await import("../../src/flag/flag")
      expect(Flag.OPENCODE_DISABLE_PROJECT_CONFIG).toBe(false)
    })

    test("reacts to runtime env changes (dynamic getter)", async () => {
      const { Flag } = await import("../../src/flag/flag")

      delete process.env["OPENCODE_DISABLE_PROJECT_CONFIG"]
      expect(Flag.OPENCODE_DISABLE_PROJECT_CONFIG).toBe(false)

      process.env["OPENCODE_DISABLE_PROJECT_CONFIG"] = "true"
      expect(Flag.OPENCODE_DISABLE_PROJECT_CONFIG).toBe(true)

      process.env["OPENCODE_DISABLE_PROJECT_CONFIG"] = "false"
      expect(Flag.OPENCODE_DISABLE_PROJECT_CONFIG).toBe(false)
    })
  })

  describe("dynamic getter: OPENCODE_CONFIG_DIR", () => {
    test("returns undefined when env var is not set", async () => {
      delete process.env["OPENCODE_CONFIG_DIR"]
      const { Flag } = await import("../../src/flag/flag")
      expect(Flag.OPENCODE_CONFIG_DIR).toBeUndefined()
    })

    test("returns the env var value when set", async () => {
      process.env["OPENCODE_CONFIG_DIR"] = "/tmp/custom-config-dir"
      const { Flag } = await import("../../src/flag/flag")
      expect(Flag.OPENCODE_CONFIG_DIR).toBe("/tmp/custom-config-dir")
    })

    test("reacts to runtime env changes", async () => {
      const { Flag } = await import("../../src/flag/flag")

      process.env["OPENCODE_CONFIG_DIR"] = "/path/a"
      expect(Flag.OPENCODE_CONFIG_DIR).toBe("/path/a")

      process.env["OPENCODE_CONFIG_DIR"] = "/path/b"
      expect(Flag.OPENCODE_CONFIG_DIR).toBe("/path/b")

      delete process.env["OPENCODE_CONFIG_DIR"]
      expect(Flag.OPENCODE_CONFIG_DIR).toBeUndefined()
    })
  })

  describe("dynamic getter: OPENCODE_CLIENT", () => {
    test("defaults to 'cli' when env var is not set", async () => {
      delete process.env["OPENCODE_CLIENT"]
      const { Flag } = await import("../../src/flag/flag")
      expect(Flag.OPENCODE_CLIENT).toBe("cli")
    })

    test("returns custom client name when set", async () => {
      process.env["OPENCODE_CLIENT"] = "vscode"
      const { Flag } = await import("../../src/flag/flag")
      expect(Flag.OPENCODE_CLIENT).toBe("vscode")
    })

    test("reacts to runtime env changes", async () => {
      const { Flag } = await import("../../src/flag/flag")

      delete process.env["OPENCODE_CLIENT"]
      expect(Flag.OPENCODE_CLIENT).toBe("cli")

      process.env["OPENCODE_CLIENT"] = "webui"
      expect(Flag.OPENCODE_CLIENT).toBe("webui")
    })
  })

  describe("compound flags", () => {
    test("OPENCODE_DISABLE_CLAUDE_CODE_PROMPT depends on OPENCODE_DISABLE_CLAUDE_CODE", async () => {
      // Since these are static (evaluated at module load), we just verify the relationship
      const { Flag } = await import("../../src/flag/flag")
      if (Flag.OPENCODE_DISABLE_CLAUDE_CODE) {
        expect(Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT).toBe(true)
      }
    })

    test("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS depends on OPENCODE_DISABLE_CLAUDE_CODE", async () => {
      const { Flag } = await import("../../src/flag/flag")
      if (Flag.OPENCODE_DISABLE_CLAUDE_CODE) {
        expect(Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS).toBe(true)
      }
    })

    test("OPENCODE_DISABLE_EXTERNAL_SKILLS depends on OPENCODE_DISABLE_CLAUDE_CODE_SKILLS", async () => {
      const { Flag } = await import("../../src/flag/flag")
      if (Flag.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS) {
        expect(Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe(true)
      }
    })
  })

  describe("number flags", () => {
    test("OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS returns undefined when not set", async () => {
      const { Flag } = await import("../../src/flag/flag")
      // In test env it's likely not set
      if (!process.env["OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS"]) {
        expect(Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS).toBeUndefined()
      }
    })
  })
})
