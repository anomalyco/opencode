import { afterEach, expect, mock, test } from "bun:test"

afterEach(() => {
  mock.restore()
})

test("does not retry audio startup after the playback device is unavailable", async () => {
  let starts = 0
  let disposes = 0
  let plays = 0
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
      plays++
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
  audio.play(1)
  audio.play(1)

  expect(starts).toBe(1)
  expect(disposes).toBe(1)
  expect(plays).toBe(0)

  audio.dispose()
  audio.play(1)
  audio.play(1)

  expect(starts).toBe(2)
  expect(disposes).toBe(2)
  expect(plays).toBe(0)
})
