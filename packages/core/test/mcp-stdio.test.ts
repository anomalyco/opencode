import { expect, test } from "bun:test"
import type { JSONRPCMessage } from "@modelcontextprotocol/client"
import { Environment } from "@opencode/core/environment/index"
import { McpStdio } from "@opencode/core/mcp/stdio"
import { Deferred, Effect, Layer, Sink, Stream } from "effect"
import { ChildProcessSpawner } from "effect/process"
import { ExitCode, makeHandle, ProcessId } from "effect/process/ChildProcessSpawner"

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

/** Runs the transport against a process whose stdout yields `output`, then ends or, with `open`, waits to be killed. */
async function read(output: ReadonlyArray<Uint8Array>, options?: { open: boolean }) {
  const killed = Deferred.makeUnsafe<void>()
  const messages: Array<JSONRPCMessage> = []
  const errors: Array<string> = []
  const driver = Environment.makeMemoryDriver()
  const environment = Layer.succeed(
    Environment.Service,
    Environment.Service.of({
      files: Environment.makeFiles(driver),
      spawner: ChildProcessSpawner.make(() =>
        Effect.succeed(
          makeHandle({
            pid: ProcessId(1),
            exitCode: Effect.succeed(ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Deferred.succeed(killed, undefined),
            stdin: Sink.drain,
            stdout: Stream.fromIterable(output).pipe(
              Stream.concat(
                options?.open ? Stream.fromEffect(Deferred.await(killed)).pipe(Stream.drain) : Stream.empty,
              ),
            ),
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        ),
      ),
    }),
  )

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
