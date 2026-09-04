import { expect, test } from "bun:test"
import path from "node:path"
import { rename, symlink } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { Host } from "@opencode-ai/plugin/host"
import "../src/plugin/runtime-plugin-support.bun"
import { createPluginSources } from "../src/plugin/source"
import { createSourceWatcher } from "../src/plugin/watch"
import { createSignal } from "solid-js"
import { Plugin } from "@opencode-ai/plugin/tui"
import { tmpdir } from "./fixture/fixture"

test("a fresh local plugin generation observes edited helper exports", async () => {
  await using dir = await tmpdir()
  const sources = createPluginSources(async () => {})
  using _cleanup = { [Symbol.dispose]: sources.dispose }
  const entry = path.join(dir.path, "tui.ts")
  const helper = path.join(dir.path, "helper.ts")
  await Bun.write(entry, 'export { value as default } from "./helper.ts"')
  await Bun.write(helper, 'export const value = "before"')
  expect(await Host.load(await sources.version(pathToFileURL(entry).href))).toMatchObject({ default: "before" })
  await Bun.write(helper, 'export const value = "after"')
  expect(await Host.load(await sources.version(pathToFileURL(entry).href))).toMatchObject({ default: "after" })
})

test("tracks transitive imports through the Solid runtime transform", async () => {
  await using dir = await tmpdir()
  const watched: string[] = []
  const sources = createPluginSources(async (file) => {
    watched.push(file)
  })
  using _cleanup = { [Symbol.dispose]: sources.dispose }
  const entry = path.join(dir.path, "tui.tsx")
  const panel = path.join(dir.path, "panel.tsx")
  const helper = path.join(dir.path, "nested/label.ts")
  await Bun.write(entry, 'export { value as default } from "./panel"')
  await Bun.write(
    panel,
    'import { label } from "./nested/label"; export const Panel = () => <text>{label}</text>; export const value = label',
  )
  await Bun.write(helper, 'export const label = "before"')
  const before = await sources.version(pathToFileURL(entry).href)
  expect(await Host.load(before)).toMatchObject({ default: "before" })
  await sources.version(pathToFileURL(entry).href)
  expect(watched).toContain(helper)
  await Bun.write(helper, 'export const label = "after"')
  const after = await sources.version(pathToFileURL(entry).href)
  expect(after).not.toBe(before)
  expect(await Host.load(after)).toMatchObject({ default: "after" })
})

test("unchanged bytes are a no-op, reverted bytes get a fresh module", async () => {
  await using dir = await tmpdir()
  const sources = createPluginSources(async () => {})
  using _cleanup = { [Symbol.dispose]: sources.dispose }
  const entry = pathToFileURL(path.join(dir.path, "tui.ts")).href
  await Bun.write(new URL(entry), "export default { value: 1 }")
  const first = await sources.version(entry)
  const original = await Host.load(first)
  await Bun.write(new URL(entry), "export default { value: 1 }")
  expect(await sources.version(entry)).toBe(first)
  await Bun.write(new URL(entry), "export default { value: 2 }")
  expect(await Host.load(await sources.version(entry))).toMatchObject({ default: { value: 2 } })
  await Bun.write(new URL(entry), "export default { value: 1 }")
  const reverted = await sources.version(entry)
  expect(reverted).not.toBe(first)
  expect(await Host.load(reverted)).not.toBe(original)
})

