import { expect, test } from "bun:test"
import { defaultSoundPath } from "#attention-sounds"
import { dispose, isStarted, loadSoundFile, play } from "../src/audio"

// The contract: play() starts the playback device, and the idle watch stops
// it again once the sound has finished, so a played notification sound does
// not hold a system-wide sleep assertion (or a Bluetooth output) open for
// the whole process lifetime. CI runners have no audio device, so play()
// returns null there and this test is a no-op; it exercises the real engine
// and device wherever one exists.
test("play starts the device and the idle watch stops it after the sound finishes", async () => {
  const sound = await loadSoundFile(defaultSoundPath)
  if (sound == null) return
  const voice = play(sound, { volume: 0 })
  if (voice == null) return
  try {
    expect(isStarted()).toBe(true)
    const deadline = Date.now() + 10_000
    while (isStarted() && Date.now() < deadline) await Bun.sleep(50)
    expect(isStarted()).toBe(false)
  } finally {
    dispose()
  }
})
