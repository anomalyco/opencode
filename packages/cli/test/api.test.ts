import { describe, expect, test } from "bun:test"
import { EOL } from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

describe("api command", () => {
  test("prints the first event before the response closes", async () => {
    await using directory = await tmpdir()
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    using server = apiServer(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(value) {
              controller = value
              value.enqueue(new TextEncoder().encode("data: first\n\n"))
            },
          }),
          { headers: { "content-type": "Text/Event-Stream; charset=utf-8" } },
        ),
    )
    const child = cli(directory.path, server.url)
    const reader = child.stdout.getReader()
    const stderr = new Response(child.stderr).text()
    try {
      const decoder = new TextDecoder()
      let output = ""
      while (!output.endsWith("\n\n")) {
        const chunk = await reader.read()
        if (chunk.done) break
        output += decoder.decode(chunk.value, { stream: true })
      }
      expect(output).toBe("data: first\n\n")
      expect(child.exitCode).toBeNull()
    } finally {
      controller?.close()
      if (child.exitCode === null) child.kill()
      await child.exited
      await stderr
    }
  })

  test("preserves the final SSE newline and HTTP exit status", async () => {
    await using directory = await tmpdir()
    using server = apiServer(
      () => new Response("data: unavailable", { status: 503, headers: { "content-type": "text/event-stream" } }),
    )
    const child = cli(directory.path, server.url)
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: `data: unavailable${EOL}`,
      stderr: `HTTP 503 Service Unavailable${EOL}`,
      exitCode: 1,
    })
  })
})

function apiServer(fetch: () => Response) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === "/api/info") {
        return Response.json({ version: OPENCODE_VERSION, pid: process.pid, urls: [], paths: { tmp: "/tmp/opencode" } })
      }
      return fetch()
    },
  })
}

function cli(root: string, server: URL) {
  return Bun.spawn(
    [process.execPath, "run", "src/index.ts", "api", "get", "/api/event", "--server", server.toString()],
    {
      cwd: path.join(import.meta.dir, ".."),
      env: isolatedEnv(root, { OPENCODE_PASSWORD: undefined, OPENCODE_SERVER_PASSWORD: undefined }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  )
}