test("renamed exports, failed builds, and new dependencies recover without cached helpers", async () => {
  await using dir = await tmpdir()
  const sources = createPluginSources(async () => {})
  using _cleanup = { [Symbol.dispose]: sources.dispose }
  const entry = pathToFileURL(path.join(dir.path, "tui.ts")).href
  await Bun.write(new URL(entry), 'export { value as default } from "./helper"')
  await Bun.write(path.join(dir.path, "helper.ts"), "export const value = 1")
  const before = await sources.version(entry)
  expect(await Host.load(before)).toMatchObject({ default: 1 })
  await Bun.write(path.join(dir.path, "helper.ts"), "export const renamed = 2")
  await expect(sources.version(entry)).rejects.toThrow("value")
  expect(await Host.load(before)).toMatchObject({ default: 1 })
  await Bun.write(new URL(entry), 'export { renamed as default } from "./helper"')
  expect(await Host.load(await sources.version(entry))).toMatchObject({ default: 2 })
  await Bun.write(path.join(dir.path, "helper.ts"), 'export { value as renamed } from "./new/leaf"')
  await expect(sources.version(entry)).rejects.toThrow("leaf")
  await Bun.write(path.join(dir.path, "new/leaf.ts"), "export const value = 3")
  expect(await Host.load(await sources.version(entry))).toMatchObject({ default: 3 })
})

test("shared runtime and ordinary package identities survive plugin generations", async () => {
  await using dir = await tmpdir()
  const sources = createPluginSources(async () => {})
  using _cleanup = { [Symbol.dispose]: sources.dispose }
  const entry = pathToFileURL(path.join(dir.path, "tui.ts")).href
  await Bun.write(path.join(dir.path, "node_modules/example/package.json"), '{"type":"module","main":"index.js"}')
  await Bun.write(path.join(dir.path, "node_modules/example/index.js"), 'export default { value: "package" }')
  const pkg = await Host.load(pathToFileURL(path.join(dir.path, "node_modules/example/index.js")).href)
  if (typeof pkg !== "object" || pkg === null || !("default" in pkg)) throw new Error("Missing package fixture export")
  for (const label of ["before", "after"]) {
    await Bun.write(
      new URL(entry),
      `import { createSignal } from "solid-js"
      import { Plugin } from "@opencode-ai/plugin/tui"
      import value from "example"
      export default { createSignal, Plugin, value, label: ${JSON.stringify(label)} }`,
    )
    expect(await Host.load(await sources.version(entry))).toMatchObject({
      default: { createSignal, Plugin, value: pkg.default, label },
    })
  }
})

test("helper import.meta stays anchored to its source, including assets and resolution", async () => {
  await using dir = await tmpdir()
  const sources = createPluginSources(async () => {})
  using _cleanup = { [Symbol.dispose]: sources.dispose }
  const entry = pathToFileURL(path.join(dir.path, "tui.ts")).href
  const helper = path.join(dir.path, "nested/helper.ts")
  await Bun.write(new URL(entry), 'export { default } from "./nested/helper"')
  await Bun.write(path.join(dir.path, "nested/asset.txt"), "asset")
  await Bun.write(
    helper,
    `export default {
    url: import.meta.url, dir: import.meta.dirname,
    resolved: import.meta.resolve("./asset.txt"),
    asset: await Bun.file(new URL("./asset.txt", import.meta.url)).text(),
  }`,
  )
  expect(await Host.load(await sources.version(entry))).toMatchObject({
    default: {
      url: pathToFileURL(helper).href,
      dir: path.dirname(helper),
      asset: "asset",
      resolved: pathToFileURL(path.join(dir.path, "nested/asset.txt")).href,
    },
  })
})

test("literal dynamic imports and JSON join the source graph", async () => {
  await using dir = await tmpdir()
  const watched: string[] = []
  const sources = createPluginSources(async (file) => {
    watched.push(file)
  })
  using _cleanup = { [Symbol.dispose]: sources.dispose }
  const entry = pathToFileURL(path.join(dir.path, "tui.ts")).href
  const json = path.join(dir.path, "data.json")
  await Bun.write(new URL(entry), 'export default (await import("./helper")).default')
  await Bun.write(path.join(dir.path, "helper.ts"), 'import data from "./data.json"; export default data.value')
  await Bun.write(json, '{"value":1}')
  expect(await Host.load(await sources.version(entry))).toMatchObject({ default: 1 })
  expect(watched).toContain(json)
  await Bun.write(json, '{"value":2}')
  expect(await Host.load(await sources.version(entry))).toMatchObject({ default: 2 })
})

