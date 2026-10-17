import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Transcription } from "../../src/index.js"
import { XAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TRANSCRIPT, audio, audioRecording } from "./transcription-recording.js"

const model = XAI.configure({ apiKey: process.env.XAI_API_KEY ?? "fixture" }).transcription(
  "grok-voice-transcribe-2.0",
)

const recorded = recordedTests({
  prefix: "xai-transcription",
  provider: "xai",
  protocol: "xai-transcription",
  requires: ["XAI_API_KEY"],
  options: audioRecording,
})

describe("xAI Transcription recorded", () => {
  recorded.effect("transcribes word timestamps with speakers", () =>
    Effect.gen(function* () {
      const response = yield* Transcription.generate({
        model,
        audio: yield* audio,
        language: "en",
        diarize: true,
        timestamps: "word",
      })

      expect(response.text).toMatch(TRANSCRIPT)
      expect(response.words?.map((word) => word.text)).toEqual(["Hello", "from", "OpenCode!"])
      expect(response.words?.every((word) => word.speaker === "0")).toBe(true)
      expect(response.language).toBe("en")
      expect(response.durationSeconds).toBe(1.54)
      expect(response.usage).toEqual({ type: "seconds", seconds: 1.54 })
    }),
  )
})
