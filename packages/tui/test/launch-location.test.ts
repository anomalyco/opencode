import { expect, test } from "bun:test"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import path from "node:path"
import { tmpdir } from "./fixture/fixture"
import { createFetch, json } from "./fixture/tui-client"

test.each([500, 401, 404])("startup does not replace the launch location after an HTTP %s failure", async (status) => {
  const result = await probe(() => new Response("Location initialization failed", { status }))
  expect(result.fallbacks).toBe(0)
  expect(result.handoffs).toBe(0)
  expect(String(result.error)).toContain(process.cwd())
  if (status === 500) expect(String(result.error)).toContain("Location initialization failed")
  expect(String(result.error)).not.toContain("terminal handoff reached")
})

test("startup reports the HTTP status when the server returns no failure details", async () => {
  const result = await probe(() => new Response(null, { status: 503 }))
  expect(result.fallbacks).toBe(0)
  expect(result.handoffs).toBe(0)
  expect(String(result.error)).toContain(process.cwd())
  expect(String(result.error)).toContain("HTTP 503")
})

test("startup reports the server's initialization failure with the launch directory", async () => {
  const message = "EEXIST: file already exists, mkdir '/project/.opencode/shell'"
  const result = await probe(() => json({ message }, { status: 500 }))
  expect(result.fallbacks).toBe(0)
  expect(result.handoffs).toBe(0)
  expect(String(result.error)).toContain(process.cwd())
  expect(String(result.error)).toContain(message)
})

test("startup retains the remote default fallback for a missing launch directory", async () => {
  const result = await probe(() =>
    json(
      {
        _tag: "LocationNotFoundError",
        location: { directory: process.cwd() },
        message: "Directory not found on the server",
      },
      { status: 404 },
    ),
  )
  expect(result.fallbacks).toBe(1)
  expect(result.handoffs).toBe(1)
  expect(String(result.error)).toContain("terminal handoff reached")
})

test("startup uses a resolved launch location without requesting the server default", async () => {
  const result = await probe(() => undefined)
  expect(result.fallbacks).toBe(0)
  expect(result.handoffs).toBe(1)
  expect(String(result.error)).toContain("terminal handoff reached")
})

async function probe(response: () => Response | undefined) {
  const { run } = await import("../src/app")
  await using root = await tmpdir()
  let fallbacks = 0
  let handoffs = 0
  const calls = createFetch((url) => {
    if (url.pathname === "/api/fs/list") return response()
    if (url.pathname === "/api/location") fallbacks++
    return undefined
  })
  const server = Bun.serve({ port: 0, fetch: (request) => calls.fetch(request) })
  try {
    const error = await Effect.runPromise(
      run({
        app: { name: "test", version: "test", channel: "test" },
        server: { endpoint: { url: server.url.toString() } },
        config: { get: async () => ({}), update: async () => ({}) },
        packages: { prepare: async () => ({ directory: "" }) },
        args: {},
        terminalHandoff: async () => {
          handoffs++
          // Stop after location resolution, before creating an interactive renderer.
          throw new Error("terminal handoff reached")
        },
      }).pipe(
        Effect.provide(
          Global.layerWith({
            home: path.join(root.path, "home"),
            data: path.join(root.path, "data"),
            cache: path.join(root.path, "cache"),
            config: path.join(root.path, "config"),
            state: path.join(root.path, "state"),
            bin: path.join(root.path, "bin"),
            log: path.join(root.path, "log"),
            repos: path.join(root.path, "repos"),
            tmp: path.join(root.path, "tmp"),
          }),
        ),
        Effect.provide(FileSystem.layerNoop({})),
      ),
    ).catch((error: unknown) => error)
    return { error, fallbacks, handoffs }
  } finally {
    server.stop(true)
  }
}
