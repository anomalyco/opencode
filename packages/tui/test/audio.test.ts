import { afterEach, expect, mock, test } from "bun:test"

afterEach(() => {
  mock.restore()
})

test("audio stops probing the backend after a failed start, until dispose", async () => {
  let starts = 0
  let disposes = 0
  const engine = {
    on() {},
    isStarted() {
      return false
    },
    start() {
      starts++
      return false
    },
    play() {
      return 1
    },
    dispose() {
      disposes++
    },
  }

  mock.module("@opentui/core", () => ({
    Audio: {
      create() {
        return engine
      },
    },
  }))

  const audio = await import("../src/audio")

  audio.play(1 as Parameters<typeof audio.play>[0])
  audio.play(1 as Parameters<typeof audio.play>[0])

  expect(starts).toBe(1)
  expect(disposes).toBe(1)

  audio.dispose()
  audio.play(1 as Parameters<typeof audio.play>[0])

  expect(starts).toBe(2)
})
