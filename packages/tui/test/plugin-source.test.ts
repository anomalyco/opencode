import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir, rename, symlink } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Host } from "@opencode-ai/plugin/host"
import "../src/plugin/runtime-plugin-support.bun"
import { createPluginSources } from "../src/plugin/source"
import { createSourceWatcher } from "../src/plugin/watch"
import { createSignal } from "solid-js"
import { Plugin } from "@opencode-ai/plugin/tui"
import { tmpdir } from "./fixture/fixture"

test("a fresh local plugin generation observes edited helper exports", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL("helper.ts", sources.url)
  await Bun.write(entry, 'export { value as default } from "./helper.ts"')
  await Bun.write(helper, 'export const value = "before"')
  const before = await sources.read(entry.href)
  expect(before.module).toMatchObject({ default: "before" })
  await Bun.write(helper, 'export const value = "after"')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "after" })
  expect(before.module).toMatchObject({ default: "before" })
})

test("tracks transitive imports through the Solid runtime transform", async () => {
  const watched: string[] = []
  await using sources = await fixture(async (file) => {
    watched.push(file)
  })
  const entry = new URL("tui.tsx", sources.url)
  const helper = new URL("nested/label.ts", sources.url)
  await Bun.write(entry, 'export { value as default } from "./panel"')
  await Bun.write(
    new URL("panel.tsx", sources.url),
    'import { label } from "./nested/label"; export const Panel = () => <text>{label}</text>; export const value = label',
  )
  await Bun.write(helper, 'export const label = "before"')
  const before = await sources.read(entry.href)
  expect(before.module).toMatchObject({ default: "before" })
  expect(watched).toContain(fileURLToPath(helper))
  await Bun.write(helper, 'export const label = "after"')
  const after = await sources.read(entry.href)
  expect(after.version).not.toBe(before.version)
  expect(after.module).toMatchObject({ default: "after" })
})

test("an explicit local entrypoint inside node_modules still reloads", async () => {
  await using sources = await fixture()
  const entry = new URL("node_modules/local-plugin/index.ts", sources.url)
  await Bun.write(entry, 'export default "before"')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "before" })
  await Bun.write(entry, 'export default "after"')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "after" })
})

test("unchanged bytes are a no-op, reverted bytes get a fresh module", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(entry, "export default { value: 1 }")
  const first = await sources.read(entry.href)
  await Bun.write(entry, "export default { value: 1 }")
  expect(await sources.read(entry.href)).toBe(first)
  await Bun.write(entry, "export default { value: 2 }")
  expect((await sources.read(entry.href)).module).toMatchObject({ default: { value: 2 } })
  await Bun.write(entry, "export default { value: 1 }")
  const reverted = await sources.read(entry.href)
  expect(reverted.version).not.toBe(first.version)
  expect(reverted.module).not.toBe(first.module)
  expect(reverted.module).toMatchObject({ default: { value: 1 } })
})

test("renamed exports, failed loads, and new dependencies recover without cached helpers", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL("helper.ts", sources.url)
  await Bun.write(entry, 'import { value } from "./helper"; export default value')
  await Bun.write(helper, "export const value = 1")
  const before = await sources.read(entry.href)
  expect(before.module).toMatchObject({ default: 1 })
  await Bun.write(helper, "export const renamed = 2")
  await expect(sources.read(entry.href)).rejects.toThrow()
  expect(before.module).toMatchObject({ default: 1 })
  await Bun.write(entry, 'import { renamed } from "./helper"; export default renamed')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: 2 })
  await Bun.write(helper, 'export { value as renamed } from "./new/leaf"')
  await expect(sources.read(entry.href)).rejects.toThrow("leaf")
  await Bun.write(new URL("new/leaf.ts", sources.url), "export const value = 3")
  expect((await sources.read(entry.href)).module).toMatchObject({ default: 3 })
})

