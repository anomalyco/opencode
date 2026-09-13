import { expect, test } from "bun:test"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

test.each(["", "/proxy", "/proxy/"])(
  "api preserves server base path %j",
  async (prefix) => {
    const base = prefix.replace(/\/$/, "")
    const requests: string[] = []
    using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        requests.push(url.pathname + url.search)
        if (url.pathname === `${base}/api/health`)
          return Response.json({ healthy: true, version: OPENCODE_VERSION, pid: process.pid })
        if (url.pathname === `${base}/openapi.json`)
          return Response.json({ paths: { "/api/echo": { get: { operationId: "echo" } } } })
        if (url.pathname === `${base}/api/echo`) return Response.json({ value: url.searchParams.get("value") })
        return new Response("Not found", { status: 404 })
      },
    })

    for (const args of [
      ["GET", "/api/echo?value=raw"],
      ["echo", "--param", "value=named"],
    ]) {
      const child = Bun.spawn(
        [process.execPath, "run", "src/index.ts", "api", "--server", server.url.origin + prefix, ...args],
        {
          cwd: path.join(import.meta.dir, ".."),
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
      expect(JSON.parse(stdout)).toEqual({ value: args[0] === "GET" ? "raw" : "named" })
    }
    expect(requests).toEqual([
      `${base}/api/health`,
      `${base}/api/echo?value=raw`,
      `${base}/api/health`,
      `${base}/openapi.json`,
      `${base}/api/echo?value=named`,
    ])
  },
  15_000,
)
