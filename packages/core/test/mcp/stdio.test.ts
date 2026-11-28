import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import type { JSONRPCMessage } from "@modelcontextprotocol/client"
import { Environment } from "@opencode/core/environment/index"
import { McpStdio } from "@opencode/core/mcp/stdio"
import { Deferred, Effect, Exit, Fiber, Layer, Logger, References, Sink, Stream } from "effect"
import { TestClock } from "effect/testing"
import { ChildProcessSpawner } from "effect/process"
import { ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"
import { hostEnvironmentLayer } from "../fixture/environment"
import { tmpdirScoped } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const encoder = new TextEncoder()
const MiB = 1024 * 1024
const after = encoder.encode('{"jsonrpc":"2.0","method":"after"}\n')

test("receives a frame between 10 and 16 MiB split into pipe-sized chunks", async () => {
  // 12 MiB sits between the SDK read buffer's 10 MiB default and our 16 MiB cap.
  const output = await read(chunks(frame(12 * MiB), 64 * 1024))

  expect(output.errors).toEqual([])
  expect(output.messages).toHaveLength(1)
  expect(output.messages[0]).toMatchObject({ jsonrpc: "2.0", id: 1 })
})

test("frames CRLF, blank lines, several messages per chunk and split UTF-8", async () => {
  const bytes = encoder.encode(
    [
      '{"jsonrpc":"2.0","method":"first","params":{"text":"héllo 🙂"}}\r\n',
      "\n",
      "  \r\n",
      "not json\n",
      '{"jsonrpc":"2.0","method":"second"}\n{"jsonrpc":"2.0","method":"third"}\r\n',
    ].join(""),
  )

  for (const size of [bytes.length, 1, 3]) {
    const output = await read(chunks(bytes, size))
    expect(output.messages).toEqual([
      { jsonrpc: "2.0", method: "first", params: { text: "héllo 🙂" } },
      { jsonrpc: "2.0", method: "second" },
      { jsonrpc: "2.0", method: "third" },
    ])
    expect(output.errors).toEqual([expect.stringContaining("Invalid MCP stdio message")])
  }
})

test("accepts a frame of exactly 16 MiB", async () => {
  // Frame sizes include the newline.
  const output = await read(chunks(frame(16 * MiB + 1), 64 * 1024))

  expect(output.errors).toEqual([])
  expect(output.messages).toEqual([expect.objectContaining({ id: 1, result: expect.anything() })])
})

test("closes the connection on a line one byte over 16 MiB", async () => {
  // stdout stays open until the process is killed, so finishing at all means the transport closed
  // itself, which is what fails the client's pending requests.
  const output = await read([...chunks(frame(16 * MiB + 2), 64 * 1024), after], { open: true })

  expect(output.errors).toEqual(["MCP server framing wrote more than 16 MiB to stdout without a message boundary"])
  expect(output.messages).toEqual([])
})

test("drains server stderr into the layer's debug logger", async () => {
  const logs: Array<{ level: string; message: unknown; annotations: Record<string, unknown> }> = []
  const logging = Logger.layer(
    [
      Logger.map(Logger.formatStructured, (entry) => {
        logs.push({ level: entry.level, message: entry.message, annotations: entry.annotations })
      }),
    ],
    { mergeWithExisting: false },
  ).pipe(Layer.merge(Layer.succeed(References.MinimumLogLevel, "Debug")))
  const environment = spawnerLayer({
    stdout: Stream.empty,
    stderr: Stream.fromIterable([encoder.encode("booting\n"), encoder.encode("   \n"), encoder.encode("ready\n")]),
  })

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* McpStdio.make({
          server: "stderr-test",
          command: "unused",
          args: [],
          cwd: import.meta.dir,
          environment: {},
        })
        const closed = new Promise<void>((resolve) => (transport.onclose = resolve))
        yield* Effect.promise(() => transport.start())
        yield* Effect.promise(() => closed)
      }).pipe(Effect.annotateLogs({ connectionID: "conn_1" }), Effect.provide(Layer.merge(environment, logging))),
    ),
  )

  expect(logs).toEqual([
    {
      level: "DEBUG",
      message: ["mcp server stderr", { server: "stderr-test", output: "booting\n" }],
      annotations: { connectionID: "conn_1" },
    },
    {
      level: "DEBUG",
      message: ["mcp server stderr", { server: "stderr-test", output: "ready\n" }],
      annotations: { connectionID: "conn_1" },
    },
  ])
})

// Closing waits out a grace period for the process to exit, then escalates; both run on the caller's clock.
const closing = (close: Promise<void>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.promise(() => close).pipe(Effect.forkChild({ startImmediately: true }))
    while (!fiber.pollUnsafe()) {
      yield* Effect.promise(() => Bun.sleep(5))
      yield* TestClock.adjust("500 millis")
    }
    yield* Fiber.join(fiber)
  })

