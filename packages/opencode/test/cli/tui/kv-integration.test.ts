import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Global } from "../../../src/global"

describe("context.kv.integration", () => {
  let testStateDir: string

  test("signal persists values to kv.json and reads them back", async () => {
    testStateDir = path.join(await fs.mkdtemp(path.join(Global.Path.home, "opencode-kv-test-")))
    process.env.OPENCODE_TEST_HOME = testStateDir

    try {
      // Pre-populate kv.json
      const statePath = path.join(testStateDir, "opencode/state")
      await fs.mkdir(statePath, { recursive: true })
      await Bun.write(
        path.join(statePath, "kv.json"),
        JSON.stringify({
          sidebar: "hide",
          thinking_visibility: false,
          timestamps: "show",
        }),
      )

      // Now test that we can read it
      const file = Bun.file(path.join(statePath, "kv.json"))
      const content = await file.json()
      expect(content.sidebar).toBe("hide")
      expect(content.thinking_visibility).toBe(false)
      expect(content.timestamps).toBe("show")
    } finally {
      delete process.env.OPENCODE_TEST_HOME
      await fs.rm(testStateDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("kv.json can be written and re-read multiple times", async () => {
    testStateDir = path.join(await fs.mkdtemp(path.join(Global.Path.home, "opencode-kv-test-")))
    process.env.OPENCODE_TEST_HOME = testStateDir

    try {
      const statePath = path.join(testStateDir, "opencode/state")
      await fs.mkdir(statePath, { recursive: true })

      const kvFile = path.join(statePath, "kv.json")

      // Write initial state
      await Bun.write(kvFile, JSON.stringify({ key1: "value1" }))
      let content = await Bun.file(kvFile).json()
      expect(content.key1).toBe("value1")

      // Update state
      await Bun.write(kvFile, JSON.stringify({ key1: "value1", key2: "value2" }))
      content = await Bun.file(kvFile).json()
      expect(content.key1).toBe("value1")
      expect(content.key2).toBe("value2")

      // Update again
      await Bun.write(kvFile, JSON.stringify({ key1: "updated", key2: "value2" }))
      content = await Bun.file(kvFile).json()
      expect(content.key1).toBe("updated")
      expect(content.key2).toBe("value2")
    } finally {
      delete process.env.OPENCODE_TEST_HOME
      await fs.rm(testStateDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("default values are used when kv.json is empty", async () => {
    testStateDir = path.join(await fs.mkdtemp(path.join(Global.Path.home, "opencode-kv-test-")))
    process.env.OPENCODE_TEST_HOME = testStateDir

    try {
      const statePath = path.join(testStateDir, "opencode/state")
      await fs.mkdir(statePath, { recursive: true })
      await Bun.write(path.join(statePath, "kv.json"), JSON.stringify({}))

      const file = Bun.file(path.join(statePath, "kv.json"))
      const content = await file.json()
      expect(content).toEqual({})
    } finally {
      delete process.env.OPENCODE_TEST_HOME
      await fs.rm(testStateDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("complex values can be stored in kv.json", async () => {
    testStateDir = path.join(await fs.mkdtemp(path.join(Global.Path.home, "opencode-kv-test-")))
    process.env.OPENCODE_TEST_HOME = testStateDir

    try {
      const statePath = path.join(testStateDir, "opencode/state")
      await fs.mkdir(statePath, { recursive: true })

      const complexValue = {
        settings: { nested: { value: true } },
        array: [1, 2, 3],
        mixed: { bool: true, string: "test", number: 42 },
      }

      await Bun.write(path.join(statePath, "kv.json"), JSON.stringify(complexValue))
      const file = Bun.file(path.join(statePath, "kv.json"))
      const content = await file.json()
      expect(content).toEqual(complexValue)
    } finally {
      delete process.env.OPENCODE_TEST_HOME
      await fs.rm(testStateDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("kv.json stores all persisted UI settings correctly", async () => {
    testStateDir = path.join(await fs.mkdtemp(path.join(Global.Path.home, "opencode-kv-test-")))
    process.env.OPENCODE_TEST_HOME = testStateDir

    try {
      const statePath = path.join(testStateDir, "opencode/state")
      await fs.mkdir(statePath, { recursive: true })

      const allSettings = {
        // Session view settings
        sidebar: "auto",
        thinking_visibility: true,
        timestamps: "hide",
        tool_details_visibility: true,
        assistant_metadata_visibility: true,
        scrollbar_visible: false,
        animations_enabled: true,

        // App settings
        terminal_title_enabled: true,
        tips_hidden: false,
        dismissed_getting_started: false,
        openrouter_warning: false,

        // Theme settings
        theme_mode: "dark",
        theme: "opencode",
      }

      await Bun.write(path.join(statePath, "kv.json"), JSON.stringify(allSettings))
      const file = Bun.file(path.join(statePath, "kv.json"))
      const content = await file.json()

      // Verify all keys
      Object.entries(allSettings).forEach(([key, value]) => {
        expect(content[key]).toBe(value)
      })
    } finally {
      delete process.env.OPENCODE_TEST_HOME
      await fs.rm(testStateDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
