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
})
