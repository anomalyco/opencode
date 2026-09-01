import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "bun:test"
import { discoverTuiPlugins, freshSpecifier, localPluginDirectories } from "../src/plugin/discovery"
import { localProjectDirectory } from "../src/util/config-directories"
import { tmpdir } from "./fixture/fixture"

test("discovers sibling TUI entrypoints in stable order", async () => {
  await using tmp = await tmpdir()
  const directory = path.join(tmp.path, ".opencode", "plugins")
  await Promise.all(["first", "second", "missing-server", "missing-tui"].map((name) => mkdir(path.join(directory, name), { recursive: true })))
  await Promise.all([
    writeFile(path.join(directory, "first", "index.ts"), "export default {}"),
    writeFile(path.join(directory, "first", "tui.js"), "export default {}"),
    writeFile(path.join(directory, "second", "index.js"), "export default {}"),
    writeFile(path.join(directory, "second", "tui.tsx"), "export default {}"),
    writeFile(path.join(directory, "missing-server", "tui.ts"), "export default {}"),
    writeFile(path.join(directory, "missing-tui", "index.ts"), "export default {}"),
    writeFile(path.join(directory, "legacy.ts"), "export default {}"),
  ])

  expect(await discoverTuiPlugins(await localPluginDirectories(tmp.path, path.join(tmp.path, "config")))).toEqual([
    path.join(directory, "first", "tui.js"),
    path.join(directory, "second", "tui.tsx"),
  ])
})

test("returns no project TUI plugins when the directory is absent", async () => {
  await using tmp = await tmpdir()
  const roots = await localPluginDirectories(tmp.path, path.join(tmp.path, "config"))
  expect(await discoverTuiPlugins(roots)).toEqual([])
  expect(roots).toContain(path.join(tmp.path, ".opencode", "plugins"))
})

test("discovers global and ancestor plugin roots in precedence order", async () => {
  await using tmp = await tmpdir()
  const cwd = path.join(tmp.path, "repo", "packages", "app")
  const project = path.join(tmp.path, "repo")
  const config = path.join(tmp.path, "config")
  const directories = [
    path.join(config, "plugins"),
    path.join(tmp.path, "repo", ".opencode", "plugins"),
    path.join(tmp.path, "repo", "packages", ".opencode", "plugins"),
  ]
  const outside = path.join(tmp.path, ".opencode", "plugins")
  await mkdir(path.join(project, ".git"), { recursive: true })
  await Promise.all([...directories, outside].map((directory) => mkdir(directory, { recursive: true })))
  await Promise.all(
    directories.map(async (directory, index) => {
      const plugin = path.join(directory, String(index))
      await mkdir(plugin, { recursive: true })
      await Promise.all([
        writeFile(path.join(plugin, "index.ts"), "export default {}"),
        writeFile(path.join(plugin, "tui.ts"), "export default {}"),
      ])
    }),
  )
  await mkdir(path.join(outside, "outside"), { recursive: true })
  await Promise.all([
    writeFile(path.join(outside, "outside", "index.ts"), "export default {}"),
    writeFile(path.join(outside, "outside", "tui.ts"), "export default {}"),
  ])

  const roots = await localPluginDirectories(cwd, config)
  expect(await discoverTuiPlugins(roots)).toEqual(
    directories.map((directory, index) => path.join(directory, String(index), "tui.ts")),
  )
  expect(roots).not.toContain(path.join(cwd, ".opencode", "plugins"))
  expect(roots).not.toContain(outside)
})

test("uses an Hg root for a missing project plugin directory", async () => {
  await using tmp = await tmpdir()
  const project = path.join(tmp.path, "repo")
  const cwd = path.join(project, "package")
  await mkdir(path.join(project, ".hg"), { recursive: true })
  await mkdir(cwd, { recursive: true })

  expect(await localPluginDirectories(cwd, path.join(tmp.path, "config"))).toContain(
    path.join(project, ".opencode", "plugins"),
  )
})

test("truncates fractional mtimes in fresh specifiers", () => {
  // A dot in the query makes Bun's compiled binaries skip runtime plugin
  // hooks for the import, breaking JSX/solid rewriting for external plugins.
  const entrypoint = pathToFileURL(path.resolve("example.tsx")).href
  const specifier = freshSpecifier(entrypoint, 1786494961337.0317)
  expect(specifier.endsWith("example.tsx?mtime=1786494961337")).toBe(true)
})

test("propagates non-missing filesystem errors", async () => {
  await expect(localProjectDirectory("\0")).rejects.toBeInstanceOf(Error)
  await expect(discoverTuiPlugins(["\0"])).rejects.toBeInstanceOf(Error)
})
