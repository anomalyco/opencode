import { expect, test } from "bun:test"
import type { JSONRPCMessage } from "@modelcontextprotocol/client"
import { Environment } from "@opencode/core/environment/index"
import { McpStdio } from "@opencode/core/mcp/stdio"
import { Effect, Layer, Sink, Stream } from "effect"
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

test("accepts a frame of exactly 16 MiB and rejects one byte more", async () => {
  // Frame sizes include the newline.
  const output = await read([...chunks(frame(16 * MiB + 1), 64 * 1024), ...chunks(frame(16 * MiB + 2), 64 * 1024)])

  expect(output.errors).toEqual([expect.stringContaining("over 16 MiB")])
  expect(
    output.messages.map((message) => ("result" in message ? "result" : "error" in message ? "error" : "")),
  ).toEqual(["result", "error"])
})

test("fails only the request whose response is over 16 MiB", async () => {
  const leading = await read([...chunks(frame(17 * MiB), 64 * 1024), after])
  // The TypeScript SDK writes the id after the result. One chunk covers a newline arriving in the
  // chunk that crosses the cap; an odd chunk size splits the trailing id across chunks.
  const response = frame(17 * MiB, '{"result":{"text":"', '"},"jsonrpc":"2.0","id":"call-7"}\n')
  const trailing = await read([response, after])
  const split = await read([...chunks(response, response.length - 20), after])

  for (const [output, id] of [
    [leading, 1],
    [trailing, "call-7"],
    [split, "call-7"],
  ] as const) {
    expect(output.errors).toEqual([expect.stringContaining("over 16 MiB")])
    expect(output.messages).toEqual([
      { jsonrpc: "2.0", id, error: { code: -32603, message: expect.stringContaining("over 16 MiB") } },
      { jsonrpc: "2.0", method: "after" },
    ])
  }
})

test("closes the connection when an oversized message is not a response", async () => {
  const request = frame(17 * MiB, '{"jsonrpc":"2.0","id":1,"method":"sampling/createMessage","params":{"text":"')
  const output = await read([...chunks(request, 64 * 1024), after])

  expect(output.errors).toEqual([expect.stringContaining("over 16 MiB")])
  expect(output.messages).toEqual([])
})

function frame(size: number, prefix = '{"jsonrpc":"2.0","id":1,"result":{"text":"', suffix = '"}}\n') {
  return encoder.encode(prefix + "x".repeat(size - prefix.length - suffix.length) + suffix)
}

function chunks(bytes: Uint8Array, size: number) {
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_, index) =>
    bytes.subarray(index * size, (index + 1) * size),
  )
}

/** Runs the transport against a process whose stdout yields `output` and then ends. */
async function read(output: ReadonlyArray<Uint8Array>) {
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
            kill: () => Effect.void,
            stdin: Sink.drain,
            stdout: Stream.fromIterable(output),
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
