import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { captureServer } from "./server-heap"

// Main-process code: run it with the runtime's own fetch and Response, as Electron's main process has, not happy-dom's.
beforeAll(() => GlobalRegistrator.unregister())

afterAll(() => GlobalRegistrator.register())

test("asks the server to write into the folder, and records where an older server wrote instead", async () => {
  const memory = { rss: 5, heapTotal: 4, heapUsed: 3, external: 2, arrayBuffers: 1 }
  const directory = path.join(os.tmpdir(), "opencode-heap-capture")
  const requests: string[] = []

  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url)
      requests.push(
        `${request.method} ${url.pathname} ${url.searchParams.get("directory")} ${request.headers.get("authorization")}`,
      )
      // The first answer is a current server's; the second is one that predates `directory` and used its log folder.
      const folder = requests.length === 1 ? (url.searchParams.get("directory") ?? "") : path.join(os.tmpdir(), "log")

      const snapshot = { path: path.join(folder, "heap-42-1.heapsnapshot"), pid: 42 }

      // An older server also leaves out its memory.
      return Response.json(requests.length === 1 ? { ...snapshot, memory } : snapshot)
    },
  })

  const endpoint = { id: "sidecar", url: server.url.href, headers: { authorization: "Basic secret" }, local: true }
  const current = await captureServer(endpoint, directory, AbortSignal.timeout(10_000))
  const old = await captureServer(endpoint, directory, AbortSignal.timeout(10_000))

  expect({ current, old, requests }).toEqual({
    current: { process: "server", pid: 42, file: "heap-42-1.heapsnapshot", memory },
    old: { process: "server", pid: 42, path: path.join(os.tmpdir(), "log", "heap-42-1.heapsnapshot") },
    requests: [
      `POST /api/debug/heap-dump ${directory} Basic secret`,
      `POST /api/debug/heap-dump ${directory} Basic secret`,
    ],
  })
})

test("records why the server has no snapshot", async () => {
  using server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(null, { status: 404 }) })
  const endpoint = { id: "sidecar", url: server.url.href, headers: {}, local: true }

  expect([
    await captureServer(undefined, os.tmpdir(), AbortSignal.timeout(10_000)),
    await captureServer(endpoint, os.tmpdir(), AbortSignal.timeout(10_000)),
  ]).toEqual([
    { process: "server", error: "The server is not running." },
    { process: "server", error: "The server does not support heap dumps. Update and restart it." },
  ])
})
