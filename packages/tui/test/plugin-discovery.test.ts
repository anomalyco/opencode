import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, test } from "bun:test"
import { discoverTuiPlugins, tuiPluginDirectories } from "../src/plugin/discovery"
import { localProjectDirectory } from "../src/util/config-directories"
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

  expect(await discoverTuiPlugins(await tuiPluginDirectories(tmp.path, path.join(tmp.path, "config")))).toEqual([
    path.join(directory, "first.js"),
    path.join(directory, "second.tsx"),
  ])
})

test("returns no project TUI plugins when the directory is absent", async () => {
  await using tmp = await tmpdir()
  const roots = await tuiPluginDirectories(tmp.path, path.join(tmp.path, "config"))
  expect(await discoverTuiPlugins(roots)).toEqual([])
  expect(roots).toContain(path.join(tmp.path, ".opencode", "plugins", "tui"))
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
  const outside = path.join(tmp.path, ".opencode", "plugins", "tui")
  await mkdir(path.join(project, ".git"), { recursive: true })
  await Promise.all([...directories, outside].map((directory) => mkdir(directory, { recursive: true })))
  await Promise.all(
    directories.map((directory, index) => writeFile(path.join(directory, `${index}.ts`), "export default {}")),
  )
  await writeFile(path.join(outside, "outside.ts"), "export default {}")

  const roots = await tuiPluginDirectories(cwd, config)
  expect(await discoverTuiPlugins(roots)).toEqual(
    directories.map((directory, index) => path.join(directory, `${index}.ts`)),
  )
  expect(roots).not.toContain(path.join(cwd, ".opencode", "plugins", "tui"))
  expect(roots).not.toContain(outside)
})

test("uses an Hg root for a missing project plugin directory", async () => {
  await using tmp = await tmpdir()
  const project = path.join(tmp.path, "repo")
  const cwd = path.join(project, "package")
  await mkdir(path.join(project, ".hg"), { recursive: true })
  await mkdir(cwd, { recursive: true })

  expect(await tuiPluginDirectories(cwd, path.join(tmp.path, "config"))).toContain(
    path.join(project, ".opencode", "plugins", "tui"),
  )
})

test("propagates non-missing filesystem errors", async () => {
  await expect(localProjectDirectory("\0")).rejects.toBeInstanceOf(Error)
  await expect(discoverTuiPlugins(["\0"])).rejects.toBeInstanceOf(Error)
})