test("real watchers observe atomic saves to nested, outside-root, and symlinked helpers", async () => {
  await using dir = await tmpdir()
  let changes = 0
  const watcher = createSourceWatcher(() => {
    changes++
  })
  const sources = createPluginSources(watcher.wait)
  using _cleanup = {
    [Symbol.dispose]() {
      sources.dispose()
      watcher.dispose()
    },
  }
  const entry = pathToFileURL(path.join(dir.path, "plugin/tui.ts")).href
  const helper = path.join(dir.path, "shared/nested/helper.ts")
  await Bun.write(helper, "export const value = 1")
  await Bun.write(new URL(entry), 'export { value as default } from "./link"')
  await symlink(helper, path.join(dir.path, "plugin/link.ts"))
  expect(await Host.load(await sources.version(entry))).toMatchObject({ default: 1 })
  const count = changes
  await Bun.write(helper + ".new", "export const value = 2")
  await rename(helper + ".new", helper)
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (changes > count) break
    await Bun.sleep(10)
  }
  expect(changes).toBeGreaterThan(count)
  expect(await Host.load(await sources.version(entry))).toMatchObject({ default: 2 })
})

test("Node reloads the local ESM graph without changing source URLs", async () => {
  await using dir = await tmpdir()
  const script = path.join(dir.path, "probe.ts")
  await Bun.write(
    script,
    `
    import { createPluginSources } from ${JSON.stringify(new URL("../src/plugin/source.ts", import.meta.url).pathname)}
    import { writeFile } from "node:fs/promises"
    import assert from "node:assert/strict"
    const entry = new URL("./entry.mjs", import.meta.url)
    const helper = new URL("./helper.mjs", import.meta.url)
    const sources = createPluginSources(async () => {})
    try {
      await writeFile(entry, 'export { value as default } from "./helper.mjs"')
      await writeFile(helper, 'export const value = 1')
      const initial = await sources.version(entry.href)
      assert.equal((await import(initial)).default, 1)
      assert.equal(await sources.version(entry.href), initial)
      await writeFile(helper, 'export const value = 2')
      assert.equal((await import(await sources.version(entry.href))).default, 2)
      console.log("node graph reload passed")
    } finally { sources.dispose() }
  `,
  )
  const build = await Bun.build({
    entrypoints: [script],
    target: "node",
    format: "esm",
    outdir: dir.path,
    naming: "probe.mjs",
  })
  expect(build.success).toBe(true)
  const child = Bun.spawn(["node", path.join(dir.path, "probe.mjs")], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ stdout, stderr, exit }).toEqual({ stdout: "node graph reload passed\n", stderr: "", exit: 0 })
})

test("computed imports retain the importing helper's resolution base", async () => {
  await using dir = await tmpdir()
  const sources = createPluginSources(async () => {})
  using _cleanup = { [Symbol.dispose]: sources.dispose }
  const entry = pathToFileURL(path.join(dir.path, "tui.ts")).href
  await Bun.write(new URL(entry), 'import { read } from "./nested/reader"; export default await read("./leaf.mjs")')
  await Bun.write(
    path.join(dir.path, "nested/reader.ts"),
    "export const read = async (name: string) => (await import(name)).default",
  )
  await Bun.write(path.join(dir.path, "nested/leaf.mjs"), 'export default "computed"')
  expect(await Host.load(await sources.version(entry))).toMatchObject({ default: "computed" })
})

test("empty source modules remain valid dependencies", async () => {
  await using dir = await tmpdir()
  const sources = createPluginSources(async () => {})
  using _cleanup = { [Symbol.dispose]: sources.dispose }
  const entry = pathToFileURL(path.join(dir.path, "tui.ts")).href
  await Bun.write(new URL(entry), 'import "./empty"; export default "ready"')
  await Bun.write(path.join(dir.path, "empty.ts"), "")
  expect(await Host.load(await sources.version(entry))).toMatchObject({ default: "ready" })
})
