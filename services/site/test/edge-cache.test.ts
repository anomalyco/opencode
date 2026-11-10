import { describe, expect, test } from "bun:test"
import { staleValue } from "~/lib/edge-cache"

describe("staleValue", () => {
  test("answers from the fallback when the source is slow, then from the source", async () => {
    let finish = (_value: string) => {}
    const read = staleValue<string>({
      key: "test/slow",
      freshFor: 60_000,
      wait: 20,
      load: () => new Promise((resolve) => (finish = resolve)),
      fallback: () => "snapshot",
    })
    expect(await read()).toEqual({ value: "snapshot", standIn: true })
    // A read while the refresh runs doesn't wait for it.
    const started = Date.now()
    expect(await read()).toEqual({ value: "snapshot", standIn: true })
    expect(Date.now() - started).toBeLessThan(20)
    finish("live")
    await Bun.sleep(0)
    expect(await read()).toEqual({ value: "live", standIn: false })
  })

  test("keeps the last good value when a refresh fails", async () => {
    const answers = ["first", undefined]
    const read = staleValue<string>({
      key: "test/fails",
      freshFor: 0,
      wait: 100,
      load: async () => answers.shift(),
      fallback: () => "snapshot",
    })
    expect(await read()).toEqual({ value: "first", standIn: false })
    expect(await read()).toEqual({ value: "first", standIn: false })
    await Bun.sleep(0)
    expect(await read()).toEqual({ value: "first", standIn: false })
  })
})
