import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { handlePtyInput } from "../../src/pty/input"
import { it } from "../lib/effect"

describe("pty HttpApi websocket input", () => {
  it.effect("does not forward invalid binary frames to the PTY handler", () =>
    Effect.gen(function* () {
      const messages: Array<string | ArrayBuffer> = []
      const handler = { onMessage: (message: string | ArrayBuffer) => messages.push(message) }

      yield* handlePtyInput(handler, "ready")
      yield* handlePtyInput(handler, new Uint8Array([0xff, 0xfe, 0xfd]))
      yield* handlePtyInput(handler, new TextEncoder().encode("hello"))

      expect(messages).toEqual(["ready", "hello"])
    }),
  )
})
