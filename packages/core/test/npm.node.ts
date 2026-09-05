import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { resolveModule } from "#npm-resolve"
import "./fixture/npm-require.node.ts"

const cases = [
  { title: "string exports", manifest: { exports: "./entry.mjs" }, file: "entry.mjs" },
  {
    title: "npm alias with a different manifest name",
    manifest: { name: "@fixture/original", exports: "./entry.mjs" },
    file: "entry.mjs",
  },
  {
    title: "nested import conditions",
    manifest: { exports: { ".": { node: { import: "./entry.mjs", require: "./wrong.cjs" } } } },
    file: "entry.mjs",
  },
  {
    title: "export condition key order",
    manifest: { exports: { ".": { default: "./entry.mjs", import: "./wrong.mjs" } } },
    file: "entry.mjs",
  },
  {
    title: "runtime module-sync condition",
    manifest: { exports: { ".": { "module-sync": "./entry.mjs", import: "./wrong.mjs" } } },
    file: "entry.mjs",
  },
  {
    title: "custom runtime condition",
    manifest: { exports: { ".": { "fixture-provider": "./entry.mjs", default: "./wrong.mjs" } } },
    file: "entry.mjs",
  },
  { title: "legacy main", manifest: { main: "./entry.cjs" }, file: "entry.cjs" },
  { title: "legacy index", manifest: {}, file: "index.js" },
]

for (const fixture of cases) {
  test(fixture.title, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "opencode-npm-node-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const directory = path.join(root, "node_modules", "@fixture", "provider")
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "@fixture/provider", ...fixture.manifest }),
    )
    await writeFile(
      path.join(directory, fixture.file),
      fixture.file.endsWith(".mjs")
        ? 'export const createFixture = () => "loaded"'
        : 'exports.createFixture = () => "loaded"',
    )

    // The previous Node branch returned this directory URL instead of an entry file.
    await assert.rejects(import(pathToFileURL(directory).href), { code: "ERR_UNSUPPORTED_DIR_IMPORT" })
    const entrypoint = resolveModule("@fixture/provider", directory)
    assert.equal(entrypoint, pathToFileURL(path.join(directory, fixture.file)).href)
    assert.equal((await import(entrypoint)).createFixture(), "loaded")
  })
}

for (const exports of [{ ".": { require: "./index.js" } }, { "./other": "./index.js" }, { ".": null }]) {
  test(`does not bypass unavailable root exports: ${JSON.stringify(exports)}`, async (t) => {
    const directory = await mkdtemp(path.join(tmpdir(), "opencode-npm-node-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({ name: "fixture", exports, main: "index.js" }),
    )
    await writeFile(path.join(directory, "index.js"), "exports.fixture = true")
    assert.throws(() => resolveModule("fixture", directory))
  })
}
