import { describe, expect, test } from "bun:test"
import { EOL } from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

describe("api command", () => {
  test.each(["text/event-stream", "Text/Event-Stream; charset=utf-8"])(
    "prints %s events before the response closes",
    async (contentType) => {
      await using directory = await tmpdir()
      const received = Promise.withResolvers<void>()
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined
      using server = apiServer(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(value) {
                controller = value
                value.enqueue(new TextEncoder().encode("data: first\n\n"))
                received.resolve()
              },
            }),
            { headers: { "content-type": contentType } },
          ),
      )
      const child = cli(directory.path, server.url)
      const reader = child.stdout.getReader()
      const stderr = new Response(child.stderr).text()
      try {
        await received.promise
        const first = await Promise.race([readOutput(reader, "\n\n"), Bun.sleep(2000).then(() => undefined)])
        expect(first).toBe("data: first\n\n")
        expect(child.exitCode).toBeNull()
        controller?.close()
        controller = undefined
        expect(first + (await readOutput(reader))).toBe(`data: first\n\n${EOL === "\n" ? "" : EOL}`)
        expect(await stderr).toBe("")
        expect(await child.exited).toBe(0)
      } finally {
        controller?.close()
        if (child.exitCode === null) child.kill()
        await child.exited
      }
    },
  )

  test.each([
    {
      name: "SSE without an ending newline",
      contentType: "text/event-stream",
      parts: ["data: finite"],
      output: `data: finite${EOL}`,
    },
    {
      name: "SSE ending in the platform newline",
      contentType: "text/event-stream",
      parts: [`data: finite${EOL}`],
      output: `data: finite${EOL}`,
    },
    { name: "empty SSE", contentType: "text/event-stream", parts: [], output: "" },
    {
      name: "SSE ending in CRLF",
      contentType: "text/event-stream",
      parts: ["data: finite\r\n"],
      output: "data: finite\r\n",
    },
    { name: "ordinary text", contentType: "text/plain", parts: ["ordinary"], output: `ordinary${EOL}` },
    { name: "ordinary JSON", contentType: "application/json", parts: ['{"ok":true}'], output: `{"ok":true}${EOL}` },
    {
      name: "ordinary text ending in the platform newline",
      contentType: "text/plain",
      parts: [`ordinary${EOL}`],
      output: `ordinary${EOL}`,
    },
  ])("preserves finite $name output", async ({ contentType, parts, output }) => {
    await using directory = await tmpdir()
    using server = apiServer(() => new Response(parts.join(""), { headers: { "content-type": contentType } }))
    const child = cli(directory.path, server.url)
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: output, stderr: "", exitCode: 0 })
  })

  test("decodes split SSE UTF-8 and BOM bytes and preserves the final CRLF", async () => {
    await using directory = await tmpdir()
    const text = "data: café 🌍\r\n\r\n"
    const bytes = new TextEncoder().encode(`\uFEFF${text}`)
    using server = apiServer(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async start(controller) {
              for (const byte of bytes) {
                controller.enqueue(Uint8Array.of(byte))
                await Bun.sleep(5)
              }
              controller.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    )
    const child = cli(directory.path, server.url)
    expect(await new Response(child.stdout).text()).toBe(text)
    expect(await new Response(child.stderr).text()).toBe("")
    expect(await child.exited).toBe(0)
  })

  test("preserves the SSE error body and HTTP exit status", async () => {
    await using directory = await tmpdir()
    using server = apiServer(
      () => new Response("data: unavailable", { status: 503, headers: { "content-type": "text/event-stream" } }),
    )
    const child = cli(directory.path, server.url)
    expect(await new Response(child.stdout).text()).toBe(`data: unavailable${EOL}`)
    expect(await new Response(child.stderr).text()).toBe(`HTTP 503 Service Unavailable${EOL}`)
    expect(await child.exited).toBe(1)
  })

  test("does not print a newline for an SSE response without a body", async () => {
    await using directory = await tmpdir()
    using server = apiServer(
      () => new Response(null, { status: 204, headers: { "content-type": "text/event-stream" } }),
    )
    const child = cli(directory.path, server.url)
    expect(await new Response(child.stdout).text()).toBe("")
    expect(await new Response(child.stderr).text()).toBe("")
    expect(await child.exited).toBe(0)
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

async function readOutput(reader: ReadableStreamDefaultReader<Uint8Array>, until?: string) {
  const decoder = new TextDecoder()
  let output = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    output += decoder.decode(chunk.value, { stream: true })
    if (until && output.endsWith(until)) break
  }
  return output
}
