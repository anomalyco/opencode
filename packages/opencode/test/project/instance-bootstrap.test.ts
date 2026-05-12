import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { bootstrap as cliBootstrap } from "../../src/cli/bootstrap"
import { WithInstance } from "../../src/project/with-instance"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

// InstanceBootstrap must run before any code touches the instance —
// originally tracked by PRs #25389 and #25449, now a permanent
// invariant. The plugin config hook writes a marker file; the test
// bodies deliberately avoid Plugin/config directly. The marker only
// appears if InstanceBootstrap ran at the instance boundary.
//
// The boundaries below are transport-agnostic and stay.

afterEach(async () => {
  await disposeAllInstances()
})

async function bootstrapFixture() {
  return tmpdir({
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
}

test("WithInstance.provide runs InstanceBootstrap before fn", async () => {
  await using tmp = await bootstrapFixture()

  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => "ok",
  })

  expect(existsSync(tmp.extra)).toBe(true)
})

test("CLI bootstrap runs InstanceBootstrap before callback", async () => {
  await using tmp = await bootstrapFixture()

  await cliBootstrap(tmp.path, async () => "ok")

  expect(existsSync(tmp.extra)).toBe(true)
})

test("InstanceRuntime.reloadInstance runs InstanceBootstrap", async () => {
  await using tmp = await bootstrapFixture()

  await InstanceRuntime.reloadInstance({ directory: tmp.path })

  expect(existsSync(tmp.extra)).toBe(true)
})
