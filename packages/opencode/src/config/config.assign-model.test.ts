import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent } from "../agent/agent"
import { Config } from "./config"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { tmpdir } from "../../test/fixture/fixture"

test("Agent.get(\"general\") uses assigned subagent model", async () => {
  await using tmp = await tmpdir({
    config: {
      subagent_model_assignments: {
        general: "openai/gpt-4.1",
        build: "anthropic/claude-3.5-sonnet",
        does_not_exist: "openai/gpt-4.1-mini",
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.subagent_model_assignments?.general).toBe("openai/gpt-4.1")

      const general = await Agent.get("general")
      const build = await Agent.get("build")
      expect(general).toBeDefined()
      expect(String(general?.model?.providerID)).toBe("openai")
      expect(String(general?.model?.modelID)).toBe("gpt-4.1")
      expect(build?.model).toBeUndefined()
    },
  })
})

test("project config overrides global config for subagent_model_assignments", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create global config directory structure
      const globalConfigDir = path.join(dir, "global-config")
      await fs.mkdir(globalConfigDir, { recursive: true })

      // Global config with subagent_model_assignments
      await Filesystem.write(
        path.join(globalConfigDir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          subagent_model_assignments: {
            general: "openai/gpt-4.1",
            build: "anthropic/claude-3.5-sonnet",
          },
        }),
      )

      // Create project directory
      const projectDir = path.join(dir, "project")
      await fs.mkdir(projectDir, { recursive: true })

      // Project config with overriding subagent_model_assignments
      await Filesystem.write(
        path.join(projectDir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          subagent_model_assignments: {
            general: "google/gemini-pro", // Override global
            explore: "openai/gpt-4.1", // Project-only
          },
        }),
      )

      // Set up global config path for this test
      process.env.OPENCODE_TEST_HOME = globalConfigDir
    },
  })

  // Temporarily override Global.Path.config
  const prevGlobalConfig = Global.Path.config
  const globalConfigPath = path.join(tmp.path, "global-config")
  ;(Global.Path as { config: string }).config = globalConfigPath
  
  // Reset the lazy-loaded global config cache so it reloads with new path
  Config.global.reset()

  try {
    await Instance.provide({
      directory: path.join(tmp.path, "project"),
      fn: async () => {
        const config = await Config.get()

        // Project config should override global for 'general'
        expect(config.subagent_model_assignments?.general).toBe("google/gemini-pro")
        // Project-only should be present
        expect(config.subagent_model_assignments?.explore).toBe("openai/gpt-4.1")
        // Global-only should still be present (merged, not replaced)
        expect(config.subagent_model_assignments?.build).toBe("anthropic/claude-3.5-sonnet")

        const general = await Agent.get("general")
        expect(String(general?.model?.providerID)).toBe("google")
        expect(String(general?.model?.modelID)).toBe("gemini-pro")
      },
    })
  } finally {
    ;(Global.Path as { config: string }).config = prevGlobalConfig
  }
})
