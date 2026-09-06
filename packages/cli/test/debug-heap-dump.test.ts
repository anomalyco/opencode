import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { debugHandler } from "../../server/test/fixture/debug"
import { tmpdir } from "./fixture/tmpdir"

test("heap-dump is included in debug help", async () => {
  await using directory = await tmpdir()
  const result = await cli(["debug", "--help"], directory.path)
  expect(result.code).toBe(0)
  expect(result.stdout).toContain("heap-dump")
}, 60_000)

test("heap-dump does not start a missing background server", async () => {
  await using directory = await tmpdir()
  const result = await cli(["debug", "heap-dump"], directory.path)
  expect(result.code).toBe(1)
  expect(result.stderr).toContain("Could not connect to a running OpenCode background server")
  expect(await Bun.file(registration(directory.path)).exists()).toBe(false)
}, 60_000)

test("heap-dump prints the snapshot from the existing server without replacing it", async () => {
  await using directory = await tmpdir()
  const log = path.join(directory.path, "snapshots")
  await mkdir(log)
  const transport = debugHandler(log)
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => transport.handler(request) })
  try {
    const info = { url: server.url.href, pid: process.pid, version: "heap-test", password: "secret" }
    await Bun.write(registration(directory.path), JSON.stringify(info))

    const result = await cli(["debug", "heap-dump"], directory.path)
    expect(result.code).toBe(0)
    expect(result.stderr).toBe("")
    const file = result.stdout.trim()
    expect(path.dirname(file)).toBe(log)
    expect(path.basename(file)).toStartWith(`heap-${process.pid}-`)
    expect((await Bun.file(file).json()).snapshot.node_count).toBeGreaterThan(0)
    expect(await Bun.file(registration(directory.path)).json()).toEqual(info)
  } finally {
    await server.stop(true)
    await transport.dispose()
  }
}, 60_000)

test("heap-dump reports unsupported older servers without replacing them", async () => {
  await using directory = await tmpdir()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === "/api/health"
        ? Response.json({ healthy: true, pid: process.pid, version: "old-server" })
        : new Response("Not Found", { status: 404 }),
  })
  try {
    const info = { url: server.url.href, pid: process.pid, version: "old-server" }
    await Bun.write(registration(directory.path), JSON.stringify(info))
    const result = await cli(["debug", "heap-dump"], directory.path)
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("The running server does not support heap-dump")
    expect(await Bun.file(registration(directory.path)).json()).toEqual(info)
  } finally {
    await server.stop(true)
  }
}, 60_000)

function registration(root: string) {
  return path.join(root, "state", "opencode", "service-local.json")
}

async function cli(args: string[], root: string) {
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      OPENCODE_TEST_HOME: root,
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, code }
  } finally {
    if (child.exitCode === null) child.kill()
    await child.exited
  }
}
