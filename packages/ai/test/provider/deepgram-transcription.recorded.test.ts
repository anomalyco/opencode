import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { Transcription } from "../../src/index.js"
import { Deepgram } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TRANSCRIPT, audio, audioRecording, dialog } from "./transcription-recording.js"

const model = Deepgram.configure({ apiKey: process.env.DEEPGRAM_API_KEY ?? "fixture" }).transcription("nova-3")

const recorded = recordedTests({
  prefix: "deepgram-transcription",
  provider: "deepgram",
  protocol: "deepgram-transcription",
  requires: ["DEEPGRAM_API_KEY"],
  options: audioRecording,
})

describe("Deepgram Transcription recorded", () => {
  recorded.effect("transcribes raw audio with speakers and word timestamps", () =>
    Effect.gen(function* () {
      const request = Transcription.request({ model, audio: yield* audio, diarize: true, timestamps: "word" })
      const response = yield* Transcription.generate(request)

      expect(response.text).toMatch(TRANSCRIPT)
      expect(response.words?.map((word) => word.text)).toEqual(["Hello", "from", "OpenCode."])
      expect(response.words?.every((word) => word.speaker === "0" && word.confidence !== undefined)).toBe(true)
      expect(response.segments).toEqual([
        { text: response.text, startSeconds: expect.any(Number), endSeconds: expect.any(Number), speaker: "0" },
      ])
      expect(response.language).toBe("en")
      expect(response.usage).toEqual({ type: "seconds", seconds: response.durationSeconds })

      const events = Array.from(yield* Stream.runCollect(Transcription.stream(request)))
      expect(events.map((event) => event.type)).toEqual(["finish"])
    }),
  )

  recorded.effect("splits utterances at speaker changes", () =>
    Effect.gen(function* () {
      const response = yield* Transcription.generate({ model, audio: yield* dialog, diarize: true })

      expect(response.segments?.map((segment) => segment.speaker)).toEqual(["0", "1"])
      expect(response.segments?.[0].text).toMatch(/release ship\?$/)
      expect(response.segments?.[1].text).toMatch(/shipped this morning\.$/)
    }),
  )
})
