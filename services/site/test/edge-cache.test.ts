import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { staleValue } from "~/lib/edge-cache"

describe("staleValue", () => {
  afterEach(() => setSystemTime())

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

  test("a refresh that never settles doesn't stop later ones", async () => {
    // A promise made by a request that has since ended never settles.
    const answers = [new Promise<string>(() => {}), Promise.resolve("live")]
    const read = staleValue<string>({
      key: "test/lost",
      freshFor: 60_000,
      wait: 20,
      load: () => answers.shift()!,
      fallback: () => "snapshot",
    })
    expect(await read()).toEqual({ value: "snapshot", standIn: true })
    expect(await read()).toEqual({ value: "snapshot", standIn: true })
    setSystemTime(Date.now() + 61_000)
    expect(await read()).toEqual({ value: "live", standIn: false })
  })
  test("feeds back off a failing source like pages do", async () => {
    let loads = 0
    const read = staleValue<string>({
      key: "test/feed-backoff",
      freshFor: 60_000,
      wait: 20,
      load: async () => {
        loads++
        return undefined
      },
      fallback: () => "snapshot",
    })
    expect(await read()).toEqual({ value: "snapshot", standIn: true })
    for (let i = 0; i < 5; i++) expect(await read(50)).toEqual({ value: "snapshot", standIn: true })
    expect(loads).toBe(1)
  })
})
