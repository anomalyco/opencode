import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { Instance } from "../../src/project/instance"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

// Instance.provide must run bootstrap before fn. The plugin config hook writes
// a marker file, and fn deliberately avoids touching Plugin or config so the
// marker only exists if bootstrap ran at the instance boundary.

afterEach(async () => {
  await disposeAllInstances()
})

test("Instance.provide runs InstanceBootstrap before fn (boundary invariant)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      const marker = path.join(dir, "config-hook-fired")
      const pluginFile = path.join(dir, "plugin.ts")
      await Bun.write(
        pluginFile,
        [
          `const MARKER = ${JSON.stringify(marker)}`,
          "export default async () => ({",
          "  config: async () => {",
          '    await Bun.write(MARKER, "ran")',
          "  },",
          "})",
          "",
        ].join("\n"),
      )
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          plugin: [pathToFileURL(pluginFile).href],
        }),
      )
      return marker
    },
  })

  // The body of `fn` deliberately does not yield Plugin, read config, or
  // touch any service that would force Plugin.state to materialize on
  // demand. The only way the marker gets written is if bootstrap ran.
  await Instance.provide({
    directory: tmp.path,
    fn: async () => "ok",
  })

  expect(existsSync(tmp.extra)).toBe(true)
})
