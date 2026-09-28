import { afterAll, beforeAll, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { Message } from "@opencode-ai/llm"
import { reply, startLocalServer } from "../lib/local-server"
import { tmpdir } from "../lib/tmp"
import { collect, config, joined, pinned, turn, withGateway } from "./gateway"

const data = await tmpdir()
const previous = process.env.XDG_DATA_HOME
beforeAll(() => {
  process.env.XDG_DATA_HOME = data.path
})
afterAll(async () => {
  process.env.XDG_DATA_HOME = previous
  await data[Symbol.asyncDispose]()
})

test("concurrency 1: a second concurrent call waits and reports onQueued(\"main agent\")", async () => {
  await using server = await startLocalServer({ chunk_delay_ms: 15 })
  server.queue(reply.text("first answer"), reply.text("second answer"))
  const queued: string[] = []
  const result = await withGateway(config(server, { pins: pinned({ concurrency: 1 }) }), (gateway) =>
    Effect.gen(function* () {
      const handle = yield* gateway.resolve("local/test-model")
      const main = yield* collect(gateway, handle, turn({ label: "main agent", messages: [Message.user("a")] })).pipe(Effect.forkChild)
      yield* Effect.sleep(20)
      const side = yield* collect(gateway, handle, turn({
        label: "explore", messages: [Message.user("b")], onQueued: (behind) => Effect.sync(() => queued.push(behind)),
      }))
      return { main: yield* Fiber.join(main), side }
    }),
  )
  expect(queued).toEqual(["main agent"])
  expect(joined(result.main, "text-delta")).toBe("first answer")
  expect(joined(result.side, "text-delta")).toBe("second answer")
  const [a, b] = server.chats()
  // Serialized: the second request starts only after the first stream finished.
  expect(b!.receivedAt).toBeGreaterThanOrEqual(a!.doneAt!)
})

test("hosted-sized queue (concurrency 8) lets calls overlap without queueing", async () => {
  await using server = await startLocalServer({ chunk_delay_ms: 15 })
  server.queue(reply.text("one"), reply.text("two"))
  const queued: string[] = []
  await withGateway(config(server, { pins: pinned({ concurrency: 8 }) }), (gateway) =>
    Effect.gen(function* () {
      const handle = yield* gateway.resolve("local/test-model")
      const onQueued = (behind: string) => Effect.sync(() => queued.push(behind))
      yield* Effect.all([
        collect(gateway, handle, turn({ messages: [Message.user("a")], onQueued })),
        collect(gateway, handle, turn({ label: "sub", messages: [Message.user("b")], onQueued })),
      ], { concurrency: "unbounded" })
    }),
  )
  expect(queued).toEqual([])
  const [a, b] = server.chats()
  expect(b!.receivedAt).toBeLessThan(a!.doneAt!)
})
