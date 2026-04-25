import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"

import { tmpdir } from "../fixture/fixture"
import { Process } from "../../src/util"
import { Filesystem } from "../../src/util"

const { PluginMeta } = await import("../../src/plugin/meta")
const root = path.join(import.meta.dir, "../..")
const worker = path.join(import.meta.dir, "../fixture/plugin-meta-worker.ts")

function run(input: { file: string; spec: string; target: string; id: string }) {
  return Process.run([process.execPath, worker, JSON.stringify(input)], {
    cwd: root,
    nothrow: true,
  })
}

async function map<Value>(file: string): Promise<Record<string, Value>> {
  return Filesystem.readJson<Record<string, Value>>(file)
}

afterEach(() => {
  delete process.env.OPENCODE_PLUGIN_META_FILE
})

describe("plugin.meta", () => {
  test("tracks file plugin loads and changes", async () => {
    await using tmp = await tmpdir<{ file: string }>({
      init: async (dir) => {
        const file = path.join(dir, "plugin.ts")
        await Bun.write(file, "export default async () => ({})\n")
        return { file }
      },
    })

    process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "state", "plugin-meta.json")
    const file = process.env.OPENCODE_PLUGIN_META_FILE!
    const spec = pathToFileURL(tmp.extra.file).href

    const one = await PluginMeta.touch(spec, spec, "demo.file")
    expect(one.state).toBe("first")
    expect(one.entry.source).toBe("file")
    expect(one.entry.id).toBe("demo.file")
    expect(one.entry.modified).toBeDefined()

    const two = await PluginMeta.touch(spec, spec, "demo.file")
    expect(two.state).toBe("same")
    expect(two.entry.load_count).toBe(2)

    await Bun.write(tmp.extra.file, "export default async () => ({ ok: true })\n")
    const stamp = new Date(Date.now() + 10_000)
    await fs.utimes(tmp.extra.file, stamp, stamp)

    const three = await PluginMeta.touch(spec, spec, "demo.file")
    expect(three.state).toBe("updated")
    expect(three.entry.load_count).toBe(3)
    expect((three.entry.modified ?? 0) > (one.entry.modified ?? 0)).toBe(true)

    const all = await PluginMeta.list()
    expect(Object.values(all).some((item) => item.spec === spec && item.source === "file")).toBe(true)
    const saved = await map<{ spec: string; load_count: number }>(file)
    expect(saved["demo.file"]?.spec).toBe(spec)
    expect(saved["demo.file"]?.load_count).toBe(3)
  })

  test("tracks npm plugin versions", async () => {
    await using tmp = await tmpdir<{ mod: string; pkg: string }>({
      init: async (dir) => {
        const mod = path.join(dir, "node_modules", "acme-plugin")
        const pkg = path.join(mod, "package.json")
        await fs.mkdir(mod, { recursive: true })
        await Bun.write(pkg, JSON.stringify({ name: "acme-plugin", version: "1.0.0" }, null, 2))
        return { mod, pkg }
      },
    })

    process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "state", "plugin-meta.json")
    const file = process.env.OPENCODE_PLUGIN_META_FILE!

    const one = await PluginMeta.touch("acme-plugin@latest", tmp.extra.mod, "acme-plugin")
    expect(one.state).toBe("first")
    expect(one.entry.source).toBe("npm")
    expect(one.entry.requested).toBe("latest")
    expect(one.entry.version).toBe("1.0.0")

    await Bun.write(tmp.extra.pkg, JSON.stringify({ name: "acme-plugin", version: "1.1.0" }, null, 2))

    const two = await PluginMeta.touch("acme-plugin@latest", tmp.extra.mod, "acme-plugin")
    expect(two.state).toBe("updated")
    expect(two.entry.version).toBe("1.1.0")
    expect(two.entry.load_count).toBe(2)

    const all = await PluginMeta.list()
    expect(Object.values(all).some((item) => item.id === "acme-plugin" && item.version === "1.1.0")).toBe(true)
    const saved = await map<{ id: string; version?: string }>(file)
    expect(Object.values(saved).some((item) => item.id === "acme-plugin" && item.version === "1.1.0")).toBe(true)
  })

  test("serializes concurrent metadata updates across processes", async () => {
    await using tmp = await tmpdir<{ file: string }>({
      init: async (dir) => {
        const file = path.join(dir, "plugin.ts")
        await Bun.write(file, "export default async () => ({})\n")
        return { file }
      },
    })

    process.env.OPENCODE_PLUGIN_META_FILE = path.join(tmp.path, "state", "plugin-meta.json")
    const file = process.env.OPENCODE_PLUGIN_META_FILE!
    const spec = pathToFileURL(tmp.extra.file).href
    const n = 12

    const out = await Promise.all(
      Array.from({ length: n }, () =>
        run({
          file,
          spec,
          target: spec,
          id: "demo.file",
        }),
      ),
    )

    expect(out.map((item) => item.code)).toEqual(Array.from({ length: n }, () => 0))
    expect(out.map((item) => item.stderr.toString()).filter(Boolean)).toEqual([])

    const all = await PluginMeta.list()
    const hit = Object.values(all).find((item) => item.spec === spec)
    expect(hit?.load_count).toBe(n)

    const saved = await map<{ spec: string; load_count: number }>(file)
    expect(Object.values(saved).find((item) => item.spec === spec)?.load_count).toBe(n)
  }, 20_000)
})
