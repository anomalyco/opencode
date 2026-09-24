import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { Transcription, TranscriptionEvent } from "../../src/index.js"
import { Google } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TRANSCRIPT, audio, audioRecording, dialog } from "./transcription-recording.js"

const model = Google.configure({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? "fixture" }).transcription(
  "gemini-3.5-transcribe",
)

const recorded = recordedTests({
  prefix: "google-transcription",
  provider: "google",
  protocol: "google-transcription",
  requires: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  options: audioRecording,
})

describe("Google Transcription recorded", () => {
  recorded.effect("transcribes with speakers and word timestamps", () =>
    Effect.gen(function* () {
      const response = yield* Transcription.generate({ model, audio: yield* audio, diarize: true, language: "en-US" })

      expect(response.text).toMatch(TRANSCRIPT)
      expect(response.words?.length).toBeGreaterThan(2)
      expect(response.words?.every((word) => word.endSeconds > word.startSeconds)).toBe(true)
      expect(response.segments).toEqual([
        {
          text: response.text,
          startSeconds: response.words?.[0]?.startSeconds,
          endSeconds: response.words?.at(-1)?.endSeconds,
          speaker: expect.any(String),
        },
      ])
      expect(response.usage?.type).toBe("tokens")
    }),
  )

  recorded.effect("streams speaker turns", () =>
    Effect.gen(function* () {
      const events = Array.from(
        yield* Stream.runCollect(Transcription.stream({ model, audio: yield* dialog, diarize: true })),
      )
      const finish = events.at(-1)
      if (finish === undefined || !TranscriptionEvent.is.finish(finish)) throw new Error("Expected a finish event")

      expect(finish.text).toMatch(/release ship\? Yes, it shipped this morning\.$/)
      const speakers = events.filter(TranscriptionEvent.is.segment).map((event) => event.segment.speaker)
      expect(speakers).toHaveLength(2)
      expect(new Set(speakers).size).toBe(2)
    }),
  )
})
