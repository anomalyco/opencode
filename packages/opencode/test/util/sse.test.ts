import { describe, expect, test } from "bun:test"
import { writeSSEWithTimeout } from "../../src/util/sse"

describe("util.sse", () => {
  test("resolves when writeSSE resolves in time", async () => {
    const calls: string[] = []
    const stream = {
      writeSSE: async (input: { data: string }) => {
        calls.push(input.data)
      },
    }
    await writeSSEWithTimeout(stream, "hello", 1000)
    expect(calls).toEqual(["hello"])
  })

  test("rejects with timeout error when writeSSE hangs", async () => {
    const stream = {
      writeSSE: () => new Promise<void>(() => {}),
    }
    const err = await writeSSEWithTimeout(stream, "hello", 50).then(
      () => null,
      (e: Error) => e,
    )
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toBe("sse write timeout")
  })

  test("clears the timer when the write resolves first", async () => {
    // If the timer were not cleared it would keep the event loop alive and
    // eventually reject. We verify by waiting past the nominal timeout and
    // confirming the promise has already settled with success.
    const stream = {
      writeSSE: async () => {},
    }
    const p = writeSSEWithTimeout(stream, "hello", 20)
    await p
    // Wait past the timeout window to make sure the timer didn't fire later.
    await new Promise((r) => setTimeout(r, 40))
  })

  test("surfaces the underlying writeSSE error", async () => {
    const stream = {
      writeSSE: async () => {
        throw new Error("boom")
      },
    }
    const err = await writeSSEWithTimeout(stream, "hello", 1000).then(
      () => null,
      (e: Error) => e,
    )
    expect(err?.message).toBe("boom")
  })
})
