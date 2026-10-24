import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { parse } from "jsonc-parser"
import { Npm } from "@opencode/util/npm"
import { writePluginConfig } from "../src/commands/handlers/plugin/add"
import { resolveConfigPath } from "../src/commands/handlers/mcp/add"
import { tmpdir } from "./fixture/tmpdir"
import { isolatedEnv } from "./fixture/environment"

const spec = "opencode-test-plugin@1.0.0"

test.each(["--local", "--global", "default"])("CLI add %s writes only its selected scope", async (scope) => {
  await using directory = await tmpdir()
  // The local case also checks that a package with both entrypoints uses server configuration.
  await installed(directory.path, scope === "--local" ? { "./server": "./server.js", "./tui": "./tui.js" } : undefined)
  const file = path.join(directory.path, scope === "--local" ? "opencode.json" : "config/opencode.json")
  const other = path.join(directory.path, scope === "--local" ? "config/opencode.json" : "opencode.json")
  const untouched = '{"plugins":["existing-plugin"]}'
  await Bun.write(other, untouched)

  const result = await cli(directory.path, [spec, ...(scope === "default" ? [] : [scope])])
  expect({ code: result.exitCode, stderr: result.stderr }).toEqual({ code: 0, stderr: "" })
  expect(await Bun.file(file).json()).toEqual({ $schema: "https://opencode.ai/config.json", plugins: [spec] })
  expect(await Bun.file(other).text()).toBe(untouched)
  expect(await Bun.file(path.join(directory.path, "config/cli.json")).exists()).toBe(false)
})

test.each(["opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc"])(
  "adding to existing %s preserves comments and settings",
  async (name) => {
    await using directory = await tmpdir()
    const file = path.join(directory.path, name)
    await Bun.write(file, '{\n // Keep this comment\n "model":"test/model", "plugins":["existing"],\n}\n')
    expect(await resolveConfigPath(directory.path)).toBe(file)
    expect(await writePluginConfig(file, spec)).toBe(true)
    const text = await Bun.file(file).text()
    expect(text).toContain("// Keep this comment")
    expect(parse(text)).toEqual({ model: "test/model", plugins: ["existing", spec] })
  },
)

test("adding preserves the existing schema and plugin options without duplicating string or object entries", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "opencode.json")
  const existing = {
    $schema: "https://example.com/custom-schema.json",
    plugins: [{ package: spec, options: { a: true } }],
  }
  await Bun.write(file, JSON.stringify(existing))
  expect(await writePluginConfig(file, "other-plugin")).toBe(true)
  expect(await Bun.file(file).json()).toEqual({ ...existing, plugins: [...existing.plugins, "other-plugin"] })
  const text = await Bun.file(file).text()
  expect(await writePluginConfig(file, spec)).toBe(false)
  expect(await writePluginConfig(file, "other-plugin")).toBe(false)
  expect(await Bun.file(file).text()).toBe(text)
})

test("TUI-only plugins reject project scope and install into global CLI configuration", async () => {
  await using directory = await tmpdir()
  await installed(directory.path, { "./tui": "./tui.js" })
  const local = await cli(directory.path, [spec, "--local"])
  expect(local.exitCode).toBe(1)
  expect(local.stdout + local.stderr).toContain("TUI-only plugins require global CLI configuration")
  expect(await Bun.file(path.join(directory.path, "config/cli.json")).exists()).toBe(false)

  const global = await cli(directory.path, [spec, "--global"])
  expect({ code: global.exitCode, stderr: global.stderr }).toEqual({ code: 0, stderr: "" })
  expect(await Bun.file(path.join(directory.path, "config/cli.json")).json()).toMatchObject({ plugins: [spec] })
  expect(await Bun.file(path.join(directory.path, "opencode.json")).exists()).toBe(false)
  expect(await Bun.file(path.join(directory.path, "config/opencode.json")).exists()).toBe(false)
})

test("conflicting scopes fail before installation or config writes", async () => {
  await using directory = await tmpdir()
  const result = await cli(directory.path, [spec, "--local", "--global"])
  expect(result.exitCode).toBe(1)
  expect(result.stdout + result.stderr).toContain("Provide either --local or --global, not both")
  expect(await Bun.file(path.join(directory.path, "opencode.json")).exists()).toBe(false)
  expect(existsSync(path.join(directory.path, "cache/opencode/npm"))).toBe(false)
})

async function installed(root: string, exports: Record<string, string> = { "./server": "./server.js" }) {
  const directory = path.join(
    root,
    "cache/opencode/npm",
    await Npm.cacheKey(spec),
    "1/node_modules/opencode-test-plugin",
  )
  await Bun.write(
    path.join(directory, "package.json"),
    JSON.stringify({ name: "opencode-test-plugin", version: "1.0.0", type: "module", exports }),
  )
  await Promise.all(Object.values(exports).map((file) => Bun.write(path.join(directory, file), "export default {}\n")))
}

async function cli(root: string, args: string[]) {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "--preload",
      import.meta.resolve("@opentui/solid/preload"),
      path.join(import.meta.dir, "../src/index.ts"),
      "plugin",
      "add",
      ...args,
    ],
    { cwd: root, env: isolatedEnv(root), stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
