import { expect, test } from "bun:test"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

test("session archive and unarchive update the archive state", async () => {
  await using directory = await tmpdir()
  const updates: unknown[] = []
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info")
        return Response.json({ version: "test", pid: 0, urls: [], paths: { tmp: directory.path } })
      if (request.method === "PATCH" && url.pathname === "/api/session/ses_test") {
        updates.push(await request.json())
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 404 })
    },
  })

  for (const command of ["archive", "unarchive"]) {
    expect(await run(directory.path, server.url, [command, "ses_test"])).toMatchObject({ code: 0 })
  }
  expect(updates).toEqual([{ archived: true }, { archived: false }])
})

test("session list sends an archive filter only when requested", async () => {
  await using directory = await tmpdir()
  const queries: URLSearchParams[] = []
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/info")
        return Response.json({ version: "test", pid: 0, urls: [], paths: { tmp: directory.path } })
      if (url.pathname === "/api/location")
        return Response.json({
          directory: directory.path,
          project: { id: "project", directory: directory.path, canonical: directory.path },
        })
      if (url.pathname === "/api/session") {
        queries.push(url.searchParams)
        return Response.json({ data: [] })
      }
      return new Response(null, { status: 404 })
    },
  })

  for (const flags of [[], ["--archived"], ["--no-archived"]]) {
    expect(
      await run(directory.path, server.url, ["list", "--format", "json", "--max-count", "2", ...flags]),
    ).toMatchObject({
      code: 0,
      stdout: "[]",
    })
  }
  expect(queries.map((query) => query.get("archived"))).toEqual([null, "true", "false"])
  for (const query of queries) {
    expect(query.get("project")).toBe("project")
    expect(query.get("limit")).toBe("2")
  }
})

async function run(directory: string, url: URL, args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", "session", ...args, "--server", url.toString()], {
    cwd: path.join(import.meta.dir, ".."),
    env: isolatedEnv(directory, { PWD: directory }),
    signal: AbortSignal.timeout(9_000),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout: stdout.trim(), stderr, code }
}
