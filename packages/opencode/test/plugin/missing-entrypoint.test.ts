import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { tmpdir } from "../fixture/fixture"
import { PluginLoader } from "../../src/plugin/loader"

describe("PluginLoader missing entrypoint reporting", () => {
  test("server kind reports a missing server entrypoint exactly once", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const mod = path.join(dir, "mods", "ghost-plugin")
        await fs.mkdir(mod, { recursive: true })
        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify({
            name: "ghost-plugin",
            type: "module",
            exports: { "./tui": "./tui.js" },
          }),
        )
        await Bun.write(path.join(mod, "tui.js"), "export default {}\n")
        return { spec: pathToFileURL(mod).href }
      },
    })

    const missing: Array<{ spec: string; message: string }> = []
    const errors: string[] = []
    const loaded = await PluginLoader.loadExternal({
      items: [{ spec: tmp.extra.spec, source: path.join(tmp.path, "opencode.json"), scope: "local" }],
      kind: "server",
      report: {
        start() {},
        missing(candidate, _retry, message) {
          missing.push({ spec: candidate.plan.spec, message })
        },
        error(_candidate, _retry, stage) {
          errors.push(stage)
        },
      },
    })

    expect(loaded).toEqual([])
    expect(errors).toEqual([])
    expect(missing).toHaveLength(1)
    expect(missing[0]?.spec).toBe(tmp.extra.spec)
    expect(missing[0]?.message.length).toBeGreaterThan(0)
  })

  test("tui kind keeps reporting missing entrypoints to its caller", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        const mod = path.join(dir, "mods", "server-only")
        await fs.mkdir(mod, { recursive: true })
        await Bun.write(
          path.join(mod, "package.json"),
          JSON.stringify({
            name: "server-only",
            type: "module",
            exports: { "./server": "./server.js" },
          }),
        )
        await Bun.write(path.join(mod, "server.js"), "export default {}\n")
        return { spec: pathToFileURL(mod).href }
      },
    })

    const missing: string[] = []
    await PluginLoader.loadExternal({
      items: [{ spec: tmp.extra.spec, source: path.join(tmp.path, "tui.json"), scope: "local" }],
      kind: "tui",
      report: {
        start() {},
        missing(candidate) {
          missing.push(candidate.plan.spec)
        },
        error() {},
      },
    })

    expect(missing).toEqual([tmp.extra.spec])
  })

  test("server plugin wiring publishes missing-entrypoint failures", async () => {
    const src = await Bun.file(new URL("../../src/plugin/index.ts", import.meta.url)).text()
    expect(src).toContain("publishPluginError(`Failed to load plugin ${candidate.plan.spec}: ${message}`)")
    expect(src).not.toMatch(/missing\(candidate,\s*_retry,\s*message\)\s*\{\s*\}/)
  })
})
