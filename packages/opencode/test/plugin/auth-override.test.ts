import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider/auth"
import { ProviderID } from "../../src/provider/schema"

describe("plugin.auth-override", () => {
  test("user plugin overrides built-in github-copilot auth", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const pluginDir = path.join(dir, ".opencode", "plugin")
        await fs.mkdir(pluginDir, { recursive: true })

        await Bun.write(
          path.join(pluginDir, "custom-copilot-auth.ts"),
          [
            "export default async () => ({",
            "  auth: {",
            '    provider: "github-copilot",',
            "    methods: [",
            '      { type: "api", label: "Test Override Auth" },',
            "    ],",
            "    loader: async () => ({ access: 'test-token' }),",
            "  },",
            "})",
            "",
          ].join("\n"),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const methods = await ProviderAuth.methods()
        const copilot = methods[ProviderID.make("github-copilot")]
        expect(copilot).toBeDefined()
        expect(copilot.length).toBe(1)
        expect(copilot[0].label).toBe("Test Override Auth")
      },
    })
  }, 30000) // Increased timeout for plugin installation
})

const file = path.join(import.meta.dir, "../../src/plugin/index.ts")

describe("plugin.config-hook-ordering", () => {
  test("init loads plugins added by config hooks in a second phase", async () => {
    const src = await Bun.file(file).text()
    const init = src.slice(src.indexOf("export async function init()"))
    const first = init.indexOf("for (const hook of hooks)")
    const added = init.indexOf("const added = (config.plugin ?? []).filter((x) => !loaded.has(x))")
    const next = init.indexOf("const next: Hooks[] = []")
    const load = init.indexOf("for (let plugin of added)")
    const second = init.indexOf("for (const hook of next)")
    const push = init.indexOf("hooks.push(...next)")

    expect(first).toBeGreaterThan(-1)
    expect(added).toBeGreaterThan(first)
    expect(next).toBeGreaterThan(added)
    expect(load).toBeGreaterThan(next)
    expect(second).toBeGreaterThan(load)
    expect(push).toBeGreaterThan(second)
  })

  test("config hooks are individually error-isolated", async () => {
    const src = await Bun.file(file).text()
    const init = src.slice(src.indexOf("export async function init()"))

    expect(init).toContain("plugin config hook failed")

    const loops = [
      /for\s*\(const hook of hooks\)\s*\{[\s\S]*?try\s*\{[\s\S]*?hook\.config\?\.\(config\)[\s\S]*?\}\s*catch\s*\(err\)\s*\{[\s\S]*?plugin config hook failed[\s\S]*?\}/,
      /for\s*\(const hook of next\)\s*\{[\s\S]*?try\s*\{[\s\S]*?hook\.config\?\.\(config\)[\s\S]*?\}\s*catch\s*\(err\)\s*\{[\s\S]*?plugin config hook failed[\s\S]*?\}/,
    ]

    for (const loop of loops) {
      expect(loop.test(init)).toBe(true)
    }
  })
})
