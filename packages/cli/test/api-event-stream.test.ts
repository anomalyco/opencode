import { expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { OPENCODE_VERSION } from "../src/version"
import { isolatedEnv } from "./fixture/environment"

test("api writes server-sent events before the response closes", async () => {
  await using root = await tmpdir("opencode-api-events-")
  const frame = 'data: {"type":"server.connected"}\n\n'
  let finish: (() => void) | undefined
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const pathname = new URL(request.url).pathname
      if (pathname === "/api/info")
        return Response.json({
          version: OPENCODE_VERSION,
          pid: process.pid,
          urls: [],
          paths: { tmp: root.path },
        })
      if (pathname !== "/api/event") return new Response(null, { status: 404 })
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(frame))
            finish = () => controller.close()
          },
        }),
        { headers: { "content-type": "text/event-stream; charset=utf-8" } },
      )
    },
  })

  const child = Bun.spawn(
    [process.execPath, "run", "src/index.ts", "api", "--server", server.url.toString(), "get", "/api/event"],
    {
      cwd: path.resolve(import.meta.dir, ".."),
      env: isolatedEnv(root.path),
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(8_000),
    },
  )
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader()
  try {
    const first = await reader.read()
    expect(first.value).toBe(frame)
    expect(child.exitCode).toBeNull()
    expect(finish).toBeDefined()
    finish?.()
    expect((await reader.read()).done).toBe(true)
    expect(await child.exited).toBe(0)
  } finally {
    child.kill()
    await child.exited
    await server.stop(true)
  }
}, 12_000)
