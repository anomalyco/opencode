import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Speech } from "../../src/index.js"
import { XAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TEXT, collectSpeech } from "./speech-recording.js"

const model = XAI.configure({
  apiKey: process.env.XAI_API_KEY ?? "fixture",
}).speech("grok-tts")

const recorded = recordedTests({
  prefix: "xai-speech",
  provider: "xai",
  protocol: "xai-speech",
  requires: ["XAI_API_KEY"],
})

describe("xAI Speech recorded", () => {
  recorded.effect("generates speech", () =>
    Effect.gen(function* () {
      const response = yield* Speech.generate({ model, text: TEXT, voice: "ara" })

      expect(response.audio.mediaType).toBe("audio/mpeg")
      expect(response.audio.info).toEqual({ format: "mp3" })
      expect((yield* response.audio.bytes()).length).toBeGreaterThan(0)
    }),
  )

  recorded.effect("streams speech", () =>
    Effect.gen(function* () {
      const { finish } = yield* collectSpeech(Speech.stream({ model, text: TEXT, voice: "ara", format: "pcm" }))

      expect(finish.audio.info).toMatchObject({ format: "pcm", encoding: "pcm_s16le", channels: 1 })
      expect((yield* finish.audio.bytes()).length).toBeGreaterThan(0)
    }),
  )
})
