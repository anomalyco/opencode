import { expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "jsonc-parser"
import { removePluginConfig } from "../src/commands/handlers/plugin/remove"
import { tmpdir } from "./fixture/tmpdir"

const target = "@fixture/remove"
const keep = "@fixture/keep"

test.each([
  {
    name: "native strings and objects",
    before: { plugins: [target, { package: target, options: { enabled: true } }, keep] },
    after: { plugins: [keep] },
  },
  {
    name: "legacy strings",
    before: { plugin: [target, keep] },
    after: { plugin: [keep] },
  },
  {
    name: "legacy tuples",
    before: { plugin: [[target, { enabled: true }], [keep, { retained: true }]] },
    after: { plugin: [[keep, { retained: true }]] },
  },
  {
    name: "mixed lists",
    before: { plugin: [target], plugins: [target, keep] },
    after: { plugin: [], plugins: [keep] },
  },
])("removes $name without changing unrelated configuration", async (input) => {
  await using root = await tmpdir()
  const file = path.join(root.path, "opencode.jsonc")
  const prefix = '// Preserved comment\n{\n  "model"  : "example/chat",\n'
  await writeFile(file, prefix + JSON.stringify(input.before, null, 2).slice(2) + "\n")

  expect(await removePluginConfig(file, target)).toBe(true)
  const saved = await readFile(file, "utf8")
  expect(saved.startsWith(prefix)).toBe(true)
  expect(parse(saved)).toEqual({ model: "example/chat", ...input.after })

  expect(await removePluginConfig(file, target)).toBe(false)
  expect(await readFile(file, "utf8")).toBe(saved)
})

test("leaves unmatched plugin lists unchanged", async () => {
  await using root = await tmpdir()
  const file = path.join(root.path, "opencode.jsonc")
  const text = `// Preserve the original bytes\n${JSON.stringify({
    plugins: [keep, { package: keep }],
    plugin: [keep, [keep, { enabled: true }]],
  }, null, 2)}`
  await writeFile(file, text)

  expect(await removePluginConfig(file, target)).toBe(false)
  expect(await readFile(file, "utf8")).toBe(text)
})
