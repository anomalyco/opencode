import { expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Socket } from "effect/unstable/socket"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { HttpRecorder } from "../src"
import { decodeCassette } from "../src/cassette/model"

test("accepts upstream WebSocket interactions and the OpenCode open snapshot extension", () => {
  const cassette = decodeCassette({
    version: 1,
    interactions: [
      { transport: "websocket", events: [] },
      {
        transport: "websocket",
        open: { url: "wss://example.test", headers: { "content-type": "application/json" } },
        events: [{ direction: "server", kind: "text", body: "ready" }],
      },
    ],
  })
  expect(cassette.interactions).toHaveLength(2)
})

test("constructor replay validates dynamic connection metadata without opening a live socket", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "http-recorder-constructor-"))
  fs.writeFileSync(
    path.join(directory, "constructor.json"),
    JSON.stringify({
      version: 1,
      interactions: [
        {
          transport: "websocket",
          connection: {
            sequence: 0,
            url: "wss://example.test/events",
            protocols: ["events.v1"],
            close: { code: 1000, reason: "complete" },
          },
          events: [],
        },
      ],
    }),
  )

  await Effect.runPromise(
    Effect.gen(function* () {
      const socket = yield* Socket.makeWebSocket("wss://example.test/events", {
        protocols: ["events.v1"],
        closeCodeIsError: () => false,
      })
      yield* socket.runString(() => {})
    }).pipe(
      Effect.scoped,
      Effect.provide(
        HttpRecorder.layerWebSocketConstructor("constructor", { directory }).pipe(
          Layer.provide(
            Layer.succeed(Socket.WebSocketConstructor, () => {
              throw new Error("unexpected live WebSocket construction")
            }),
          ),
        ),
      ),
    ),
  )
  fs.rmSync(directory, { recursive: true, force: true })
})
