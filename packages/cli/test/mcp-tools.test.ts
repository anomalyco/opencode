import { expect, test } from "bun:test"
import type { ServerConfig } from "@opencode/schema/mcp"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

test("mcp tools is discoverable in help and explains an empty configuration", async () => {
  await using root = await tmpdir()
  const help = await cli(root.path, ["--help"])
  expect(help.exitCode).toBe(0)
  expect(help.stdout).toContain("[<name>]")
  expect(help.stdout).toContain("--standalone")

  const empty = await cli(root.path)
  expect(empty.exitCode).toBe(0)
  expect(empty.stdout).toContain("No MCP servers configured")
  expect(empty.stdout).toContain("opencode mcp add")
}, 30_000)

test("mcp tools rejects an unknown server with a discovery hint", async () => {
  await using root = await tmpdir()
  const result = await cli(root.path, ["missing"])
  expect(result.exitCode).toBe(1)
  expect(result.stderr).toContain("MCP server not found: missing")
  expect(result.stderr).toContain("opencode mcp list")
}, 30_000)

test("mcp tools lists sorted original names across pages without executing tools", async () => {
  await using root = await tmpdir()
  const log = path.join(root.path, "requests.jsonl")
  const servers = {
    zulu: fixture("empty"),
    bravo: fixture("tools", log),
  }
  const overview = await cli(root.path, [], servers)
  expect(overview.exitCode).toBe(0)
  expect(overview.stdout.indexOf("bravo")).toBeLessThan(overview.stdout.indexOf("zulu"))
  expect(overview.stdout).toContain("4 tools")
  expect(overview.stdout).toContain("No tools available")
  expect(overview.stdout).not.toContain("Search documentation")
  expect(overview.stdout).not.toContain("Last tool")
  const names = ["zebra", "search_docs", "search.docs", "alpha"].toSorted((a, b) => a.localeCompare(b))
  names.forEach((name, index) => {
    expect(overview.stdout).toContain(name)
    if (index > 0) expect(overview.stdout.indexOf(names[index - 1])).toBeLessThan(overview.stdout.indexOf(name))
  })
  expect(overview.stdout).not.toContain("bravo_search_docs")

  const selected = await cli(root.path, ["bravo"], servers)
  expect(selected.exitCode).toBe(0)
  expect(selected.stdout).toContain("search.docs")
  expect(selected.stdout).toContain("search_docs")
  expect(selected.stdout).toContain("Search documentation by name.")
  expect(selected.stdout).toContain("Last tool")
  expect(selected.stdout).not.toContain("zulu")
  const requests = (await Bun.file(log).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  expect(
    requests.filter((request) => request.method === "tools/list").map((request) => request.params?.cursor),
  ).toEqual([undefined, "page-2", undefined, "page-2"])
  expect(requests.some((request) => request.method === "tools/call")).toBe(false)
}, 30_000)

test("mcp tools succeeds for a connected server with no tools", async () => {
  await using root = await tmpdir()
  const result = await cli(root.path, ["empty"], { empty: fixture("empty") })
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain("No tools available")
}, 30_000)

test("mcp tools skips disabled servers in overview but fails when explicitly selected", async () => {
  await using root = await tmpdir()
  const log = path.join(root.path, "disabled-requests.jsonl")
  const servers = { disabled: { ...fixture("tools", log), disabled: true } }
  const overview = await cli(root.path, [], servers)
  expect(overview.exitCode).toBe(0)
  expect(overview.stdout).toContain("disabled")
  expect(overview.stdout).not.toContain("search.docs")

  const selected = await cli(root.path, ["disabled"], servers)
  expect(selected.exitCode).toBe(1)
  expect(selected.stdout).toContain("disabled")
  expect(selected.stdout).not.toContain("No tools available")
  expect(await Bun.file(log).exists()).toBe(false)
}, 30_000)

test("mcp tools preserves successful results while failing for connection and authentication errors", async () => {
  await using root = await tmpdir()
  const unauthorized = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => new Response(null, { status: new URL(request.url).pathname === "/mcp" ? 401 : 404 }),
  })
  try {
    const result = await cli(root.path, [], {
      working: fixture("tools"),
      broken: { type: "local", command: [process.execPath, "-e", "process.exit(1)"] },
      protected: { type: "remote", url: new URL("/mcp", unauthorized.url).toString() },
    })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toContain("working")
    expect(result.stdout).toContain("search.docs")
    expect(result.stdout).toContain("broken")
    expect(result.stdout).toContain("failed")
    expect(result.stdout).toContain("protected")
    expect(result.stdout).toContain("needs authentication")
  } finally {
    await unauthorized.stop(true)
  }
}, 30_000)

function fixture(mode: "tools" | "empty", log?: string): ServerConfig {
  return {
    type: "local",
    command: [process.execPath, path.join(import.meta.dir, "fixture/mcp-tools.ts"), mode, ...(log ? [log] : [])],
  }
}

async function cli(root: string, args: string[] = [], servers: Record<string, ServerConfig> = {}) {
  // Bun resolves JSX options from the invoking project, including in the standalone child process.
  await Bun.write(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { jsxImportSource: "solid-js" } }),
  )
  const child = Bun.spawn(
    [process.execPath, "run", path.join(import.meta.dir, "../src/index.ts"), "mcp", "tools", "--standalone", ...args],
    {
      cwd: root,
      env: isolatedEnv(root, {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ mcp: { servers, timeout: { startup: 2_000, catalog: 2_000 } } }),
      }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20_000,
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}