testEffect(Layer.empty).effect("closes a process that finishes spawning after close", () =>
  Effect.gen(function* () {
    const spawning = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const exited = yield* Deferred.make<ExitCode>()
    const signals: Array<string> = []
    const environment = Layer.succeed(
      Environment.Service,
      Environment.Service.of({
        id: Environment.localID,
        local: true,
        path,
        files: Environment.makeFiles(Environment.makeMemoryDriver()),
        spawner: ChildProcessSpawner.make(() =>
          Effect.gen(function* () {
            yield* Deferred.succeed(spawning, undefined)
            yield* Deferred.await(release)
            return makeHandle({
              pid: ProcessId(1),
              exitCode: Deferred.await(exited),
              isRunning: Deferred.isDone(exited).pipe(Effect.map((done) => !done)),
              kill: (options) =>
                Effect.sync(() => signals.push(options?.killSignal ?? "SIGTERM")).pipe(
                  Effect.andThen(Deferred.succeed(exited, ExitCode(143))),
                ),
              stdin: Sink.drain,
              stdout: Stream.never,
              stderr: Stream.empty,
              all: Stream.never,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            })
          }),
        ),
      }),
    )
    const transport = yield* McpStdio.make({
      server: "spawning",
      command: "unused",
      args: [],
      cwd: import.meta.dir,
      environment: {},
    }).pipe(Effect.provide(environment))
    const start = transport.start()
    yield* Deferred.await(spawning)
    const close = transport.close()
    yield* Deferred.succeed(release, undefined)
    yield* closing(Promise.all([start, close]).then(() => undefined))
    expect(signals).toEqual(["SIGTERM"])
  }),
)

// A wrapper that exits on stdin EOF leaves a descendant that ignores SIGTERM and keeps the pipes.
;(process.platform === "win32"
  ? testEffect(hostEnvironmentLayer).effect.skip
  : testEffect(hostEnvironmentLayer).effect)("kills the descendants of a server that exits on close", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const pidFile = path.join(tmp.path, "child.pid")
    yield* Effect.addFinalizer(() =>
      Effect.tryPromise(async () => process.kill(Number(await fs.readFile(pidFile, "utf8")), "SIGKILL")).pipe(
        Effect.ignore,
      ),
    )
    const ready = yield* Deferred.make<void>()
    const transport = yield* McpStdio.make({
      server: "held-stdio",
      command: "node",
      args: [path.join(import.meta.dir, "../fixture/held-stdio.cjs"), "mcp", pidFile],
      cwd: tmp.path,
      environment: {},
    })
    transport.onmessage = () => Deferred.doneUnsafe(ready, Exit.void)
    yield* Effect.promise(() => transport.start())
    yield* Deferred.await(ready)
    const pid = Number(yield* Effect.promise(() => fs.readFile(pidFile, "utf8")))
    yield* closing(transport.close())
    const deadline = Date.now() + 5_000
    while (
      Date.now() < deadline &&
      (yield* Effect.sync(() => {
        try {
          return process.kill(pid, 0)
        } catch {
          return false
        }
      }))
    )
      yield* Effect.promise(() => Bun.sleep(10))
    expect(() => process.kill(pid, 0)).toThrow()
  }),
)

function frame(size: number) {
  const prefix = '{"jsonrpc":"2.0","id":1,"result":{"text":"'
  const suffix = '"}}\n'
  return encoder.encode(prefix + "x".repeat(size - prefix.length - suffix.length) + suffix)
}

function chunks(bytes: Uint8Array, size: number) {
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_, index) =>
    bytes.subarray(index * size, (index + 1) * size),
  )
}

function spawnerLayer(input: {
  stdout: Stream.Stream<Uint8Array>
  stderr?: Stream.Stream<Uint8Array>
  kill?: () => Effect.Effect<unknown>
}) {
  const driver = Environment.makeMemoryDriver()
  return Layer.succeed(
    Environment.Service,
    Environment.Service.of({
      id: Environment.localID,
      local: true,
      path,
      files: Environment.makeFiles(driver),
      spawner: ChildProcessSpawner.make(() =>
        Effect.succeed(
          makeHandle({
            pid: ProcessId(1),
            exitCode: Effect.succeed(ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => (input.kill ? Effect.asVoid(input.kill()) : Effect.void),
            stdin: Sink.drain,
            stdout: input.stdout,
            stderr: input.stderr ?? Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        ),
      ),
    }),
  )
}

/** Runs the transport against a process whose stdout yields `output`, then ends or, with `open`, waits to be killed. */
async function read(output: ReadonlyArray<Uint8Array>, options?: { open: boolean }) {
  const killed = Deferred.makeUnsafe<void>()
  const messages: Array<JSONRPCMessage> = []
  const errors: Array<string> = []
  const environment = spawnerLayer({
    stdout: Stream.fromIterable(output).pipe(
      Stream.concat(options?.open ? Stream.fromEffect(Deferred.await(killed)).pipe(Stream.drain) : Stream.empty),
    ),
    kill: () => Deferred.succeed(killed, undefined),
  })

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* McpStdio.make({
          server: "framing",
          command: "unused",
          args: [],
          cwd: import.meta.dir,
          environment: {},
        })
        const closed = new Promise<void>((resolve) => (transport.onclose = resolve))
        transport.onmessage = (message) => messages.push(message)
        // stdout ending reports the exit; only framing errors matter here.
        transport.onerror = (error) => {
          if (!error.message.startsWith("MCP server process exited")) errors.push(error.message)
        }
        yield* Effect.promise(() => transport.start())
        yield* Effect.promise(() => closed)
      }).pipe(Effect.provide(environment)),
    ),
  )

  return { messages, errors }
}
