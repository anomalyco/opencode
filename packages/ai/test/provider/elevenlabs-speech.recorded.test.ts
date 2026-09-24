import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Speech, SpeechEvent } from "../../src/index.js"
import { ElevenLabs } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TEXT, collectSpeech } from "./speech-recording.js"

const model = ElevenLabs.configure({
  apiKey: process.env.ELEVENLABS_API_KEY ?? "fixture",
}).speech("eleven_flash_v2_5")

// "George", an ElevenLabs premade voice.
const voice = "JBFqnCBsd6RMkjVDRZzb"

const recorded = recordedTests({
  prefix: "elevenlabs-speech",
  provider: "elevenlabs",
  protocol: "elevenlabs-speech",
  requires: ["ELEVENLABS_API_KEY"],
  // Usage and the request id arrive only as response headers.
  options: { redact: { allowResponseHeaders: ["character-cost", "request-id"] } },
})

describe("ElevenLabs Speech recorded", () => {
  recorded.effect("generates speech", () =>
    Effect.gen(function* () {
      const response = yield* Speech.generate({ model, text: TEXT, voice })

      expect(response.audio.mediaType).toBe("audio/mpeg")
      expect(response.audio.info).toMatchObject({ format: "mp3", sampleRate: 44100 })
      expect((yield* response.audio.bytes()).length).toBeGreaterThan(0)
      expect(response.usage).toEqual({ type: "credits", credits: 3 })
    }),
  )

  recorded.effect("streams speech with timestamps", () =>
    Effect.gen(function* () {
      const { events, finish } = yield* collectSpeech(
        Speech.stream({ model, text: TEXT, voice, format: "pcm", timestamps: true }),
      )
      const timestamps = events.filter(SpeechEvent.is.timestamps).flatMap((event) => event.items)

      expect(finish.audio.mediaType).toBe("audio/pcm")
      expect(finish.audio.info).toMatchObject({ encoding: "pcm_s16le", sampleRate: 24000, channels: 1 })
      expect(
        timestamps
          .map((item) => item.text)
          .join("")
          .trim(),
      ).toBe(TEXT)
      expect(timestamps.every((item) => item.endSeconds >= item.startSeconds)).toBe(true)
    }),
  )
})
