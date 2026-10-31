import { afterEach, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createAppFixture } from "../fixture/app"

const originalPath = process.env.PATH
afterEach(() => {
  process.env.PATH = originalPath
})

// Drives the real app: a held key reaches the prompt as rapid ordinary presses
// (terminals send no repeat marker without event reporting), and recording must
// neither toggle off nor restart while it is held. The fake recorder logs each
// start, so the assertion counts recorders instead of depending on the final
// toggle state (an odd number of toggles would otherwise look correct).
test("holding the voice key records once; a press after a quiet gap stops", async () => {
  const bin = mkdtempSync(join(tmpdir(), "opencode-voice-keys-"))
  const log = join(bin, "starts.log")
  const ffmpeg = join(bin, "ffmpeg")
  // Last argument is the output file, as ffmpegArgs builds it. Exit cleanly on INT.
  writeFileSync(
    ffmpeg,
    `#!/bin/sh\ntrap 'exit 0' INT\necho started >> '${log}'\nfor a in "$@"; do last="$a"; done\ntouch "$last"\nsleep 30 & wait\n`,
  )
  chmodSync(ffmpeg, 0o755)
  // Prepend: spawn() resolves ffmpeg through the child PATH.
  process.env.PATH = `${bin}:${originalPath}`
  const starts = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).length : 0)

  await using setup = await createAppFixture({
    config: {
      animations: false,
      keybinds: { "prompt.voice.push_to_talk": "f7" },
      voice: { transcribe_command: "echo transcribed" },
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("ctrl+p commands"))

  setup.mockInput.pressKey("F7")
  await setup.waitForFrame((frame) => frame.includes("Recording voice"))
  expect(starts()).toBe(1)

  // Simulated hold: auto-repeat every ~33ms after the OS initial delay.
  for (let index = 0; index < 8; index++) {
    await Bun.sleep(33)
    setup.mockInput.pressKey("F7")
  }
  await Bun.sleep(200)
  await setup.renderOnce()
  expect(starts()).toBe(1)
  expect(setup.captureCharFrame()).toContain("Recording voice")

  // A fresh press after a quiet gap stops and transcribes.
  await Bun.sleep(1100)
  setup.mockInput.pressKey("F7")
  await setup.waitForFrame((frame) => frame.includes("transcribed"))
  expect(setup.captureCharFrame()).not.toContain("Recording voice")
  expect(starts()).toBe(1)

  rmSync(bin, { recursive: true })
}, 30_000)
