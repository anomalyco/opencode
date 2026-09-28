import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Speech } from "../../src/index.js"
import { OpenAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TEXT, collectSpeech } from "./speech-recording.js"

const model = OpenAI.configure({
  apiKey: process.env.OPENAI_API_KEY ?? "fixture",
}).speech("gpt-4o-mini-tts")

const recorded = recordedTests({
  prefix: "openai-speech",
  provider: "openai",
  protocol: "openai-speech",
  requires: ["OPENAI_API_KEY"],
})

describe("OpenAI Speech recorded", () => {
  recorded.effect("generates speech", () =>
    Effect.gen(function* () {
      const response = yield* Speech.generate({ model, text: TEXT, voice: "coral" })

      expect(response.audio.mediaType).toBe("audio/mpeg")
      expect((yield* response.audio.bytes()).length).toBeGreaterThan(0)
    }),
  )

  recorded.effect("streams speech", () =>
    Effect.gen(function* () {
      const { finish } = yield* collectSpeech(Speech.stream({ model, text: TEXT, voice: "coral", format: "pcm" }))

      expect(finish.audio.mediaType).toBe("audio/pcm")
      expect(finish.audio.info).toMatchObject({ encoding: "pcm_s16le", sampleRate: 24000, channels: 1 })
      expect(finish.usage?.type).toBe("tokens")
    }),
  )
})
