import { describe, expect, test } from "bun:test"
import { terminalWriter } from "./writer"

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("terminalWriter", () => {
  test("writes queued bytes as one chunk and skips empty output", async () => {
    const writes: string[] = []

    const output = terminalWriter((data, done) => {
      writes.push(new TextDecoder().decode(data))
      done()
    })

    output.push(new Uint8Array())
    await settle()

    expect(writes).toEqual([])

    output.push(new TextEncoder().encode("one "))
    output.push(new Uint8Array())
    output.push(new TextEncoder().encode("two"))
    await settle()

    expect(writes).toEqual(["one two"])
  })

  test("runs a step only after the output before it is written, and before the output after it", async () => {
    const log: string[] = []
    const pending: VoidFunction[] = []

    const output = terminalWriter((data, done) => {
      log.push(new TextDecoder().decode(data))
      pending.push(done)
    })

    output.push(new TextEncoder().encode("before"))
    output.push(() => log.push("step"))
    output.push(new TextEncoder().encode("after"))
    await settle()

    expect(log).toEqual(["before"])

    pending.shift()?.()
    await settle()

    expect(log).toEqual(["before", "step", "after"])
  })

  test("clear drops what is not written yet and ignores a late done and later pushes", async () => {
    const log: string[] = []
    const pending: VoidFunction[] = []

    const output = terminalWriter((data, done) => {
      log.push(new TextDecoder().decode(data))
      pending.push(done)
    })

    output.push(new TextEncoder().encode("before"))
    output.push(() => log.push("step"))
    output.push(new TextEncoder().encode("after"))
    await settle()
    output.clear()
    pending.shift()?.()
    output.push(new TextEncoder().encode("late"))
    await settle()

    expect(log).toEqual(["before"])
  })

  test("a step or write that throws does not stop the rest of the queue", async () => {
    const log: string[] = []

    const output = terminalWriter((data, done) => {
      const text = new TextDecoder().decode(data)

      if (text === "bad") throw new Error("write")
      log.push(text)
      done()
    })

    output.push(() => {
      throw new Error("step")
    })
    output.push(new TextEncoder().encode("one"))
    await settle()
    output.push(new TextEncoder().encode("bad"))
    output.push(() => log.push("step"))
    output.push(new TextEncoder().encode("two"))
    await settle()

    expect(log).toEqual(["one", "step", "two"])
  })
})
