import { expect, test } from "bun:test"
import type { Audio } from "@opentui/core"
import { createAudioIdleRelease } from "../src/audio-idle"

function setup() {
  const state = { voices: 1, stops: 0, reads: 0 }
  let check: (() => void) | undefined
  const audio: Pick<Audio, "getStats" | "stop"> = {
    getStats() {
      state.reads++
      return {
        soundsLoaded: 1,
        voicesActive: state.voices,
        framesMixed: 0n,
        lockMisses: 0,
        lastPeak: 0,
        lastRms: 0,
      }
    },
    stop() {
      state.stops++
      return true
    },
  }
  const release = createAudioIdleRelease(audio, (callback) => {
    check = callback
    return () => {
      check = undefined
    }
  })
  return { state, release, tick: () => check?.() }
}

test("audio idle release waits for playback to finish, then stops polling", () => {
  const fixture = setup()
  fixture.release.watch()
  fixture.tick()
  expect(fixture.state.stops).toBe(0)

  fixture.state.voices = 0
  fixture.tick()
  expect(fixture.state.stops).toBe(1)
  expect(fixture.state.reads).toBe(2)

  fixture.tick()
  expect(fixture.state.stops).toBe(1)
  expect(fixture.state.reads).toBe(2)
})

test("audio idle release disposal cancels polling", () => {
  const fixture = setup()
  fixture.release.watch()
  fixture.release.dispose()
  fixture.tick()
  expect(fixture.state.reads).toBe(0)
  expect(fixture.state.stops).toBe(0)
})
