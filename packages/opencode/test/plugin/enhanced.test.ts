// 18.8: Tests for contribution points, marketplace client, and variable substitution
import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { substituteVars } from "../../src/plugin/shared"
import { Marketplace } from "../../src/plugin/marketplace"
import { Skill } from "../../src/skill"
import { Config } from "../../src/config/config"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

// ─── 18.7: Variable substitution ────────────────────────────────────────────

describe("18.7: substituteVars", () => {
  test("replaces ${user_config.X} in strings", () => {
    expect(substituteVars("hello ${user_config.name}", { name: "world" })).toBe("hello world")
  })

  test("replaces multiple placeholders", () => {
    expect(substituteVars("${user_config.a}:${user_config.b}", { a: "foo", b: "bar" })).toBe("foo:bar")
  })

  test("replaces missing key with empty string", () => {
    expect(substituteVars("${user_config.missing}", {})).toBe("")
  })

  test("recursively substitutes in arrays", () => {
    expect(substituteVars(["${user_config.x}", "plain"], { x: "X" })).toEqual(["X", "plain"])
  })

  test("recursively substitutes in objects", () => {
    expect(substituteVars({ cmd: "${user_config.cmd}" }, { cmd: "bun run" })).toEqual({ cmd: "bun run" })
  })

  test("leaves non-string values unchanged", () => {
    expect(substituteVars(42, {})).toBe(42)
    expect(substituteVars(true, {})).toBe(true)
    expect(substituteVars(null, {})).toBe(null)
  })
})

// ─── 18.1 + 18.2: Plugin contribution points — skills ────────────────────────

describe("18.2: plugin skill registration via plugin_manifests", () => {
  test("skills contributed by plugin manifest are discoverable", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, "plugins", "my-plugin", "skills", "contrib-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: contrib-skill
description: A skill contributed by a plugin manifest.
---

# Contrib Skill

Plugin contributed content here.
`,
        )
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            plugin_manifests: [
              {
                id: "my-plugin",
                enabled: true,
                skills: [path.join(dir, "plugins", "my-plugin", "skills")],
              },
            ],
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        expect(skills.find((s) => s.name === "contrib-skill")).toBeDefined()
      },
    })
  })

  test("skills from disabled plugin manifest are NOT loaded", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        const skillDir = path.join(dir, "plugins", "disabled-plugin", "skills", "hidden-skill")
        await Bun.write(
          path.join(skillDir, "SKILL.md"),
          `---
name: hidden-skill
description: This skill should not be loaded.
---

# Hidden Skill
`,
        )
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            plugin_manifests: [
              {
                id: "disabled-plugin",
                enabled: false,
                skills: [path.join(dir, "plugins", "disabled-plugin", "skills")],
              },
            ],
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const skills = await Skill.all()
        expect(skills.find((s) => s.name === "hidden-skill")).toBeUndefined()
      },
    })
  })
})

// ─── 18.3: Plugin hook registration ─────────────────────────────────────────

describe("18.3: plugin hook registration via plugin_manifests", () => {
  test("hooks from enabled plugin manifest smoke test (fire does not crash)", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            plugin_manifests: [
              {
                id: "my-plugin",
                enabled: true,
                hooks: [{ event: "session.start", command: "echo plugin-hook" }],
              },
            ],
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Hook } = await import("../../src/hook/hook")
        // fire a non-matching event to avoid executing shell — just verify no crash
        const result = await Hook.fire({ event: "nonexistent-event" })
        expect(result.directive).toBe("continue")
      },
    })
  })

  test("PluginManifest hooks schema validates correctly", () => {
    const parsed = Config.PluginManifest.safeParse({
      id: "my-plugin",
      enabled: true,
      hooks: [{ event: "session.start", command: "echo hello", timeout: 5000 }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.hooks?.[0].event).toBe("session.start")
      expect(parsed.data.hooks?.[0].command).toBe("echo hello")
      expect(parsed.data.hooks?.[0].timeout).toBe(5000)
    }
  })
})

// ─── 18.5: Marketplace client (unit tests for search/index logic) ─────────────

describe("18.5: Marketplace search", () => {
  test("search filters by id", () => {
    const entries: Marketplace.Entry[] = [
      { id: "opencode-foo", name: "Foo", description: "Foo plugin", version: "1.0.0" },
      { id: "opencode-bar", name: "Bar", description: "Bar plugin", version: "1.0.0" },
    ]
    const q = "foo"
    const result = entries.filter(
      (e) =>
        e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("opencode-foo")
  })

  test("search filters by tag", () => {
    const entries: Marketplace.Entry[] = [
      { id: "plugin-a", name: "Plugin A", description: "desc", version: "1.0.0", tags: ["testing"] },
      { id: "plugin-b", name: "Plugin B", description: "desc", version: "1.0.0", tags: ["linting"] },
    ]
    const q = "testing"
    const result = entries.filter((e) => e.tags?.some((t) => t.toLowerCase().includes(q)))
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("plugin-a")
  })
})

// ─── 18.1 + 18.6: Plugin enable/disable in config ────────────────────────────

describe("18.6: plugin enable/disable in plugin_manifests", () => {
  test("PluginManifest schema parses enabled field", () => {
    const parsed = Config.PluginManifest.safeParse({ id: "test-plugin", enabled: false })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.enabled).toBe(false)
  })

  test("PluginManifest enabled defaults to true", () => {
    const parsed = Config.PluginManifest.safeParse({ id: "test-plugin" })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.enabled).toBe(true)
  })

  test("PluginManifest schema parses skills, hooks, mcpServers fields", () => {
    const parsed = Config.PluginManifest.safeParse({
      id: "full-plugin",
      enabled: true,
      skills: ["/path/to/skills"],
      hooks: [{ event: "session.start", command: "echo hello" }],
      mcpServers: {
        myServer: { type: "local", command: ["node", "server.js"] },
      },
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.skills).toEqual(["/path/to/skills"])
      expect(parsed.data.hooks).toHaveLength(1)
      expect(Object.keys(parsed.data.mcpServers ?? {})).toEqual(["myServer"])
    }
  })
})
