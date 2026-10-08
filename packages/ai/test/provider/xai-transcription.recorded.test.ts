import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Transcription } from "../../src/index.js"
import { XAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TRANSCRIPT, audio, audioRecording, dialog } from "./transcription-recording.js"

const model = XAI.configure({ apiKey: process.env.XAI_API_KEY ?? "fixture" }).transcription("grok-voice-transcribe-2.0")

const recorded = recordedTests({
  prefix: "xai-transcription",
  provider: "xai",
  protocol: "xai-transcription",
  requires: ["XAI_API_KEY"],
  options: audioRecording,
})

describe("xAI Transcription recorded", () => {
  recorded.effect("transcribes with word timestamps", () =>
    Effect.gen(function* () {
      const response = yield* Transcription.generate({ model, audio: yield* audio, language: "en" })

      expect(response.text).toMatch(TRANSCRIPT)
      expect(response.words?.length).toBeGreaterThan(2)
      expect(response.words?.every((word) => word.endSeconds >= word.startSeconds)).toBe(true)
      expect(response.language).toBe("en")
      expect(response.usage).toEqual({ type: "seconds", seconds: response.durationSeconds })
    }),
  )

  recorded.effect("diarizes speakers into segments", () =>
    Effect.gen(function* () {
      const response = yield* Transcription.generate({ model, audio: yield* dialog, diarize: true })

      expect(new Set(response.segments?.map((segment) => segment.speaker)).size).toBe(2)
      expect(response.words?.every((word) => word.speaker !== undefined)).toBe(true)
    }),
  )
})
