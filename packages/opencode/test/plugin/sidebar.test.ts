import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { PluginRoutes } from "../../src/server/routes/plugin"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function source(plugin: { items?: unknown[]; fail?: boolean }) {
  return [
    "export default async () => ({",
    '  "ui.sidebar": async (_input, output) => {',
    plugin.fail ? '    throw new Error("boom")' : `    output.items.push(...${JSON.stringify(plugin.items ?? [])})`,
    "  },",
    "})",
    "",
  ].join("\n")
}

async function setup(plugins: { name: string; items?: unknown[]; fail?: boolean }[]) {
  return tmpdir({
    init: async (dir) => {
      const root = path.join(dir, ".opencode", "plugin")
      await fs.mkdir(root, { recursive: true })
      await Promise.all(plugins.map((plugin) => Bun.write(path.join(root, plugin.name), source(plugin))))
    },
  })
}

async function call(dir: string) {
  return Instance.provide({
    directory: dir,
    fn: async () => PluginRoutes().request("/sidebar"),
  })
}

describe("plugin.sidebar", () => {
  test("returns an empty item list when no plugins contribute", async () => {
    await using tmp = await setup([])

    const res = await call(tmp.path)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [] })
  })

  test("returns sidebar items from a single plugin", async () => {
    await using tmp = await setup([
      {
        name: "single.ts",
        items: [{ id: "one", label: "One", icon: "bolt", href: "/one", order: 3 }],
      },
    ])

    const res = await call(tmp.path)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      items: [{ id: "one", label: "One", icon: "bolt", href: "/one", order: 3 }],
    })
  })

  test("deduplicates duplicate ids with last-loaded plugins winning and sorts by order then id", async () => {
    await using tmp = await setup([
      {
        name: "01-first.ts",
        items: [
          { id: "z", label: "Zulu", icon: "zap", href: "/z", order: 2 },
          { id: "dup", label: "Old", icon: "box", href: "/old", order: 1 },
          { id: "d", label: "Delta", icon: "diamond", href: "/d" },
        ],
      },
      {
        name: "02-second.ts",
        items: [
          { id: "dup", label: "New", icon: "bolt", href: "/new", order: 1 },
          { id: "a", label: "Alpha", icon: "arrow-right", href: "/a", order: 1 },
          { id: "c", label: "Charlie", icon: "circle", href: "/c", order: 0 },
        ],
      },
    ])

    const res = await call(tmp.path)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      items: [
        { id: "c", label: "Charlie", icon: "circle", href: "/c", order: 0 },
        { id: "d", label: "Delta", icon: "diamond", href: "/d" },
        { id: "a", label: "Alpha", icon: "arrow-right", href: "/a", order: 1 },
        { id: "dup", label: "New", icon: "bolt", href: "/new", order: 1 },
        { id: "z", label: "Zulu", icon: "zap", href: "/z", order: 2 },
      ],
    })
  })

  test("returns an empty item list when a sidebar hook throws", async () => {
    await using tmp = await setup([{ name: "broken.ts", fail: true }])

    const res = await call(tmp.path)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [] })
  })
})
