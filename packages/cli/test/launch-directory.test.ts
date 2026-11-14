import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

test.each(["missing-project", "missing/project", "not-a-directory"])(
  "reports an invalid launch directory on stderr: %s",
  async (directory) => {
    await using root = await tmpdir()
    await Bun.write(path.join(root.path, "not-a-directory"), "file")
    const result = await launch(root.path, [directory])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(`Cannot open directory "${directory}"`)
    expect(result.stderr).toContain("opencode --help")
    expect(result.stderr).not.toContain("at <anonymous>")
    expect(result.stderr).not.toContain("Starting background server")
  },
)

test("a valid launch directory reaches the server with the resolved local path", async () => {
  await using root = await tmpdir()
  await fs.mkdir(path.join(root.path, "project"))
  const directories: (string | null)[] = []
  await using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info")
        return Response.json({ healthy: true, version: OPENCODE_VERSION, pid: process.pid })
      if (url.pathname === "/api/fs/list") directories.push(url.searchParams.get("location[directory]"))
      return new Response("Fixture stops before rendering", { status: 500 })
    },
  })
  const result = await launch(root.path, ["project", "--server", server.url.toString()])

  expect(directories, result.stderr || result.stdout).toEqual([await fs.realpath(path.join(root.path, "project"))])
  expect(result.stderr).not.toContain("Cannot open directory")
})

async function launch(root: string, args: string[]) {
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "--conditions=browser",
      "--preload",
      Bun.resolveSync("@opentui/solid/preload", import.meta.dir),
      path.resolve(import.meta.dir, "../src/index.ts"),
      ...args,
    ],
    {
      cwd: root,
      env: isolatedEnv(root, {
        OPENCODE_DISABLE_AUTOUPDATE: "true",
        OPENCODE_PASSWORD: undefined,
        OPENCODE_SERVER_PASSWORD: undefined,
        OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(child.signalCode, stderr || stdout).toBeNull()
  return { stdout, stderr, exitCode }
}
