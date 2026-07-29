import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "bun:test"
import { discoverTuiPlugins } from "../src/plugin/discovery"
import { tmpdir } from "./fixture/fixture"

test("discovers project TUI plugin files in stable order", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, ".opencode", "plugins", "tui")
  await mkdir(path.join(directory, "nested"), { recursive: true })
  await Promise.all([
    writeFile(path.join(directory, "second.tsx"), "export default {}"),
    writeFile(path.join(directory, "first.js"), "export default {}"),
    writeFile(path.join(directory, "ignored.json"), "{}"),
    writeFile(path.join(directory, "nested", "ignored.ts"), "export default {}"),
  ])

  expect(await discoverTuiPlugins(tmp.path)).toEqual([
    path.join(directory, "first.js"),
    path.join(directory, "second.tsx"),
  ])
})

test("returns no project TUI plugins when the directory is absent", async () => {
  await using tmp = await tmpdir()
  expect(await discoverTuiPlugins(tmp.path)).toEqual([])
})
