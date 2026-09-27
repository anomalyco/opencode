import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Speech } from "../../src/index.js"
import { Google } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TEXT, collectSpeech } from "./speech-recording.js"

const google = Google.configure({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture" })

const recorded = recordedTests({
  prefix: "google-speech",
  provider: "google",
  protocol: "google-speech",
  requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
})

describe("Google Speech recorded", () => {
  recorded.effect("generates speech", () =>
    Effect.gen(function* () {
      const response = yield* Speech.generate({
        model: google.speech("gemini-2.5-flash-preview-tts"),
        text: `Say: ${TEXT}`,
        voice: "Kore",
      })

      expect(response.audio.mediaType).toMatch(/^audio\/l16/i)
      expect(response.audio.info).toMatchObject({ encoding: "pcm_s16le", sampleRate: 24000, channels: 1 })
      expect((yield* response.audio.bytes()).length).toBeGreaterThan(0)
      expect(response.usage?.type).toBe("tokens")
    }),
  )

  // Only Gemini 3.1 TTS and later support `streamGenerateContent`.
  recorded.effect("streams speech", () =>
    Effect.gen(function* () {
      const { finish } = yield* collectSpeech(
        Speech.stream({ model: google.speech("gemini-3.1-flash-tts-preview"), text: `Say: ${TEXT}`, voice: "Kore" }),
      )

      expect(finish.audio.mediaType).toMatch(/^audio\/l16/i)
      expect(finish.audio.info).toMatchObject({ encoding: "pcm_s16le", sampleRate: 24000, channels: 1 })
      expect(finish.usage?.type).toBe("tokens")
    }),
  )
})
