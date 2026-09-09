import { describe, expect, test } from "bun:test"
import { terminalWriter } from "./writer"

describe("terminalWriter", () => {
  test("buffers and flushes once per schedule", () => {
    const calls: string[] = []
    const scheduled: VoidFunction[] = []
    const writer = terminalWriter(
      (data, done) => {
        calls.push(data)
        done?.()
      },
      (flush) => scheduled.push(flush),
    )

    writer.push("a")
    writer.push("b")
    writer.push("c")

    expect(calls).toEqual([])
    expect(scheduled).toHaveLength(1)

    scheduled[0]?.()
    expect(calls).toEqual(["abc"])
  })

  test("flush is a no-op when empty", () => {
    const calls: string[] = []
    const writer = terminalWriter(
      (data, done) => {
        calls.push(data)
        done?.()
      },
      (flush) => flush(),
    )
    writer.flush()
    expect(calls).toEqual([])
  })

  test("flush waits for pending write completion", () => {
    const calls: string[] = []
    let done: VoidFunction | undefined
    const writer = terminalWriter(
      (data, finish) => {
        calls.push(data)
        done = finish
      },
      (flush) => flush(),
    )

    writer.push("a")

    let settled = false
    writer.flush(() => {
      settled = true
    })

    expect(calls).toEqual(["a"])
    expect(settled).toBe(false)

    done?.()
    expect(settled).toBe(true)
  })

  test("final flush preserves output queued behind an in-flight write", () => {
    const scheduled: VoidFunction[] = []
    const completions: VoidFunction[] = []
    const events: string[] = []
    const writer = terminalWriter(
      (data, done) => {
        events.push(data)
        if (done) completions.push(done)
      },
      (flush) => scheduled.push(flush),
    )
    writer.push("build started\r\n")
    scheduled.shift()?.()
    writer.push("\x1b[32mPASS\x1b[0m ")
    writer.push("session/history.test.ts\r\n")
    writer.flush(() => events.push("persist and dispose"))
    expect(events).toEqual(["build started\r\n"])
    completions.shift()?.()
    scheduled.shift()?.()
    expect(events).toEqual(["build started\r\n", "\x1b[32mPASS\x1b[0m session/history.test.ts\r\n"])
    completions.shift()?.()
    expect(events).toEqual([
      "build started\r\n",
      "\x1b[32mPASS\x1b[0m session/history.test.ts\r\n",
      "persist and dispose",
    ])
  })
})
