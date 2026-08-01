import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "bun:test"
import { discoverTuiPlugins, tuiPluginDirectories } from "../src/plugin/discovery"
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

  expect(
    await discoverTuiPlugins(
      await tuiPluginDirectories({
        cwd: tmp.path,
        projectDirectory: tmp.path,
        configDirectory: path.join(tmp.path, "config"),
      }),
    ),
  ).toEqual([path.join(directory, "first.js"), path.join(directory, "second.tsx")])
})

test("returns no project TUI plugins when the directory is absent", async () => {
  await using tmp = await tmpdir()
  expect(
    await discoverTuiPlugins(
      await tuiPluginDirectories({
        cwd: tmp.path,
        projectDirectory: tmp.path,
        configDirectory: path.join(tmp.path, "config"),
      }),
    ),
  ).toEqual([])
})

test("discovers global and ancestor plugin roots in precedence order", async () => {
  await using tmp = await tmpdir()
  const cwd = path.join(tmp.path, "repo", "packages", "app")
  const project = path.join(tmp.path, "repo")
  const config = path.join(tmp.path, "config")
  const directories = [
    path.join(config, "plugins", "tui"),
    path.join(tmp.path, "repo", ".opencode", "plugins", "tui"),
    path.join(tmp.path, "repo", "packages", ".opencode", "plugins", "tui"),
  ]
  await Promise.all(directories.map((directory) => mkdir(directory, { recursive: true })))
  await Promise.all(
    directories.map((directory, index) => writeFile(path.join(directory, `${index}.ts`), "export default {}")),
  )

  const roots = await tuiPluginDirectories({ cwd, projectDirectory: project, configDirectory: config })
  expect(await discoverTuiPlugins(roots)).toEqual(
    directories.map((directory, index) => path.join(directory, `${index}.ts`)),
  )
  expect(roots).not.toContain(path.join(cwd, ".opencode", "plugins", "tui"))
})
