import { describe, expect, test } from "bun:test"
import { flushWriteStream } from "../../src/cli/stdout"

describe("flushWriteStream", () => {
  test("waits for the stream write callback", async () => {
    let flush: (() => void) | undefined
    let resolved = false

    const pending = flushWriteStream({
      write(_chunk, callback) {
        flush = () => callback()
        return false
      },
    }).then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    flush?.()
    await pending

    expect(resolved).toBe(true)
  })

  test("skips destroyed streams", async () => {
    let wrote = false

    await flushWriteStream({
      destroyed: true,
      write() {
        wrote = true
        return true
      },
    })

    expect(wrote).toBe(false)
  })
})
