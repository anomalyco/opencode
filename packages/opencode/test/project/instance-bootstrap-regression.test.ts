import { afterEach, expect, test } from "bun:test"
import { Hono } from "hono"
import { existsSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { bootstrap as cliBootstrap } from "../../src/cli/bootstrap"
import { Instance } from "../../src/project/instance"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { InstanceMiddleware } from "../../src/server/routes/instance/middleware"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

// These regressions cover the legacy instance-loading paths fixed by PRs
// #25389 and #25449. The plugin config hook writes a marker file, and the test
// bodies deliberately avoid touching Plugin or config directly. The marker only
// exists if InstanceBootstrap ran at the instance boundary.

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

test("Instance.provide runs InstanceBootstrap before fn (boundary invariant)", async () => {
  await using tmp = await bootstrapFixture()

  await Instance.provide({
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

test("legacy Hono instance middleware runs InstanceBootstrap before next handler", async () => {
  await using tmp = await bootstrapFixture()
  const app = new Hono().use(InstanceMiddleware()).get("/probe", (c) => c.text("ok"))

  const response = await app.request("/probe", { headers: { "x-opencode-directory": tmp.path } })

  expect(response.status).toBe(200)
  expect(existsSync(tmp.extra)).toBe(true)
})

test("InstanceRuntime.reloadInstance runs InstanceBootstrap", async () => {
  await using tmp = await bootstrapFixture()

  await InstanceRuntime.reloadInstance({ directory: tmp.path })

  expect(existsSync(tmp.extra)).toBe(true)
})
