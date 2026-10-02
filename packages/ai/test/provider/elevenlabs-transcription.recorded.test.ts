import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { Transcription } from "../../src/index.js"
import { ElevenLabs } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TRANSCRIPT, audio, audioRecording, dialog } from "./transcription-recording.js"

const model = ElevenLabs.configure({ apiKey: process.env.ELEVENLABS_API_KEY ?? "fixture" }).transcription("scribe_v2")

const recorded = recordedTests({
  prefix: "elevenlabs-transcription",
  provider: "elevenlabs",
  protocol: "elevenlabs-transcription",
  requires: ["ELEVENLABS_API_KEY"],
  options: audioRecording,
})

describe("ElevenLabs Transcription recorded", () => {
  recorded.effect("transcribes audio with word timestamps", () =>
    Effect.gen(function* () {
      const request = Transcription.request({ model, audio: yield* audio, timestamps: "word" })
      const response = yield* Transcription.generate(request)

      expect(response.text).toMatch(TRANSCRIPT)
      expect(response.words?.map((word) => word.text)).toEqual(["Hello", "from", "OpenCode"])
      expect(response.words?.every((word) => word.speaker === undefined && (word.confidence ?? 0) > 0)).toBe(true)
      expect(response.segments).toBeUndefined()
      expect(response.language).toBe("eng")
      expect(response.durationSeconds).toBeGreaterThan(0)
      expect(response.usage).toEqual({ type: "seconds", seconds: response.durationSeconds })
      expect(response.providerMetadata?.elevenlabs?.transcriptionId).toEqual(expect.any(String))

      const events = Array.from(yield* Stream.runCollect(Transcription.stream(request)))
      expect(events.map((event) => event.type)).toEqual(["finish"])
    }),
  )

  recorded.effect("groups diarized words into speaker turns", () =>
    Effect.gen(function* () {
      const response = yield* Transcription.generate({ model, audio: yield* dialog, diarize: true })

      expect(response.segments?.map((segment) => segment.speaker)).toEqual(["speaker_0", "speaker_1"])
      expect(response.segments?.[0].text).toMatch(/^Did the release ship\?$/)
      expect(response.segments?.[1].text).toMatch(/^Yes, it shipped this morning\.?$/)
      expect(response.segments?.map((segment) => segment.text).join(" ")).toBe(response.text)
      expect(response.words?.some((word) => word.text.trim() === "")).toBe(false)
      expect(new Set(response.words?.map((word) => word.speaker))).toEqual(new Set(["speaker_0", "speaker_1"]))
    }),
  )
})
