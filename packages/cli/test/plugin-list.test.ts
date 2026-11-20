import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { format } from "../src/commands/handlers/plugin/list"
import { tmpdir } from "./fixture/tmpdir"

const idColumn = (output: string) =>
  output
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("ID"))
    .map((line) => line.split(/\s{2,}/)[0])

test("gives a TUI-only local plugin its package name as the ID instead of -", async () => {
  await using root = await tmpdir()
  const directory = path.join(root.path, "my-tui-plugin")
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "my-tui-plugin" }))

  expect(idColumn(format([], [{ target: directory, version: "1.0.0" }]))).toEqual(["my-tui-plugin"])
})

test("falls back to the directory basename when a TUI-only plugin has no package name", async () => {
  await using root = await tmpdir()
  const directory = path.join(root.path, "weird-dir-name")
  await mkdir(directory, { recursive: true })

  expect(idColumn(format([], [{ target: directory, version: "1.0.0" }]))).toEqual(["weird-dir-name"])
})

test("uses the package name for an npm-style TUI-only plugin target", () => {
  expect(idColumn(format([], [{ target: "opencode-coding-quota", version: "0.2.2" }]))).toEqual([
    "opencode-coding-quota",
  ])
})
