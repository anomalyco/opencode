import { expect, test } from "bun:test"
import path from "node:path"
import { isolatedEnv } from "../fixture/environment"
import { tmpdir } from "../fixture/tmpdir"

test("run --archived archives the new session before subscribing to its prompt", async () => {
  await using directory = await tmpdir()
  const requests: { method: string; path: string; body?: unknown }[] = []
  const location = {
    directory: directory.path,
    project: { id: "project", directory: directory.path, canonical: directory.path },
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const text = await request.text()
      requests.push({ method: request.method, path: url.pathname, body: text ? JSON.parse(text) : undefined })
      if (url.pathname === "/api/info")
        return Response.json({ version: "test", pid: 0, urls: [], paths: { tmp: directory.path } })
      if (request.method === "GET" && url.pathname === "/api/location") return Response.json(location)
      if (request.method === "POST" && url.pathname === "/api/session")
        return Response.json({
          data: {
            id: "ses_archived",
            projectID: "project",
            location: { directory: directory.path },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
          },
        })
      if (request.method === "PATCH" && url.pathname === "/api/session/ses_archived")
        return new Response(null, { status: 204 })
      // Fail the event stream so the run stops before admitting its prompt.
      return new Response(null, { status: 503 })
    },
  })
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "src/index.ts",
      "run",
      "--server",
      server.url.toString(),
      "--archived",
      "--format",
      "json",
      "review this diff",
    ],
    {
      cwd: path.join(import.meta.dir, "../.."),
      env: isolatedEnv(directory.path, { PWD: directory.path }),
      signal: AbortSignal.timeout(25_000),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    const update = requests.findIndex((item) => item.method === "PATCH")
    const subscribe = requests.findIndex((item) => item.path === "/api/event")
    expect({ update: requests[update], stdout, stderr }).toMatchObject({
      update: { path: "/api/session/ses_archived", body: { archived: true } },
    })
    expect(subscribe).toBeGreaterThan(update)
    expect(requests.some((item) => item.path.endsWith("/prompt"))).toBe(false)
  } finally {
    child.kill()
    await child.exited
    await server.stop(true)
  }
}, 30_000)