test("shared runtime and ordinary package identities survive plugin generations", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(new URL("node_modules/example/package.json", sources.url), '{"type":"module","main":"index.js"}')
  const library = new URL("node_modules/example/index.js", sources.url)
  await Bun.write(library, 'export default { value: "package" }')
  const pkg = await Host.load(library.href)
  if (typeof pkg !== "object" || pkg === null || !("default" in pkg)) throw new Error("Missing package fixture export")
  for (const label of ["before", "after"]) {
    await Bun.write(
      entry,
      `import { createSignal } from "solid-js"
      import { Plugin } from "@opencode-ai/plugin/tui"
      import value from "example"
      export { createSignal, Plugin, value }; export const label = ${JSON.stringify(label)}`,
    )
    const loaded = (await sources.read(entry.href)).module
    if (typeof loaded !== "object" || loaded === null) throw new Error("Missing plugin fixture exports")
    expect("createSignal" in loaded && loaded.createSignal).toBe(createSignal)
    expect("Plugin" in loaded && loaded.Plugin).toBe(Plugin)
    expect("value" in loaded && loaded.value).toBe(pkg.default)
    expect(loaded).toMatchObject({ label })
  }
})

test("helper import.meta stays anchored to its source, including assets and resolution", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL("nested/helper.ts", sources.url)
  await Bun.write(entry, 'export { default } from "./nested/helper"')
  await Bun.write(new URL("nested/asset.txt", sources.url), "asset")
  await Bun.write(
    helper,
    `export default {
    url: import.meta.url, dir: import.meta.dirname, file: import.meta.file,
    resolved: import.meta.resolve("./asset.txt"),
    resolvedSync: import.meta.resolveSync("./asset.txt"),
    asset: await Bun.file(new URL("./asset.txt", import.meta.url)).text(),
  }`,
  )
  expect((await sources.read(entry.href)).module).toMatchObject({
    default: {
      url: helper.href,
      dir: path.dirname(fileURLToPath(helper)),
      file: "helper.ts",
      asset: "asset",
      resolved: new URL("nested/asset.txt", sources.url).href,
      resolvedSync: fileURLToPath(new URL("nested/asset.txt", sources.url)),
    },
  })
})

test("literal dynamic imports and JSON join the source graph", async () => {
  const watched: string[] = []
  await using sources = await fixture(async (file) => {
    watched.push(file)
  })
  const entry = new URL("tui.ts", sources.url)
  const json = new URL("data.json", sources.url)
  await Bun.write(entry, 'export default (await import("./helper")).default')
  await Bun.write(new URL("helper.ts", sources.url), 'import data from "./data.json"; export default data.value')
  await Bun.write(json, '{"value":1}')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: 1 })
  expect(watched).toContain(fileURLToPath(json))
  await Bun.write(json, '{"value":2}')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: 2 })
})

test("real watchers observe atomic saves to nested, outside-root, and symlinked helpers", async () => {
  let changes = 0
  const watcher = createSourceWatcher(() => {
    changes++
  })
  using _watcher = { [Symbol.dispose]: watcher.dispose }
  await using sources = await fixture(watcher.wait)
  const entry = new URL("plugin/tui.ts", sources.url)
  const helper = new URL("shared/nested/helper.ts", sources.url)
  await Bun.write(helper, "export const value = 1")
  await Bun.write(entry, 'export { value as default } from "./link"')
  await symlink(fileURLToPath(helper), fileURLToPath(new URL("plugin/link.ts", sources.url)))
  expect((await sources.read(entry.href)).module).toMatchObject({ default: 1 })
  const count = changes
  await Bun.write(new URL(helper.href + ".new"), "export const value = 2")
  await rename(new URL(helper.href + ".new"), helper)
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (changes > count) break
    await Bun.sleep(10)
  }
  expect(changes).toBeGreaterThan(count)
  expect((await sources.read(entry.href)).module).toMatchObject({ default: 2 })
})

