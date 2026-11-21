import { expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { EventEmitter, once } from "node:events"
import { createServer } from "node:net"
import path from "node:path"
import { Writable } from "node:stream"
import { text } from "node:stream/consumers"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { streamEvents } from "../src/commands/handlers/api"
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
  const cancelled = Promise.withResolvers<void>()
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
        cancel() {
          cancelled.resolve()
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
    await cancelled.promise
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await finished.catch(() => {})
    await server.stop(true)
  }
})

test("api fails when an event stream drops mid-response", async () => {
  await using root = await tmpdir("opencode-api-events-")
  const drop = Promise.withResolvers<void>()
  const infoBody = JSON.stringify({
    version: OPENCODE_VERSION,
    pid: process.pid,
    urls: [],
    paths: { tmp: root.path },
  })
  const server = createServer((socket) => {
    let head = ""
    socket.on("data", (chunk) => {
      head += chunk.toString()
      if (!head.includes("\r\n\r\n")) return
      socket.removeAllListeners("data")
      if (head.startsWith("GET /api/info ")) {
        socket.end(
          `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(infoBody)}\r\nConnection: close\r\n\r\n${infoBody}`,
        )
        return
      }
      const chunkHex = Buffer.byteLength(frame).toString(16)
      socket.write(
        `HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nTransfer-Encoding: chunked\r\n\r\n${chunkHex}\r\n${frame}\r\n`,
      )
      void drop.promise.then(() => socket.destroy())
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Expected TCP server address")
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      "src/index.ts",
      "api",
      "--server",
      `http://127.0.0.1:${address.port}`,
      "get",
      "/api/event",
    ],
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
    drop.resolve()
    const errorText = await stderr
    expect(errorText).not.toBe("")
    expect(errorText).not.toContain("UnknownError")
    expect(await child.exited).toBe(1)
  } finally {
    child.kill()
    await child.exited
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test.each(["EPIPE", "EOF", "ERR_STREAM_PREMATURE_CLOSE"])(
  "streamEvents treats %s on stdout as normal completion even before destroyed flips",
  async (code) => {
    let aborted = false
    let cancelled = false
    const fakeStdout = Object.assign(new EventEmitter(), {
      destroyed: false,
      writable: true,
      end: () => fakeStdout,
      write(_chunk: Uint8Array, callback?: (error?: Error | null) => void) {
        const error = Object.assign(new Error(`write ${code}`), { code })
        callback?.(error)
        fakeStdout.emit("error", error)
        return false
      },
    }) as unknown as NodeJS.WritableStream
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame))
      },
      cancel() {
        cancelled = true
      },
    })
    await streamEvents(stream, fakeStdout, () => {
      aborted = true
    })
    expect(aborted).toBe(true)
    expect(cancelled).toBe(true)
  },
)

test("streamEvents preserves non-pipe stdout errors and upstream read errors", async () => {
  const diskFull = Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" })
  const failingStdout = new Writable({
    write(_chunk, _encoding, callback) {
      callback(diskFull)
    },
  })
  const goodStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frame))
    },
  })
  await expect(streamEvents(goodStream, failingStdout)).rejects.toBe(diskFull)

  const upstreamError = Object.assign(new Error("upstream socket EPIPE"), { code: "EPIPE" })
  const written: Buffer[] = []
  const collectingStdout = new Writable({
    write(chunk, _encoding, callback) {
      written.push(Buffer.from(chunk))
      callback()
    },
  })
  const failingStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frame))
    },
    pull() {
      return Promise.reject(upstreamError)
    },
  })
  await expect(streamEvents(failingStream, collectingStdout)).rejects.toBe(upstreamError)
  expect(Buffer.concat(written).toString()).toBe(frame)
})
