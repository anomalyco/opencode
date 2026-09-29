import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Transcription } from "../../src/index.js"
import { AssemblyAI } from "../../src/providers.js"
import { recordedTests } from "../recorded-test.js"
import { TRANSCRIPT, audio, audioRecording } from "./transcription-recording.js"
import { queuedPoll } from "./queued-recording.js"

// Recorded against the EU region: the US endpoint was unreachable from the recording network. Same API and shapes.
const model = AssemblyAI.configure({
  apiKey: process.env.ASSEMBLYAI_API_KEY ?? "fixture",
  baseURL: "https://api.eu.assemblyai.com",
}).transcription("universal-3-5-pro")

const recorded = recordedTests({
  prefix: "assemblyai-transcription",
  provider: "assemblyai",
  protocol: "assemblyai-transcription",
  requires: ["ASSEMBLYAI_API_KEY"],
  options: audioRecording,
})

describe("AssemblyAI Transcription recorded", () => {
  recorded.effect(
    "uploads, submits, and polls a transcript",
    () =>
      Effect.gen(function* () {
        const generation = yield* Transcription.start({ model, audio: yield* audio, diarize: true })
        const response = yield* generation.await({ poll: queuedPoll })

        expect(response.text).toMatch(TRANSCRIPT)
        expect(response.words?.[0]).toMatchObject({ text: "Hello", speaker: "A" })
        expect(response.words?.every((word) => word.startSeconds < 5 && word.endSeconds < 5)).toBe(true)
        expect(response.segments?.[0]?.speaker).toBe("A")
        expect(response.usage).toEqual({ type: "seconds", seconds: expect.any(Number) })
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
