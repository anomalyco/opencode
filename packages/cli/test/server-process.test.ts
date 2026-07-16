import { expect, test } from "bun:test"
import { Effect, Option, Tracer } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import serve from "../src/commands/handlers/serve"

test("serve command does not create a process-wide trace parent", async () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })

  const result = await Effect.runPromise(
    serve({
      hostname: Option.none(),
      port: Option.none(),
      service: true,
      stdio: true,
    }).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.exit),
  )

  expect(result._tag).toBe("Failure")
  expect(spans).toEqual([])
})

test("server startup does not create a process-wide trace parent", async () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  const { ServerProcess } = await import("@opencode-ai/server/process")

  const result = await Effect.runPromise(
    ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: Option.none(),
      password: "",
      instanceID: "test",
    }).pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.scoped, Effect.exit),
  )

  expect(result._tag).toBe("Failure")
  expect(spans).toEqual([])
})

test("server requests ignore the startup parent and continue inbound trace context", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-server-trace-"))
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/server-trace.ts")], {
    cwd: path.join(import.meta.dir, ".."),
    env: {
      ...process.env,
      HOME: root,
      OPENCODE_DB: path.join(root, "opencode.db"),
      OPENCODE_TEST_HOME: root,
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()

  try {
    const exitCode = await child.exited
    const output = await stdout
    const error = await stderr
    expect(exitCode, error).toBe(0)
    const line = output
      .split("\n")
      .find((line) => line.startsWith("TRACE_RESULT "))
    expect(line).toBeDefined()
    if (line === undefined) throw new Error("Missing trace result")
    const spans = JSON.parse(line.slice("TRACE_RESULT ".length)) as Array<{
      traceId: string
      parentSpanId?: string
    }>

    expect(spans).toHaveLength(3)
    expect(spans[0]?.traceId).not.toBe(spans[1]?.traceId)
    expect(spans[0]?.parentSpanId).toBeUndefined()
    expect(spans[1]?.parentSpanId).toBeUndefined()
    expect(spans[2]).toEqual({
      traceId: "11111111111111111111111111111111",
      parentSpanId: "2222222222222222",
    })
  } finally {
    child.kill("SIGTERM")
    await child.exited
    await fs.rm(root, { recursive: true, force: true })
  }
})
