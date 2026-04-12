import { afterEach, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"

const disable = process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

const { Instance } = await import("../../src/project/instance")
const { Skill } = await import("../../src/skill")

afterEach(async () => {
  if (disable === undefined) delete process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS
  else process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = disable
  await Instance.disposeAll()
})

test("plugin config hook registers skill paths that Skill.all() discovers", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Create a skill in an external directory (not .opencode/skill/)
      const ext = path.join(dir, "plugin-skills", "my-plugin-skill")
      await fs.mkdir(ext, { recursive: true })
      await Bun.write(
        path.join(ext, "SKILL.md"),
        [
          "---",
          "name: plugin-injected-skill",
          "description: A skill registered via plugin config hook.",
          "---",
          "",
          "# Plugin Skill",
          "",
          "This was injected by a plugin's config hook.",
          "",
        ].join("\n"),
      )

      // Create a plugin that adds the external dir to skills.paths
      const pluginDir = path.join(dir, ".opencode", "plugin")
      await fs.mkdir(pluginDir, { recursive: true })
      const ext_paths = JSON.stringify(path.join(dir, "plugin-skills"))
      await Bun.write(
        path.join(pluginDir, "skill-path-plugin.ts"),
        [
          "export default {",
          '  id: "demo.skill-paths",',
          "  server: async () => ({",
          "    config: async (cfg) => {",
          "      if (!cfg.skills) cfg.skills = {}",
          "      if (!cfg.skills.paths) cfg.skills.paths = []",
          `      cfg.skills.paths.push(${ext_paths})`,
          "    },",
          "  }),",
          "}",
          "",
        ].join("\n"),
      )
    },
  })

  const skills = await Instance.provide({
    directory: tmp.path,
    fn: () => Skill.all(),
  })

  const found = skills.find((s) => s.name === "plugin-injected-skill")
  expect(found).toBeDefined()
  expect(found!.description).toBe("A skill registered via plugin config hook.")
}, 30000)

test("without the plugin, skill in external dir is NOT discovered", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      // Same external skill directory, but NO plugin to register it
      const ext = path.join(dir, "plugin-skills", "orphan-skill")
      await fs.mkdir(ext, { recursive: true })
      await Bun.write(
        path.join(ext, "SKILL.md"),
        [
          "---",
          "name: orphan-skill",
          "description: This skill should NOT be discovered.",
          "---",
          "",
          "# Orphan",
          "",
        ].join("\n"),
      )
    },
  })

  const skills = await Instance.provide({
    directory: tmp.path,
    fn: () => Skill.all(),
  })

  const found = skills.find((s) => s.name === "orphan-skill")
  expect(found).toBeUndefined()
}, 30000)
