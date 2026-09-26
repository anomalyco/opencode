import { describe, expect } from "bun:test"
import { Effect, Stream } from "effect"
import { Transcription, TranscriptionEvent } from "../../src/index.js"
import { OpenAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TRANSCRIPT, audio, audioRecording } from "./transcription-recording.js"

const openai = OpenAI.configure({ apiKey: process.env.OPENAI_API_KEY ?? "fixture" })

const recorded = recordedTests({
  prefix: "openai-transcription",
  provider: "openai",
  protocol: "openai-transcription",
  requires: ["OPENAI_API_KEY"],
  options: audioRecording,
})

describe("OpenAI Transcription recorded", () => {
  recorded.effect("transcribes with a language hint", () =>
    Effect.gen(function* () {
      const response = yield* Transcription.generate({
        model: openai.transcription("gpt-transcribe"),
        audio: yield* audio,
        language: "en",
      })

      expect(response.text).toMatch(TRANSCRIPT)
      expect(response.language).toBe("en")
      expect(response.usage?.type).toBeDefined()
    }),
  )

  recorded.effect("streams text deltas", () =>
    Effect.gen(function* () {
      const events = Array.from(
        yield* Stream.runCollect(
          Transcription.stream({ model: openai.transcription("gpt-4o-mini-transcribe"), audio: yield* audio }),
        ),
      )
      const finish = events.at(-1)
      if (finish === undefined || !TranscriptionEvent.is.finish(finish)) throw new Error("Expected a finish event")

      const deltas = events.filter(TranscriptionEvent.is.textDelta).map((event) => event.delta)
      expect(deltas.length).toBeGreaterThan(1)
      expect(deltas.join("")).toBe(finish.text)
      expect(finish.text).toMatch(TRANSCRIPT)
      expect(finish.usage).toMatchObject({
        type: "tokens",
        input: expect.any(Number),
        output: expect.any(Number),
        details: { openai: { input_token_details: { audio_tokens: expect.any(Number) } } },
      })
    }),
  )

  recorded.effect("diarizes speakers into segments", () =>
    Effect.gen(function* () {
      const response = yield* Transcription.generate({
        model: openai.transcription("gpt-4o-transcribe-diarize"),
        audio: yield* audio,
        diarize: true,
      })

      expect(response.text).toMatch(TRANSCRIPT)
      expect(response.segments).toEqual([
        {
          text: expect.stringMatching(TRANSCRIPT),
          startSeconds: expect.any(Number),
          endSeconds: expect.any(Number),
          speaker: "A",
        },
      ])
      expect(response.durationSeconds).toBeGreaterThan(1)
    }),
  )

  recorded.effect("returns whisper word timestamps", () =>
    Effect.gen(function* () {
      const response = yield* Transcription.generate({
        model: openai.transcription("whisper-1"),
        audio: yield* audio,
        timestamps: "word",
      })

      expect(response.words?.map((word) => word.text.toLowerCase())).toEqual(["hello", "from", "opencode"])
      expect(response.words?.every((word) => word.endSeconds > word.startSeconds)).toBe(true)
      expect(response.language).toBe("english")
      expect(response.usage).toEqual({ type: "seconds", seconds: expect.any(Number) })
    }),
  )
})
