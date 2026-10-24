import { expect, test } from "bun:test"
import path from "node:path"
import { mkdir, realpath } from "node:fs/promises"
import { parse, type ParseError } from "jsonc-parser"
import { configuredServers, removeServer } from "../src/commands/handlers/mcp/remove"
import { tmpdir } from "./fixture/tmpdir"
import { isolatedEnv } from "./fixture/environment"

test("removes only the selected local non-OAuth server, preserving JSONC and unrelated settings", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "opencode.jsonc")
  await Bun.write(
    file,
    `{
  // Keep my settings
  "model": "test/model",
  "mcp": {
    "timeout": { "startup": 40000 },
    "servers": {
      "paper": { "type": "local", "command": ["/paper/mcp.sh"] },
      // Keep this server
      "other": { "type": "remote", "url": "https://example.com/mcp" },
    },
  },
}`,
  )
  expect(await removeServer(file, ["mcp", "servers", "paper"])).toBe(true)
  const text = await Bun.file(file).text()
  expect(text).toContain("// Keep my settings")
  expect(text).toContain("// Keep this server")
  expect(parse(text)).toEqual({
    model: "test/model",
    mcp: { timeout: { startup: 40000 }, servers: { other: { type: "remote", url: "https://example.com/mcp" } } },
  })
  expect(await removeServer(file, ["mcp", "servers", "paper"])).toBe(false)
})

test("enumerates native and legacy entries by source, including reserved legacy server names", async () => {
  await using tmp = await tmpdir()
  const root = await realpath(tmp.path)
  const global = path.join(root, "global")
  const project = path.join(root, "project")
  const directory = path.join(project, "nested")
  await mkdir(directory, { recursive: true })
  const files = [
    [path.join(global, "opencode.json"), { mcp: { paper: { type: "local", command: ["paper"] } } }],
    [
      path.join(project, "opencode.jsonc"),
      {
        mcp: {
          servers: { type: "local", command: ["legacy-servers"] },
          timeout: { type: "local", command: ["legacy-timeout"] },
        },
      },
    ],
    [
      path.join(directory, ".opencode", "opencode.jsonc"),
      { mcp: { servers: { paper: { type: "local", command: ["project-paper"] } } } },
    ],
  ] as const
  await Promise.all(files.map(([file, config]) => Bun.write(file, JSON.stringify(config))))
  const inventory = await configuredServers(directory, global)
  expect(inventory.warnings).toEqual([])
  expect(inventory.entries.map((entry) => [entry.name, entry.scope, entry.file])).toEqual([
    ["paper", "Global", files[0][0]],
    ["paper", "Project", files[2][0]],
    ["servers", "Inherited", files[1][0]],
    ["timeout", "Inherited", files[1][0]],
  ])
  expect((await configuredServers(directory, global, "global")).entries.map((entry) => entry.file)).toEqual([
    files[0][0],
  ])
  expect((await configuredServers(directory, global, "local")).entries).toHaveLength(3)
  const inherited = inventory.entries.find((entry) => entry.name === "servers")
  if (!inherited) throw new Error("Missing inherited legacy server")
  await removeServer(inherited.file, inherited.keys)
  expect(await Bun.file(files[0][0]).json()).toEqual(files[0][1])
  expect(await Bun.file(files[2][0]).json()).toEqual(files[2][1])
  expect(await Bun.file(files[1][0]).json()).toEqual({
    mcp: { timeout: { type: "local", command: ["legacy-timeout"] } },
  })
})

test.each([
  '{ "paper": {}, /* keep */ "other": {} }',
  '{ "other": {}, /* keep */ "paper": {} }',
  '{ "other": {}, /* keep */ "paper": {}, }',
  '{ /* keep */ "paper": {}, }',
])("preserves comments and valid separators when removing from %s", async (servers) => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "opencode.jsonc")
  await Bun.write(file, `{ "mcp": { "servers": ${servers} } }`)
  await removeServer(file, ["mcp", "servers", "paper"])
  const text = await Bun.file(file).text()
  expect(text).toContain("/* keep */")
  const errors: ParseError[] = []
  expect(parse(text, errors, { allowTrailingComma: true }).mcp.servers).toEqual(
    servers.includes('"other"') ? { other: {} } : {},
  )
  expect(errors).toEqual([])
})

test("warns and skips malformed files during discovery, but refuses a malformed selected file", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "global")
  const file = path.join(tmp.path, "opencode.json")
  await Bun.write(file, '{ "mcp": { "servers": { "paper": {} } } }')
  await Bun.write(path.join(tmp.path, "opencode.jsonc"), '{ "mcp": [] }')
  const inventory = await configuredServers(tmp.path, global)
  expect(inventory.entries).toHaveLength(1)
  expect(inventory.warnings).toHaveLength(1)
  expect(inventory.warnings[0]).toContain("Invalid MCP configuration")
  const broken = '{ "mcp": { "servers": { "paper": {} } }'
  await Bun.write(file, broken)
  await expect(removeServer(file, inventory.entries[0].keys)).rejects.toThrow("Invalid JSON configuration")
  expect(await Bun.file(file).text()).toBe(broken)
})

test("CLI rejects unknown or ambiguous names without edits and removes one scoped legacy entry", async () => {
  await using tmp = await tmpdir()
  const global = path.join(tmp.path, "config")
  const directory = path.join(tmp.path, "project")
  const config = { mcp: { paper: { type: "local", command: ["/paper/mcp.sh"] } } }
  const projectFile = path.join(directory, "opencode.json")
  const globalFile = path.join(global, "opencode.json")
  await Bun.write(projectFile, JSON.stringify(config))
  await Bun.write(globalFile, JSON.stringify(config))
  const cli = async (args: string[], name = "paper") => {
    const child = Bun.spawn(
      [
        process.execPath,
        "run",
        "--preload",
        Bun.resolveSync("@opentui/solid/preload", import.meta.dir),
        path.join(import.meta.dir, "../src/index.ts"),
        "mcp",
        "remove",
        name,
        "--yes",
        ...args,
      ],
      { cwd: directory, env: isolatedEnv(tmp.path), stdout: "pipe", stderr: "pipe" },
    )
    return {
      stdout: await new Response(child.stdout).text(),
      stderr: await new Response(child.stderr).text(),
      code: await child.exited,
    }
  }
  const ambiguous = await cli([])
  expect(ambiguous.stderr).toBe("")
  expect(ambiguous.stdout).toContain("ambiguous")
  expect(ambiguous.code).toBe(1)
  expect(await Bun.file(projectFile).json()).toEqual(config)
  expect(await Bun.file(globalFile).json()).toEqual(config)
  const unknown = await cli(["--global"], "missing")
  expect(unknown.stderr).toBe("")
  expect(unknown.stdout).toContain('MCP server "missing" is not configured in the selected scope')
  expect(unknown.code).toBe(1)
  expect(await Bun.file(globalFile).json()).toEqual(config)
  const removed = await cli(["--global"])
  expect(removed.stdout).toContain(`removed from ${await realpath(globalFile)}`)
  expect(removed.stderr).toBe("")
  expect(removed.code).toBe(0)
  expect(await Bun.file(globalFile).json()).toEqual({ mcp: {} })
  expect(await Bun.file(projectFile).json()).toEqual(config)
})
