import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
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
            "export default {",
            '  id: "demo.custom-copilot-auth",',
            "  server: async () => ({",
            "    auth: {",
            '      provider: "github-copilot",',
            "      methods: [",
            '        { type: "api", label: "Test Override Auth" },',
            "      ],",
            "      loader: async () => ({ access: 'test-token' }),",
            "    },",
            "  }),",
            "}",
            "",
          ].join("\n"),
        )
      },
    })

    await using plain = await tmpdir()

    const methods = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        return Effect.runPromise(
          ProviderAuth.Service.use((svc) => svc.methods()).pipe(Effect.provide(ProviderAuth.defaultLayer)),
        )
      },
    })

    const plainMethods = await Instance.provide({
      directory: plain.path,
      fn: async () => {
        return Effect.runPromise(
          ProviderAuth.Service.use((svc) => svc.methods()).pipe(Effect.provide(ProviderAuth.defaultLayer)),
        )
      },
    })

    const copilot = methods[ProviderID.make("github-copilot")]
    expect(copilot).toBeDefined()
    expect(copilot.length).toBe(1)
    expect(copilot[0].label).toBe("Test Override Auth")
    expect(plainMethods[ProviderID.make("github-copilot")][0].label).not.toBe("Test Override Auth")
  }, 30000) // Increased timeout for plugin installation
})

const file = path.join(import.meta.dir, "../../src/plugin/index.ts")

describe("plugin.config-hook-error-isolation", () => {
  test("config hooks are individually error-isolated in the layer factory", async () => {
    const src = await Bun.file(file).text()

    // Each hook's config call is wrapped in Effect.tryPromise with error logging + Effect.ignore
    expect(src).toContain("plugin config hook failed")

    const pattern =
      /for\s*\(const hook of hooks\)\s*\{[\s\S]*?Effect\.tryPromise[\s\S]*?\.config\?\.\([\s\S]*?plugin config hook failed[\s\S]*?Effect\.ignore/
    expect(pattern.test(src)).toBe(true)
  })
})
