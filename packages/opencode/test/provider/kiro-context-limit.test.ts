import { test, expect, mock } from "bun:test"
import path from "path"

mock.module("../../src/bun/index", () => ({
  BunProc: {
    install: async (pkg: string) => {
      const idx = pkg.lastIndexOf("@")
      return idx > 0 ? pkg.substring(0, idx) : pkg
    },
    run: async () => {
      throw new Error("BunProc.run should not be called in tests")
    },
    which: () => process.execPath,
    InstallFailedError: class extends Error {},
  },
}))

const noop = async () => ({})
mock.module("opencode-copilot-auth", () => ({ default: noop }))
mock.module("opencode-anthropic-auth", () => ({ default: noop }))
mock.module("@gitlab/opencode-gitlab-auth", () => ({ default: noop, gitlabAuthPlugin: noop }))

const { tmpdir } = await import("../fixture/fixture")
const { Instance } = await import("../../src/project/instance")
const { Provider } = await import("../../src/provider/provider")
const { ProviderID, ModelID } = await import("../../src/provider/schema")

test("Kiro: opus-4-6 and sonnet-4-6 have 1M context limit", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const kiro = providers[ProviderID.kiro]
      if (!kiro || Object.keys(kiro.models).length === 0) return

      const expected: Record<string, { context: number; output: number }> = {
        "claude-opus-4-6": { context: 1000000, output: 32000 },
        "claude-opus-4-5": { context: 200000, output: 32000 },
        "claude-sonnet-4-6": { context: 1000000, output: 64000 },
        "claude-sonnet-4-5": { context: 200000, output: 64000 },
        "claude-sonnet-4": { context: 200000, output: 64000 },
      }

      for (const [id, limit] of Object.entries(expected)) {
        const model = kiro.models[ModelID.make(id)]
        if (!model) continue
        expect(model.limit.context).toBe(limit.context)
        expect(model.limit.output).toBe(limit.output)
      }
    },
  })
})
