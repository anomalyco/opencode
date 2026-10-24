import { expect, test } from "bun:test"
import { realpath } from "node:fs/promises"
import path from "node:path"
import { parse } from "jsonc-parser"
import { configuredPlugins } from "../src/commands/handlers/plugin/config"
import { removePluginConfig } from "../src/commands/handlers/plugin/remove"
import { tmpdir } from "./fixture/tmpdir"
import { isolatedEnv } from "./fixture/environment"

test("inventory keeps separate config sources in project, inherited, then global order", async () => {
  await using directory = await tmpdir()
  const global = path.join(directory.path, "global")
  const project = path.join(global, "project")
  await Bun.write(
    path.join(project, "opencode.json"),
    JSON.stringify({ plugins: ["shared-plugin", "shared-plugin", "*", "-disabled", "opencode.provider.openai"] }),
  )
  await Bun.write(path.join(project, ".opencode/opencode.jsonc"), '{"plugins":[{"package":"a-project","options":{}}]}')
  await Bun.write(path.join(directory.path, "opencode.jsonc"), '{"plugins":["a-inherited"]}')
  await Bun.write(path.join(global, "opencode.json"), '{"plugins":["shared-plugin"]}')
  await Bun.write(path.join(global, "opencode.jsonc"), '{"plugins":["jsonc-plugin"]}')
  await Bun.write(path.join(global, "cli.json"), '{"plugins":["tui-plugin"]}')

  const inventory = await configuredPlugins({ directory: project, global, cli: path.join(global, "cli.json") })
  expect(inventory.entries).toMatchObject([
    { target: "a-project", scope: "project", inherited: false, path: path.join(project, ".opencode/opencode.jsonc") },
    { target: "shared-plugin", scope: "project", inherited: false, path: path.join(project, "opencode.json") },
    { target: "a-inherited", scope: "project", inherited: true, path: path.join(directory.path, "opencode.jsonc") },
    { target: "jsonc-plugin", scope: "global", path: path.join(global, "opencode.jsonc") },
    { target: "shared-plugin", scope: "global", path: path.join(global, "opencode.json") },
    { target: "tui-plugin", scope: "global", runtime: "tui", path: path.join(global, "cli.json") },
  ])
})

test("removal filters exact string and object targets while preserving other settings and options", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.jsonc")
  await Bun.write(
    file,
    '{\n // keep\n "model":"test/model", "plugins":["remove-me",{"package":"remove-me","options":{}},{"package":"keep-me","options":{"a":true}}],\n}\n',
  )
  expect(await removePluginConfig(file, "remove-me")).toBe(true)
  const text = await Bun.file(file).text()
  expect(text).toContain("// keep")
  expect(parse(text)).toEqual({ model: "test/model", plugins: [{ package: "keep-me", options: { a: true } }] })
  expect(await removePluginConfig(file, "remove-me")).toBe(false)
  expect(await Bun.file(file).text()).toBe(text)
})

test.each(["{ bad", '{"plugins":{}}'])("invalid selected config %s is never overwritten", async (text) => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.json")
  await Bun.write(file, text)
  await expect(removePluginConfig(file, "plugin")).rejects.toThrow("Invalid plugin configuration")
  expect(await Bun.file(file).text()).toBe(text)
})

test("scope flags remove only the selected source, including global TUI entries", async () => {
  await using directory = await tmpdir()
  const project = path.join(directory.path, "opencode.json")
  const global = path.join(directory.path, "config/cli.json")
  await Bun.write(project, '{"plugins":["shared-plugin"]}')
  await Bun.write(global, '{"plugins":["shared-plugin"],"theme":{"mode":"dark"}}')
  const local = await cli(directory.path, ["shared-plugin", "--local"])
  expect({ code: local.exitCode, stderr: local.stderr }).toEqual({ code: 0, stderr: "" })
  expect(await Bun.file(project).json()).toEqual({ plugins: [] })
  expect(await Bun.file(global).json()).toEqual({ plugins: ["shared-plugin"], theme: { mode: "dark" } })

  await Bun.write(project, "{ bad")
  const removed = await cli(directory.path, ["shared-plugin", "--global", "--yes"])
  expect({ code: removed.exitCode, stderr: removed.stderr }).toEqual({ code: 0, stderr: "" })
  expect(removed.stdout).not.toContain("Skipping config:")
  expect(await Bun.file(global).json()).toEqual({ plugins: [], theme: { mode: "dark" } })
  expect(await Bun.file(project).text()).toBe("{ bad")
})

test("an ambiguous target fails without a terminal and leaves every copy untouched", async () => {
  await using directory = await tmpdir()
  const project = path.join(directory.path, "opencode.json")
  const global = path.join(directory.path, "config/opencode.json")
  const text = '{"plugins":["shared-plugin"]}'
  await Promise.all([Bun.write(project, text), Bun.write(global, text)])
  const result = await cli(directory.path, ["shared-plugin", "--yes"])
  expect(result.exitCode).toBe(1)
  expect(result.stdout + result.stderr).toContain("ambiguous")
  expect(await Bun.file(project).text()).toBe(text)
  expect(await Bun.file(global).text()).toBe(text)
})

test("a unique target is removed without a scope flag", async () => {
  await using directory = await tmpdir()
  const project = path.join(directory.path, "opencode.json")
  const global = path.join(directory.path, "config/opencode.json")
  await Bun.write(project, '{"plugins":["project-plugin"]}')
  await Bun.write(global, '{"plugins":["other-plugin"]}')
  const result = await cli(directory.path, ["project-plugin"])
  expect({ code: result.exitCode, stderr: result.stderr }).toEqual({ code: 0, stderr: "" })
  expect(result.stdout).toContain(`removed from ${await realpath(project)}`)
  expect(await Bun.file(project).json()).toEqual({ plugins: [] })
  expect(await Bun.file(global).json()).toEqual({ plugins: ["other-plugin"] })
})

test("a malformed parent warns but does not block removal from a valid project file", async () => {
  await using directory = await tmpdir()
  const project = path.join(directory.path, "project")
  const malformed = path.join(directory.path, "opencode.json")
  await Bun.write(malformed, "{ bad")
  await Bun.write(path.join(project, "opencode.jsonc"), '{"plugins":["foo-plugin"]}')
  const result = await cli(directory.path, ["foo-plugin", "--local"], project)
  expect({ code: result.exitCode, stderr: result.stderr }).toEqual({ code: 0, stderr: "" })
  expect(result.stdout).toContain("Skipping config: Invalid plugin configuration:")
  expect(result.stdout).toContain("removed from")
  expect(await Bun.file(path.join(project, "opencode.jsonc")).json()).toEqual({ plugins: [] })
  expect(await Bun.file(malformed).text()).toBe("{ bad")
})

test("removal without a target refuses to prompt outside a terminal", async () => {
  await using directory = await tmpdir()
  const result = await cli(directory.path, [])
  expect(result.exitCode).toBe(1)
  expect(result.stdout + result.stderr).toContain("Pass a plugin target")
})

async function cli(root: string, args: string[], cwd = root) {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "--preload",
      import.meta.resolve("@opentui/solid/preload"),
      path.join(import.meta.dir, "../src/index.ts"),
      "plugin",
      "remove",
      ...args,
    ],
    { cwd, env: isolatedEnv(root), stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
