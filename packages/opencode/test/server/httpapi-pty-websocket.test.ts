import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { handlePtyInput } from "../../src/pty/input"

describe("pty HttpApi websocket input", () => {
  test("does not forward invalid binary frames to the PTY handler", async () => {
    const messages: Array<string | ArrayBuffer> = []
    const handler = { onMessage: (message: string | ArrayBuffer) => messages.push(message) }

    await Effect.runPromise(handlePtyInput(handler, "ready"))
    await Effect.runPromise(handlePtyInput(handler, new Uint8Array([0xff, 0xfe, 0xfd])))
    await Effect.runPromise(handlePtyInput(handler, new TextEncoder().encode("hello")))

    expect(messages).toEqual(["ready", "hello"])
  })
})
