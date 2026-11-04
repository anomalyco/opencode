import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { parse } from "jsonc-parser"
import { Host } from "@opencode/plugin/host"
import { configurationTarget, writePluginConfig } from "../src/commands/handlers/plugin/add"
import { readSetup } from "../src/commands/handlers/plugin/setup"
import { tmpdir } from "./fixture/tmpdir"

const name = "@fixture/plugin"
const parts = {
  server: { ".": "./index.js" },
  tui: { "./tui": "./tui.js" },
  gui: { "./gui-experimental": "./gui-experimental.cjs" },
}

test.each([
  { parts: ["gui"] as const, target: "server" },
  { parts: ["tui", "gui"] as const, target: "server" },
  { parts: ["server"] as const, target: "server" },
  { parts: ["server", "tui", "gui"] as const, target: "server" },
  { parts: ["tui"] as const, target: "tui" },
  { parts: [] as const, target: undefined },
])("configures a package with $parts parts in the $target config", async (input) => {
  await using root = await tmpdir()
  const directory = path.join(root.path, "node_modules", name)
  const exports = Object.assign({}, ...input.parts.map((part) => parts[part]))
  await mkdir(directory, { recursive: true })
  await Promise.all([
    writeFile(path.join(directory, "package.json"), JSON.stringify({ name, exports })),
    ...Object.values(exports).map((file) => writeFile(path.join(directory, String(file)), "")),
  ])

  expect(configurationTarget(Host.resolve({ directory, name }))).toBe(input.target)
})

test("setup saves options and secret references without duplicating an existing plugin", async () => {
  await using root = await tmpdir()
  const file = path.join(root.path, "opencode.jsonc")
  await writeFile(
    file,
    `{
  // Keep this comment
  "model": "keep-model",
  "plugins": [{ "package": "${name}", "options": { "keep": true } }, "other-plugin"]
}`,
  )
  const options = { apiKey: "{env:ACME_API_KEY}", enabled: false, region: "eu" }
  expect(await writePluginConfig(file, name, options)).toBe(true)
  expect(await Bun.file(file).text()).toContain("// Keep this comment")
  expect(parse(await Bun.file(file).text())).toEqual({
    model: "keep-model",
    plugins: [{ package: name, options: { keep: true, ...options } }, "other-plugin"],
  })
  expect(await writePluginConfig(file, name)).toBe(false)
})

test("invalid plugin config is rejected before writing", async () => {
  await using root = await tmpdir()
  const file = path.join(root.path, "opencode.json")
  const text = JSON.stringify({ plugins: [{ package: name, options: null }] })
  await writeFile(file, text)
  await expect(writePluginConfig(file, name, { enabled: true })).rejects.toThrow("Invalid global configuration")
  expect(await Bun.file(file).text()).toBe(text)
})

test("setup creates a plugin entry with options in a new config", async () => {
  await using root = await tmpdir()
  const file = path.join(root.path, "config", "opencode.json")
  expect(await writePluginConfig(file, name, { apiKey: "{file:/secrets/acme}" })).toBe(true)
  expect(await Bun.file(file).json()).toEqual({
    plugins: [{ package: name, options: { apiKey: "{file:/secrets/acme}" } }],
  })
})

test("setup reads a declaration relative to the installed package and validates its fields", async () => {
  await using root = await tmpdir()
  await mkdir(path.join(root.path, "config"))
  await writeFile(
    path.join(root.path, "package.json"),
    JSON.stringify({ opencode: { experimental: { setup: "./config/setup.json" } } }),
  )
  const setup = {
    fields: [{ key: "enabled", type: "boolean", default: false }],
    secrets: [{ key: "apiKey", title: "API key" }],
  } satisfies NonNullable<Awaited<ReturnType<typeof readSetup>>>
  const file = path.join(root.path, "config", "setup.json")
  await writeFile(file, JSON.stringify(setup))
  expect(await readSetup(root.path)).toEqual(setup)
  await writeFile(file, JSON.stringify({ fields: "invalid" }))
  await expect(readSetup(root.path)).rejects.toThrow()
  await writeFile(file, JSON.stringify({ ...setup, secrets: [{ key: "enabled" }] }))
  await expect(readSetup(root.path)).rejects.toThrow("Plugin setup field keys must be unique")
})

test("setup is optional, but a declared file must exist", async () => {
  await using root = await tmpdir()
  const file = path.join(root.path, "package.json")
  await writeFile(file, "{}")
  expect(await readSetup(root.path)).toBeUndefined()
  await writeFile(file, JSON.stringify({ opencode: { experimental: { setup: "./missing.json" } } }))
  await expect(readSetup(root.path)).rejects.toThrow()
  await writeFile(file, JSON.stringify({ opencode: { experimental: { setup: { fields: [] } } } }))
  await expect(readSetup(root.path)).rejects.toThrow()
})
