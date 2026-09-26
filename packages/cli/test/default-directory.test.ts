import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import { ServiceConfig } from "../src/services/service-config"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

test.each([false, true])(
  "remote directory does not require a local path (server first: %s)",
  async (first) => {
    await using root = await tmpdir()
    const directory = path.join(root.path, "remote only", "project")
    expect(await fs.stat(directory).catch(() => undefined)).toBeUndefined()
    const result = await launch({ root: root.path, directory, remote: true, first })
    expect(result.directory, result.stderr).toBe(directory)
    expect(result.stderr).not.toContain("ENOENT")
  },
  15_000,
)

test("remote relative directory is passed to the server unchanged", async () => {
  await using root = await tmpdir()
  const result = await launch({ root: root.path, directory: "remote-only/project", remote: true })
  expect(result.directory, result.stderr).toBe("remote-only/project")
}, 15_000)

test("local relative directory still changes the launch directory", async () => {
  await using root = await tmpdir()
  await fs.mkdir(path.join(root.path, "project"))
  const result = await launch({ root: root.path, directory: "project" })
  expect(result.directory).toBe(await fs.realpath(path.join(root.path, "project")))
}, 15_000)

test("omitting the directory preserves the launch directory", async () => {
  await using root = await tmpdir()
  const result = await launch({ root: root.path, remote: true })
  expect(result.directory).toBe(await fs.realpath(root.path))
  expect(result.calls).toContain("/api/location")
}, 15_000)

test("a missing local directory still fails before connecting", async () => {
  await using root = await tmpdir()
  const result = await launch({ root: root.path, directory: "missing-project" })
  expect(result.directory).toBeUndefined()
  expect(result.stderr).toContain("ENOENT")
}, 15_000)

test("an explicit remote directory error does not fall back to a different project", async () => {
  await using root = await tmpdir()
  const result = await launch({ root: root.path, directory: "/remote/project", remote: true })
  expect(result.calls).toContain("/api/fs/list")
  expect(result.calls).not.toContain("/api/location")
}, 15_000)

async function launch(input: { root: string; directory?: string; remote?: boolean; first?: boolean }) {
  const requested = Promise.withResolvers<string | null>()
  const calls: string[] = []
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      calls.push(url.pathname)
      if (url.pathname === "/api/health")
        return Response.json({ healthy: true, version: OPENCODE_VERSION, pid: process.pid })
      if (url.pathname === "/api/fs/list") requested.resolve(url.searchParams.get("location[directory]"))
      // Stop at the real location request, before starting an interactive renderer.
      return new Response("Fixture stops before rendering", { status: 500 })
    },
  })
  const registration = path.join(input.root, "state", "opencode", ServiceConfig.filename())
  await fs.mkdir(path.dirname(registration), { recursive: true })
  await Bun.write(
    registration,
    JSON.stringify({
      id: "directory-test",
      version: OPENCODE_VERSION,
      url: server.url.toString(),
      pid: process.pid,
    }),
  )
  const directory = input.directory === undefined ? [] : [input.directory]
  const remote = input.remote ? ["--server", server.url.toString()] : []
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "--conditions=browser",
      "--preload",
      Bun.resolveSync("@opentui/solid/preload", import.meta.dir),
      path.resolve(import.meta.dir, "../src/index.ts"),
      "--print-logs",
      ...(input.first ? [...remote, ...directory] : [...directory, ...remote]),
    ],
    {
      cwd: input.root,
      env: isolatedEnv(input.root, {
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        OPENCODE_PASSWORD: undefined,
        OPENCODE_SERVER_PASSWORD: undefined,
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      }),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
      timeout: 10_000,
    },
  )
  const stderr = new Response(child.stderr).text()
  try {
    const result = {
      directory: await Promise.race([requested.promise, child.exited.then(() => undefined)]),
      stderr: await stderr,
      calls,
    }
    await child.exited
    expect(child.signalCode, result.stderr).toBeNull()
    return result
  } finally {
    child.kill()
    await child.exited
  }
}
