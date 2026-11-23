import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Host } from "@opencode/plugin/host"
import { configurationTarget } from "../src/commands/handlers/plugin/add"
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
