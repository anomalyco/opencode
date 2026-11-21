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

test.each([
  {
    name: "unmatched and malformed entries",
    document: {
      plugins: [keep, null, false, [], [target, {}]],
      plugin: [keep, null, [], [target], [target, null], [target, []], [target, {}, "extra"], { package: target }],
    },
  },
  { name: "an unsupported legacy value", document: { plugin: { package: target } } },
])("leaves $name unchanged", async (input) => {
  await using root = await tmpdir()
  const file = path.join(root.path, "opencode.jsonc")
  const text = `// Preserve the original bytes\n${JSON.stringify(input.document, null, 2)}`
  await writeFile(file, text)

  expect(await removePluginConfig(file, target)).toBe(false)
  expect(await readFile(file, "utf8")).toBe(text)
})

test.each([
  { text: "{", message: "Invalid global configuration" },
  { text: "[]", message: "Invalid global configuration" },
  { text: JSON.stringify({ plugins: {}, plugin: [target] }), message: "Invalid plugins configuration" },
])("rejects $text without writing", async (input) => {
  await using root = await tmpdir()
  const file = path.join(root.path, "opencode.jsonc")
  await writeFile(file, input.text)

  await expect(removePluginConfig(file, target)).rejects.toThrow(`${input.message}: ${file}`)
  expect(await readFile(file, "utf8")).toBe(input.text)
})

test("does not create a missing configuration file", async () => {
  await using root = await tmpdir()
  const file = path.join(root.path, "opencode.jsonc")

  expect(await removePluginConfig(file, target)).toBe(false)
  expect(await Bun.file(file).exists()).toBe(false)
})
