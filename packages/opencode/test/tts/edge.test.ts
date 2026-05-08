import { describe, expect, test } from "bun:test"
import { synth } from "../../src/tts/edge"

describe("tts.edge.synth", () => {
  test("rejects empty text", async () => {
    await expect(synth("")).rejects.toThrow("Empty text")
    await expect(synth("   ")).rejects.toThrow("Empty text")
  })

  test(
    "produces mp3 audio bytes",
    async () => {
      const audio = await synth("Hello, world")
      expect(audio).toBeInstanceOf(Uint8Array)
      expect(audio.length).toBeGreaterThan(100)
      // MP3 files start with 0xFF 0xFB/0xF3 sync word or ID3 tag (0x49 0x44 0x33)
      const isMP3 =
        (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0) ||
        (audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33)
      expect(isMP3).toBe(true)
    },
    { timeout: 30_000 },
  )
})
