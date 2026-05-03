import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ProviderAuth } from "../../src/provider/auth"

describe("plugin.auth-override", () => {
  test.skipIf(process.env.OPENCODE_RUN_PLUGIN_AUTH !== "1")(
    "user plugin overrides built-in github-copilot auth",
    async () => {
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
        workspace: tmp.path,
        fn: async () => {
          const methods = await ProviderAuth.methods()
          const copilot = methods["github-copilot"]
          expect(copilot).toBeDefined()
          expect(copilot.length).toBe(1)
          expect(copilot[0].label).toBe("Test Override Auth")
        },
      })
    },
    { timeout: 120000 },
  )
})
