import { describe, expect, test } from "bun:test"
import { createSoundPlayer } from "./sound"

const deferred = () => {
  let resolve!: (value: string | undefined) => void
  const promise = new Promise<string | undefined>((r) => (resolve = r))
  return { promise, resolve }
}

describe("createSoundPlayer", () => {
  test("collapses a burst of plays into a single sound", async () => {
    let now = 0
    const played: string[] = []
    const player = createSoundPlayer({
      load: async (id) => `src:${id}`,
      play: (src) => {
        played.push(src!)
        return () => {}
      },
      now: () => now,
      cooldownMs: 2_000,
    })

    await Promise.all([player("nope-03"), player("nope-03"), player("nope-03"), player("nope-03")])

    expect(played).toEqual(["src:nope-03"])
  })

  test("plays again after the cooldown elapses", async () => {
    let now = 0
    const played: string[] = []
    const player = createSoundPlayer({
      load: async (id) => `src:${id}`,
      play: (src) => {
        played.push(src!)
        return () => {}
      },
      now: () => now,
      cooldownMs: 2_000,
    })

    await player("nope-03")
    now = 1_999
    await player("nope-03")
    now = 2_000
    await player("nope-03")

    expect(played).toEqual(["src:nope-03", "src:nope-03"])
  })

  test("suppresses concurrent plays even when loading is slow", async () => {
    const first = deferred()
    const played: string[] = []
    const player = createSoundPlayer({
      load: () => first.promise,
      play: (src) => {
        played.push(src!)
        return () => {}
      },
      cooldownMs: 2_000,
    })

    const a = player("nope-03")
    const b = player("nope-03")
    first.resolve("src:nope-03")
    await Promise.all([a, b])

    expect(played).toEqual(["src:nope-03"])
  })

  test("does not play unknown or undefined sounds", async () => {
    const played: string[] = []
    const player = createSoundPlayer({
      load: async () => undefined,
      play: (src) => {
        played.push(src!)
        return () => {}
      },
    })

    await player(undefined)
    await player("missing")

    expect(played).toEqual([])
  })

  test("does not block a later sound after a failed load", async () => {
    let now = 0
    const played: string[] = []
    const player = createSoundPlayer({
      load: async (id) => (id === "bad" ? undefined : `src:${id}`),
      play: (src) => {
        played.push(src!)
        return () => {}
      },
      now: () => now,
      cooldownMs: 2_000,
    })

    await player("bad")
    now = 2_000
    await player("nope-03")

    expect(played).toEqual(["src:nope-03"])
  })
})
