import { describe, expect, test } from "bun:test"
import path from "path"
import { TrajectoryConfig } from "../../src/trajectory/config"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

/**
 * Minimal config tests - just verify config is loaded and can be overridden.
 * Focus on what matters for the feature, not trivial getter/setter tests.
 */
describe("TrajectoryConfig", () => {
  test("should be enabled by default", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = TrajectoryConfig.get()
        expect(config.enabled).toBe(true)
      },
    })
  })

  test("should load trajectory config from opencode.json", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            trajectory: {
              enabled: false,
              outputPath: "./custom-trajectories",
              filenameTemplate: "custom_{sessionID}.jsonl",
            },
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = TrajectoryConfig.get()
        expect(config.enabled).toBe(false)
        expect(config.outputPath).toBe("./custom-trajectories")
        expect(config.filenameTemplate).toBe("custom_{sessionID}.jsonl")
      },
    })
  })

  test("should resolve filename template with all variables", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TrajectoryConfig.set({
          filenameTemplate: "{timestamp}_{agent}_{model}_{sessionID}.jsonl",
        })

        const filename = TrajectoryConfig.resolveFilename("ses_123", {
          agent: "general",
          model: "claude-sonnet-4",
          timestamp: 1700000000,
        })

        expect(filename).toBe("1700000000_general_claude-sonnet-4_ses_123.jsonl")
      },
    })
  })

  test("should sanitize model names with slashes for filenames", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        TrajectoryConfig.set({
          filenameTemplate: "{model}.jsonl",
        })

        const filename = TrajectoryConfig.resolveFilename("ses_123", {
          agent: "general",
          model: "anthropic/claude-sonnet-4",
          timestamp: 1700000000,
        })

        // Should not contain slashes
        expect(filename).not.toContain("/")
        expect(filename).toMatch(/anthropic.*claude-sonnet-4/)
      },
    })
  })
})
