import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Speech, SpeechEvent } from "../../src/index.js"
import { Cartesia } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TEXT, collectSpeech } from "./speech-recording.js"

const model = Cartesia.configure({
  apiKey: process.env.CARTESIA_API_KEY ?? "fixture",
}).speech("sonic-3")

// "Katie", the voice from Cartesia's quickstart.
const voice = "f786b574-daa5-4673-aa0c-cbe3e8534c02"

const recorded = recordedTests({
  prefix: "cartesia-speech",
  provider: "cartesia",
  protocol: "cartesia-speech",
  requires: ["CARTESIA_API_KEY"],
  options: { redact: { allowRequestHeaders: ["cartesia-version"] } },
})

describe("Cartesia Speech recorded", () => {
  recorded.effect("generates speech", () =>
    Effect.gen(function* () {
      const response = yield* Speech.generate({ model, text: TEXT, voice, format: "mp3" })

      expect(response.audio.mediaType).toBe("audio/mpeg")
      expect(response.audio.info).toMatchObject({ format: "mp3", sampleRate: 44100 })
      expect((yield* response.audio.bytes()).length).toBeGreaterThan(0)
    }),
  )

  recorded.effect("streams speech with timestamps", () =>
    Effect.gen(function* () {
      const { events, finish } = yield* collectSpeech(
        Speech.stream({ model, text: TEXT, voice, timestamps: true, providerOptions: { sampleRate: 24000 } }),
      )
      const words = events.filter(SpeechEvent.is.timestamps).flatMap((event) => event.items)

      expect(finish.audio.mediaType).toBe("audio/pcm")
      expect(finish.audio.info).toMatchObject({ encoding: "pcm_s16le", sampleRate: 24000, channels: 1 })
      expect(words.length).toBeGreaterThan(0)
      expect(words.every((item) => item.endSeconds >= item.startSeconds)).toBe(true)
    }),
  )
})
