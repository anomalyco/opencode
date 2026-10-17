import { expect, test } from "bun:test"
import path from "node:path"
import { writePluginConfig } from "../src/commands/handlers/plugin/add"
import { tmpdir } from "./fixture/tmpdir"

test.each([
  ["@example/plugin@0.1.1", "@example/plugin@0.1.4"],
  ["example-plugin@1.0.0", "example-plugin@2.0.0"],
  ["@example/plugin", "@example/plugin@latest"],
  [{ package: "@example/plugin@next", options: { enabled: false } }, "@example/plugin@1.0.0"],
])("refuses another registry spec for %j", async (entry, spec) => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.jsonc")
  const text = `// keep plugin options\n${JSON.stringify({ plugins: [entry] })}\n`
  await Bun.write(file, text)

  await expect(writePluginConfig(file, spec)).rejects.toThrow("opencode plugin remove")
  expect(await Bun.file(file).text()).toBe(text)
})

test("keeps exact string and object entries idempotent", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.json")
  for (const plugins of [
    ["@example/plugin@1.0.0"],
    [{ package: "@example/plugin@1.0.0", options: { enabled: false } }],
    ["@example/plugin@0.1.1", "@example/plugin@1.0.0"],
  ]) {
    const text = JSON.stringify({ plugins })
    await Bun.write(file, text)
    expect(await writePluginConfig(file, "@example/plugin@1.0.0")).toBe(false)
    expect(await Bun.file(file).text()).toBe(text)
  }
})

test("adds new packages without treating Git specs or name prefixes as registry duplicates", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.json")
  const plugins = ["example-plugin-extra@1.0.0", "example-plugin@git+https://github.com/example/plugin.git#main"]
  await Bun.write(file, JSON.stringify({ plugins }))
  expect(await writePluginConfig(file, "example-plugin@2.0.0")).toBe(true)
  expect(await Bun.file(file).json()).toEqual({ plugins: [...plugins, "example-plugin@2.0.0"] })
})
