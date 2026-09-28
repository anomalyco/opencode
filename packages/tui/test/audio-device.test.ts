import { expect, test } from "bun:test"
import { hasAudioPlaybackDevice } from "../src/audio-device"

test("detects linux playback nodes", () => {
  expect(hasAudioPlaybackDevice("linux", () => ["controlC0", "pcmC0D0p"])).toBe(true)
})

test("ignores capture-only and mixer-only entries", () => {
  expect(hasAudioPlaybackDevice("linux", () => ["controlC0", "pcmC0D0c", "timer", "seq"])).toBe(false)
})

test("treats unreadable /dev/snd as no device", () => {
  expect(
    hasAudioPlaybackDevice("linux", () => {
      throw new Error("EACCES")
    }),
  ).toBe(false)
})

test("skips the probe off linux", () => {
  expect(
    hasAudioPlaybackDevice("darwin", () => {
      throw new Error("must not probe")
    }),
  ).toBe(true)
})
