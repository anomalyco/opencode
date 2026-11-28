import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { once } from "node:events"
import path from "node:path"
import { text } from "node:stream/consumers"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { OPENCODE_VERSION } from "../src/version"
import { isolatedEnv } from "./fixture/environment"

const frame = 'data: {"type":"server.connected"}\n\n'
const cliDir = path.resolve(import.meta.dir, "..")

function serveEvents(root: string, makeStream: () => ReadableStream<Uint8Array>) {
  return Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const pathname = new URL(request.url).pathname
      if (pathname === "/api/info")
        return Response.json({
          version: OPENCODE_VERSION,
          pid: process.pid,
          urls: [],
          paths: { tmp: root },
        })
      if (pathname !== "/api/event") return new Response(null, { status: 404 })
      return new Response(makeStream(), { headers: { "content-type": "text/event-stream; charset=utf-8" } })
    },
  })
}

test("api writes server-sent events before the response closes", async () => {
  await using root = await tmpdir("opencode-api-events-")
  const finish = Promise.withResolvers<void>()
  const server = serveEvents(
    root.path,
    () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame))
          void finish.promise.then(() => controller.close())
        },
      }),
  )

  const child = Bun.spawn(
    [process.execPath, "run", "src/index.ts", "api", "--server", server.url.toString(), "get", "/api/event"],
    {
      cwd: cliDir,
      env: isolatedEnv(root.path),
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(15_000),
    },
  )
  const stderr = new Response(child.stderr).text()
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader()
  try {
    const first = await reader.read()
    expect(first.value).toBe(frame)
    expect(child.exitCode).toBeNull()
    finish.resolve()
    expect((await reader.read()).done).toBe(true)
    expect(await stderr).toBe("")
    expect(await child.exited).toBe(0)
  } finally {
    child.kill()
    await child.exited
    await server.stop(true)
  }
})

test("api exits quietly when a reader closes stdout during an event stream", async () => {
  await using root = await tmpdir("opencode-api-events-")
  const sendNext = Promise.withResolvers<void>()
  const encoded = new TextEncoder().encode(frame)
  const server = serveEvents(
    root.path,
    () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoded)
          void sendNext.promise.then(() => {
            try {
              controller.enqueue(encoded)
            } catch {}
          })
        },
      }),
  )
  const child = spawn(
    process.execPath,
    ["run", "src/index.ts", "api", "--server", server.url.toString(), "get", "/api/event"],
    {
      cwd: cliDir,
      env: isolatedEnv(root.path),
      stdio: ["ignore", "pipe", "pipe"],
      signal: AbortSignal.timeout(15_000),
    },
  )
  const finished = once(child, "close")
  const stderr = text(child.stderr)
  try {
    await new Promise<void>((resolve, reject) => {
      let received = ""
      const onData = (chunk: Buffer) => {
        received += chunk.toString()
        if (!received.includes(frame)) return
        cleanup()
        resolve()
      }
      const onError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const onEnd = () => {
        cleanup()
        reject(new Error(`Stream ended early: ${received}`))
      }
      const cleanup = () => {
        child.stdout.off("data", onData)
        child.stdout.off("error", onError)
        child.stdout.off("end", onEnd)
      }
      child.stdout.on("data", onData)
      child.stdout.on("error", onError)
      child.stdout.on("end", onEnd)
    })
    const stdoutClosed = child.stdout.closed ? Promise.resolve() : once(child.stdout, "close")
    child.stdout.destroy()
    await stdoutClosed
    sendNext.resolve()
    expect(await stderr).toBe("")
    expect(await finished).toEqual([0, null])
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await finished.catch(() => {})
    await server.stop(true)
  }
})