test.each(["", "?mode=plugin", "?mode=plugin#section"])(
  "Node reloads the local ESM graph without relocating source files: %s",
  async (suffix) => {
    await using dir = await tmpdir()
    const script = path.join(dir.path, "probe.ts")
    await Bun.write(
      script,
      `
    import { createPluginSources } from ${JSON.stringify(fileURLToPath(new URL("../src/plugin/source.ts", import.meta.url)))}
    import { mkdir, symlink, writeFile } from "node:fs/promises"
    import { fileURLToPath } from "node:url"
    import assert from "node:assert/strict"
    const entry = new URL("./entry.mjs", import.meta.url)
    const helper = new URL("./helper.mjs", import.meta.url)
    const suffix = ${JSON.stringify(suffix)}
    const watched = []
    const sources = createPluginSources(async file => { watched.push(file) })
    try {
      const library = new URL("./shared/index.mjs", import.meta.url)
      await mkdir(new URL("./shared", import.meta.url), { recursive: true })
      await writeFile(library, 'export default { shared: true }')
      await mkdir(new URL("./node_modules", import.meta.url), { recursive: true })
      await symlink(fileURLToPath(new URL("./shared", import.meta.url)), fileURLToPath(new URL("./node_modules/example", import.meta.url)), process.platform === "win32" ? "junction" : "dir")
      const external = await import(library.href)
      await writeFile(entry, 'import state from "./node_modules/example/index.mjs"; export { state }; export { value as default, source } from "./helper.mjs' + suffix + '"')
      await writeFile(helper, 'export const value = 1; export const source = import.meta.url')
      const initial = await sources.read(entry.href)
      assert.equal(initial.module.default, 1)
      assert.equal(initial.module.state, external.default)
      assert.equal(new URL(initial.module.source).pathname, helper.pathname)
      assert.equal(new URL(initial.module.source).searchParams.get("mode"), suffix ? "plugin" : null)
      assert.equal(new URL(initial.module.source).hash, suffix.includes("#") ? "#section" : "")
      assert.equal(await sources.read(entry.href), initial)
      await writeFile(helper, 'export const value = 2; export const source = import.meta.url')
      const updated = (await sources.read(entry.href)).module
      assert.equal(updated.default, 2)
      assert.equal(updated.state, external.default)
      assert.equal(watched.includes(fileURLToPath(library)), false)
      assert.equal(new URL(updated.source).pathname, helper.pathname)
      assert.equal(new URL(updated.source).searchParams.get("mode"), suffix ? "plugin" : null)
      assert.equal(new URL(updated.source).hash, suffix.includes("#") ? "#section" : "")
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
    const child = Bun.spawn(["node", "--no-warnings", path.join(dir.path, "probe.mjs")], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ stdout, stderr, exit }).toEqual({ stdout: "node graph reload passed\n", stderr: "", exit: 0 })
  },
)

test("computed imports retain the importing helper's resolution base", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(entry, 'import { read } from "./nested/reader"; export default await read("./leaf.mjs")')
  await Bun.write(
    new URL("nested/reader.ts", sources.url),
    "export const read = async (name: string) => (await import(name)).default",
  )
  await Bun.write(new URL("nested/leaf.mjs", sources.url), 'export default "computed"')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "computed" })
})

test("empty source modules remain valid dependencies", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(entry, 'import "./empty"; export default "ready"')
  await Bun.write(new URL("empty.ts", sources.url), "")
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "ready" })
})

test("folded imports are watched and dead imports need not be installed", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL("helper.ts", sources.url)
  await Bun.write(entry, 'if (false) require("not-installed"); export default (await import("./" + "helper")).default')
  await Bun.write(helper, 'export default "before"')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "before" })
  await Bun.write(helper, 'export default "after"')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "after" })
})

test("cycles retain one canonical entrypoint per generation and old bindings stay pinned", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(
    entry,
    'import { read } from "./helper"; export const value = {}; export default () => read() === value',
  )
  await Bun.write(new URL("helper.ts", sources.url), 'import { value } from "./tui"; export const read = () => value')
  const before = (await sources.read(entry.href)).module
  if (typeof before !== "object" || before === null || !("default" in before) || typeof before.default !== "function")
    throw new Error("Missing cycle fixture")
  expect(before.default()).toBe(true)
  await Bun.write(
    entry,
    'import { read } from "./helper"; export const value = { changed: true }; export default () => read() === value',
  )
  const after = (await sources.read(entry.href)).module
  if (typeof after !== "object" || after === null || !("default" in after) || typeof after.default !== "function")
    throw new Error("Missing cycle fixture")
  expect(after.default()).toBe(true)
  expect(before.default()).toBe(true)
})

test("old callbacks keep native deferred-import behavior after a failed replacement", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL("helper.ts", sources.url)
  await Bun.write(entry, 'export default async () => (await import("./helper")).default')
  await Bun.write(helper, 'export default "old helper"')
  const before = (await sources.read(entry.href)).module
  if (typeof before !== "object" || before === null || !("default" in before) || typeof before.default !== "function")
    throw new Error("Missing deferred fixture")
  await Bun.write(helper, 'export default "new helper"')
  await Bun.write(entry, 'throw new Error("replacement failed"); export default null')
  await expect(sources.read(entry.href)).rejects.toThrow("replacement failed")
  // Best-effort reload retains the registration, not a snapshot of files that
  // its callbacks have not imported yet.
  expect(await before.default()).toBe("new helper")
})

test("each helper resolves packages from its own directory", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(
    entry,
    'import { Plugin } from "@opencode-ai/plugin/tui"; import value from "./nested/helper"; export default { Plugin, value }',
  )
  await Bun.write(new URL("nested/helper.ts", sources.url), 'import value from "example"; export default value')
  for (const directory of ["", "nested/"]) {
    await Bun.write(
      new URL(directory + "node_modules/example/package.json", sources.url),
      '{"type":"module","main":"index.js"}',
    )
    await Bun.write(
      new URL(directory + "node_modules/example/index.js", sources.url),
      `export default ${JSON.stringify(directory || "root")}`,
    )
  }
  expect((await sources.read(entry.href)).module).toMatchObject({ default: { value: "nested/" } })
})

test("a warm deferred import can retain its native cache after a failed replacement", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL("helper.mjs", sources.url)
  await Bun.write(entry, 'export default async () => (await import("./helper.mjs")).default')
  await Bun.write(helper, 'export default "cached"')
  const before = (await sources.read(entry.href)).module
  if (typeof before !== "object" || before === null || !("default" in before) || typeof before.default !== "function")
    throw new Error("Missing deferred fixture")
  expect(await before.default()).toBe("cached")
  await Bun.write(helper, 'export default "changed"')
  await Bun.write(entry, 'throw new Error("replacement failed"); export default null')
  await expect(sources.read(entry.href)).rejects.toThrow("replacement failed")
  expect(await before.default()).toBe("cached")
})

test("computed-only dependencies remain outside static reload tracking", async () => {
  const watched: string[] = []
  await using sources = await fixture(async (file) => {
    watched.push(file)
  })
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL("helper.mjs", sources.url)
  await Bun.write(entry, "export default async name => (await import(name)).default")
  await Bun.write(helper, 'export default "cached"')
  const before = await sources.read(entry.href)
  const mod = before.module
  if (typeof mod !== "object" || mod === null || !("default" in mod) || typeof mod.default !== "function")
    throw new Error("Missing computed fixture")
  expect(await mod.default("./helper.mjs")).toBe("cached")
  await Bun.write(helper, 'export default "changed"')
  expect(watched).not.toContain(fileURLToPath(helper))
  expect(await sources.read(entry.href)).toBe(before)
})

test("unchanged evaluation failures do not repeat import-time effects", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const code = `import { appendFileSync } from "node:fs"
    appendFileSync(new URL("./attempts.log", import.meta.url), "attempt\\n")
    throw new Error("broken evaluation")`
  await Bun.write(entry, code)
  await expect(sources.read(entry.href)).rejects.toThrow("broken evaluation")
  await expect(sources.read(entry.href)).rejects.toThrow("broken evaluation")
  expect(await Bun.file(new URL("attempts.log", sources.url)).text()).toBe("attempt\n")
  await Bun.write(entry, code + "\n// another generation")
  await expect(sources.read(entry.href)).rejects.toThrow("broken evaluation")
  expect(await Bun.file(new URL("attempts.log", sources.url)).text()).toBe("attempt\nattempt\n")
})

test.each([
  'export default await import("not-installed-pkg").then(m => m.default, () => "fallback")',
  'let value; try { value = (await import("not-installed-pkg")).default } catch { value = "fallback" }; export default value',
  'let value; try { value = require("not-installed-pkg") } catch { value = "fallback" }; export default value',
  'export default await import("./not-installed").then(m => m.default, () => "fallback")',
  'let value; try { value = require("./not-installed") } catch { value = "fallback" }; export default value',
])("optional dependencies keep their runtime fallback: %s", async (code) => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(entry, code)
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "fallback" })
})

test("installed optional dependencies still resolve beside the importing source", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(new URL("node_modules/example/package.json", sources.url), '{"main":"index.cjs"}')
  await Bun.write(new URL("node_modules/example/index.cjs", sources.url), 'module.exports = "installed"')
  await Bun.write(
    entry,
    `const dynamic = await import("example").then(m => m.default, () => "fallback")
    let sync; try { sync = require("example") } catch { sync = "fallback" }
    export default { dynamic, sync }`,
  )
  expect((await sources.read(entry.href)).module).toMatchObject({
    default: { dynamic: "installed", sync: "installed" },
  })
})

test("computed imports reject asynchronously and capture their argument at the call site", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(new URL("one.mjs", sources.url), 'export default "one"')
  await Bun.write(new URL("two.mjs", sources.url), 'export default "two"')
  await Bun.write(new URL("data.json", sources.url), '{"value":7}')
  await Bun.write(
    entry,
    `const load = name => import(name)
    const fallback = await load("not-installed-pkg").then(m => m.default, () => "fallback")
    let name = "./one.mjs"
    const pending = import(name)
    name = "./two.mjs"
    const json = name => import(name, { with: { type: "json" } })
    export default { fallback, value: (await pending).default, json: (await json("./data.json")).default.value }`,
  )
  expect((await sources.read(entry.href)).module).toMatchObject({
    default: { fallback: "fallback", value: "one", json: 7 },
  })
})

test("missing static dependencies still fail the plugin load", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(entry, 'import value from "not-installed-pkg"; export default value')
  await expect(sources.read(entry.href)).rejects.toThrow("not-installed-pkg")
})

test.each([false, true])("plugin errors retain source filenames (during load: %s)", async (duringLoad) => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(
    new URL("nested/helper.ts", sources.url),
    'export function boom() { void import.meta.url; throw new Error("source trace") }',
  )
  await Bun.write(entry, `import { boom } from "./nested/helper"; ${duringLoad ? "boom();" : ""} export default boom`)
  const error = await (async () => {
    try {
      const loaded = (await sources.read(entry.href)).module
      if (
        typeof loaded !== "object" ||
        loaded === null ||
        !("default" in loaded) ||
        typeof loaded.default !== "function"
      )
        throw new Error("Missing stack fixture")
      loaded.default()
      return undefined
    } catch (error) {
      return error
    }
  })()
  expect(error).toBeInstanceOf(Error)
  if (!(error instanceof Error)) throw error
  expect(error.message).toBe("source trace")
  expect(error.stack).toMatch(/nested[/\\]helper\.ts:\d+:\d+/)
})

test.each([
  ["static import", 'import value from "example"; export default value', "import"],
  ["dynamic import", 'export default (await import("example")).default', "import"],
  ["literal require", 'export default require("example")', "require"],
  ["computed require", 'const read = name => require(name); export default read("example")', "require"],
  ["require alias", 'const read = require; export default read("example")', "require"],
  ["require.resolve", 'export default require(require.resolve("example"))', "require"],
  ["import.meta.require", 'export default import.meta.require("example")', "require"],
  ["shadowed require", 'const read = require => require("example"); export default read(name => name)', "example"],
  ["computed local require", 'const read = name => require(name); export default read("./data.json").value', "local"],
  [
    "computed optional require",
    'const read = name => { try { return require(name) } catch { return "fallback" } }; export default read("not-installed-pkg")',
    "fallback",
  ],
])("%s preserves direct runtime resolution", async (_name, code, expected) => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(
    new URL("node_modules/example/package.json", sources.url),
    JSON.stringify({
      exports: { import: "./import.mjs", require: "./require.cjs" },
    }),
  )
  await Bun.write(new URL("node_modules/example/import.mjs", sources.url), 'export default "import"')
  await Bun.write(new URL("node_modules/example/require.cjs", sources.url), 'module.exports = "require"')
  await Bun.write(new URL("data.json", sources.url), '{"value":"local"}')
  await Bun.write(entry, code)
  expect(await Host.load(entry.href)).toMatchObject({ default: expected })
  expect((await sources.read(entry.href)).module).toMatchObject({ default: expected })
})

test.each(["ts", "tsx"])("%s helpers preserve source path globals and lexical bindings", async (extension) => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL(`nested/helper.${extension}`, sources.url)
  await Bun.write(
    helper,
    `export default {
    file: __filename, dir: __dirname,
    shadowed: ((__filename, __dirname) => [__filename, __dirname])("file", "dir"),
    asset: await Bun.file(__dirname + "/asset.txt").text(),
  }`,
  )
  await Bun.write(new URL("nested/asset.txt", sources.url), "asset")
  await Bun.write(entry, `export { default } from "./nested/helper.${extension}"`)
  const expected = {
    default: {
      file: fileURLToPath(helper),
      dir: path.dirname(fileURLToPath(helper)),
      shadowed: ["file", "dir"],
      asset: "asset",
    },
  }
  expect(await Host.load(entry.href)).toMatchObject(expected)
  expect((await sources.read(entry.href)).module).toMatchObject(expected)
})

test("createRequire retains its explicit package resolution base", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  for (const directory of ["", "nested/"]) {
    await Bun.write(new URL(directory + "node_modules/example/package.json", sources.url), '{"main":"index.cjs"}')
    await Bun.write(
      new URL(directory + "node_modules/example/index.cjs", sources.url),
      `module.exports = ${JSON.stringify(directory || "root")}`,
    )
  }
  await Bun.write(
    entry,
    `import { createRequire } from "node:module"
    const require = createRequire(new URL("./nested/helper.ts", import.meta.url))
    export default require("example")`,
  )
  expect(await Host.load(entry.href)).toMatchObject({ default: "nested/" })
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "nested/" })
})

test("deferred require callbacks use the invalidated native cache", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL("data.json", sources.url)
  await Bun.write(entry, 'export default () => require("./data.json").value')
  await Bun.write(helper, '{"value":"before"}')
  const before = (await sources.read(entry.href)).module
  if (typeof before !== "object" || before === null || !("default" in before) || typeof before.default !== "function")
    throw new Error("Missing require fixture")
  await Bun.write(helper, '{"value":"after"}')
  const after = (await sources.read(entry.href)).module
  if (typeof after !== "object" || after === null || !("default" in after) || typeof after.default !== "function")
    throw new Error("Missing require fixture")
  expect(before.default()).toBe("after")
  expect(after.default()).toBe("after")
})

test("local package requires select main rather than the ESM module field", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(new URL("helper/package.json", sources.url), '{"main":"require.cjs","module":"import.mjs"}')
  await Bun.write(new URL("helper/require.cjs", sources.url), 'module.exports = "require"')
  await Bun.write(new URL("helper/import.mjs", sources.url), 'export default "import"')
  await Bun.write(entry, 'export default require("./helper")')
  expect(await Host.load(entry.href)).toMatchObject({ default: "require" })
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "require" })
})

test.each([
  'import value from "example"; export default value',
  'export default (await import("example")).default',
  'import value from "./node_modules/example/index.js"; export default value',
])("symlinked package instances remain external: %s", async (code) => {
  const watched: string[] = []
  await using sources = await fixture(async (file) => {
    watched.push(file)
  })
  const entry = new URL("plugin/tui.ts", sources.url)
  const library = new URL("lib/index.js", sources.url)
  await Bun.write(new URL("lib/package.json", sources.url), '{"type":"module","main":"index.js"}')
  await Bun.write(library, 'export default { value: "shared" }')
  await mkdir(new URL("plugin/node_modules", sources.url), { recursive: true })
  await symlink(
    fileURLToPath(new URL("lib", sources.url)),
    fileURLToPath(new URL("plugin/node_modules/example", sources.url)),
    process.platform === "win32" ? "junction" : "dir",
  )
  const host = await Host.load(library.href)
  if (typeof host !== "object" || host === null || !("default" in host)) throw new Error("Missing package fixture")
  for (const generation of [1, 2]) {
    await Bun.write(entry, `${code}; export const generation = ${generation}`)
    const loaded = (await sources.read(entry.href)).module
    if (typeof loaded !== "object" || loaded === null || !("default" in loaded))
      throw new Error("Missing plugin fixture")
    expect(loaded.default).toBe(host.default)
    expect(loaded).toMatchObject({ generation })
  }
  expect(watched).not.toContain(fileURLToPath(library))
})

test.each(["static", "query", "file-query", "dynamic-query"])(
  "JSON text %s imports survive graph resolution and edits",
  async (kind) => {
    await using sources = await fixture()
    const entry = new URL("tui.ts", sources.url)
    const json = new URL("data.json", sources.url)
    const specifier = kind === "file-query" ? json.href + "?v=1" : "./data.json" + (kind === "static" ? "" : "?v=1")
    await Bun.write(
      entry,
      kind === "dynamic-query"
        ? `const text = (await import(${JSON.stringify(specifier)}, { with: { type: "text" } })).default; export default JSON.parse(text).value`
        : `import text from ${JSON.stringify(specifier)} with { type: "text" }; export default JSON.parse(text).value`,
    )
    await Bun.write(json, '{"value":"before"}')
    expect(await Host.load(entry.href)).toMatchObject({ default: "before" })
    expect((await sources.read(entry.href)).module).toMatchObject({ default: "before" })
    await Bun.write(json, '{"value":"after"}')
    expect((await sources.read(entry.href)).module).toMatchObject({ default: "after" })
  },
)

test.each(["mjs", "json"])("literal %s query imports are watched and reloaded natively", async (extension) => {
  const watched: string[] = []
  await using sources = await fixture(async (file) => {
    watched.push(file)
  })
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL(`helper.${extension}`, sources.url)
  const prefix = extension === "json" ? "" : "export default "
  await Bun.write(entry, `export default async () => (await import("./helper.${extension}?mode=plugin")).default`)
  await Bun.write(helper, prefix + '"before"')
  const before = (await sources.read(entry.href)).module
  if (typeof before !== "object" || before === null || !("default" in before) || typeof before.default !== "function")
    throw new Error("Missing query fixture")
  await Bun.write(helper, prefix + '"after"')
  await Bun.write(entry, 'throw new Error("replacement failed"); export default null')
  await expect(sources.read(entry.href)).rejects.toThrow("replacement failed")
  expect(watched).toContain(fileURLToPath(helper))
  expect(await before.default()).toBe("after")
  await Bun.write(entry, `export { default } from "./helper.${extension}?mode=plugin"`)
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "after" })
  await Bun.write(helper, prefix + '"repaired"')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "repaired" })
})

test("query spellings retain distinct module identities and source URLs", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL("helper.mjs", sources.url)
  await Bun.write(
    helper,
    "export default { url: import.meta.url, path: import.meta.path, file: import.meta.file, filename: __filename }",
  )
  await Bun.write(
    entry,
    'import one from "./helper.mjs?one/path"; import two from "./helper.mjs?two"; export default { same: one === two, ...one }',
  )
  const expected = {
    default: {
      same: false,
      url: helper.href + "?one/path",
      path: fileURLToPath(helper),
      file: "helper.mjs",
      filename: fileURLToPath(helper),
    },
  }
  expect(await Host.load(entry.href)).toMatchObject(expected)
  expect((await sources.read(entry.href)).module).toMatchObject(expected)
})

test("literal file URLs retain source loading and helper edits", async () => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  const helper = new URL("helper.ts", sources.url)
  await Bun.write(helper, 'export default "before"')
  await Bun.write(entry, `export { default } from ${JSON.stringify(helper.href)}`)
  expect(await Host.load(entry.href)).toMatchObject({ default: "before" })
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "before" })
  await Bun.write(helper, 'export default "after"')
  expect((await sources.read(entry.href)).module).toMatchObject({ default: "after" })
})

test.each(["ts", "tsx"])("%s wildcard package barrels retain live exports", async (extension) => {
  await using sources = await fixture()
  const entry = new URL("tui.ts", sources.url)
  await Bun.write(new URL("node_modules/example/package.json", sources.url), '{"type":"module","main":"index.js"}')
  await Bun.write(
    new URL("node_modules/example/index.js", sources.url),
    'export default { value: "package" }; export let count = 0; export const increment = () => count++',
  )
  await Bun.write(
    new URL(`helper.${extension}`, sources.url),
    'export * from "example"; import value from "example"; export default value',
  )
  await Bun.write(entry, `export { default } from "./helper.${extension}"`)
  expect(await Host.load(entry.href)).toMatchObject({ default: { value: "package" } })
  expect((await sources.read(entry.href)).module).toMatchObject({ default: { value: "package" } })
  await Bun.write(entry, `export { default, count, increment } from "./helper.${extension}"`)
  const loaded = (await sources.read(entry.href)).module
  if (
    typeof loaded !== "object" ||
    loaded === null ||
    !("increment" in loaded) ||
    typeof loaded.increment !== "function"
  )
    throw new Error("Missing barrel fixture")
  expect(loaded).toMatchObject({ default: { value: "package" }, count: 0 })
  loaded.increment()
  expect(loaded).toMatchObject({ count: 1 })
})

async function fixture(watch: (file: string) => Promise<void> = async () => {}) {
  const dir = await tmpdir()
  const sources = createPluginSources(watch)
  return {
    ...sources,
    url: pathToFileURL(dir.path + path.sep),
    async [Symbol.asyncDispose]() {
      sources.dispose()
      await dir[Symbol.asyncDispose]()
    },
  }
}
