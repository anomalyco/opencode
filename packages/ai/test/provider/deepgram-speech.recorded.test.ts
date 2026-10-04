import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Speech } from "../../src/index.js"
import { Deepgram } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TEXT, collectSpeech } from "./speech-recording.js"

const model = Deepgram.configure({
  apiKey: process.env.DEEPGRAM_API_KEY ?? "fixture",
}).speech("aura-2-thalia-en")

const recorded = recordedTests({
  prefix: "deepgram-speech",
  provider: "deepgram",
  protocol: "deepgram-speech",
  requires: ["DEEPGRAM_API_KEY"],
  // Usage and the request id arrive only as response headers.
  options: { redact: { allowResponseHeaders: ["dg-char-count", "dg-request-id", "dg-model-name"] } },
})

describe("Deepgram Speech recorded", () => {
  recorded.effect("generates speech", () =>
    Effect.gen(function* () {
      const response = yield* Speech.generate({ model, text: TEXT })

      expect(response.audio.mediaType).toBe("audio/mpeg")
      expect(response.audio.info).toEqual({ format: "mp3" })
      expect((yield* response.audio.bytes()).length).toBeGreaterThan(0)
      expect(response.usage).toEqual({ type: "characters", characters: expect.any(Number) })
    }),
  )

  recorded.effect("streams speech", () =>
    Effect.gen(function* () {
      const { finish } = yield* collectSpeech(Speech.stream({ model, text: TEXT, format: "pcm" }))

      expect(finish.audio.info).toMatchObject({ format: "pcm", encoding: "pcm_s16le", channels: 1 })
      expect(finish.usage).toEqual({ type: "characters", characters: expect.any(Number) })
    }),
  )
})
