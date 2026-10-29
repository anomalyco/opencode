import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import { isolatedEnv } from "./fixture/environment"

test.each(["", "/proxy", "/proxy/"])(
  "api keeps a path prefix on the server URL %j",
  async (prefix) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-api-prefix-"))
    const base = prefix.replace(/\/$/, "")
    const paths: string[] = []
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url)
        paths.push(url.pathname + url.search)
        if (url.pathname === `${base}/api/info`)
          return Response.json({
            version: OPENCODE_VERSION,
            pid: process.pid,
            urls: [],
            paths: { tmp: "/tmp/opencode" },
          })
        if (url.pathname === `${base}/openapi.json`)
          return Response.json({ paths: { "/api/echo": { get: { operationId: "echo" } } } })
        if (url.pathname === `${base}/api/echo`) return Response.json({ value: url.searchParams.get("value") })
        return new Response("Not found", { status: 404 })
      },
    })

    try {
      // The raw form sends the path as given; the operation form resolves it through the
      // OpenAPI document first. Both have to keep the prefix.
      for (const args of [
        ["GET", "/api/echo?value=raw"],
        ["echo", "--param", "value=named"],
      ]) {
        const child = Bun.spawn(
          [process.execPath, "run", "src/index.ts", "api", "--server", server.url.origin + prefix, ...args],
          {
            cwd: path.join(import.meta.dir, ".."),
            env: isolatedEnv(root, { OPENCODE_SERVER_PASSWORD: undefined, OPENCODE_PASSWORD: undefined }),
            stdout: "pipe",
            stderr: "pipe",
          },
        )
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])

        expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" })
        expect(JSON.parse(stdout)).toEqual({ value: args[0] === "GET" ? "raw" : "named" })
      }

      expect(paths).toEqual([
        `${base}/api/info`,
        `${base}/api/echo?value=raw`,
        `${base}/api/info`,
        `${base}/openapi.json`,
        `${base}/api/echo?value=named`,
      ])
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  },
  30_000,
)
