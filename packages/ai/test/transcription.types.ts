import type { Stream } from "effect"
import { Media, Transcription, type TranscriptionEvent } from "../src/index.js"
import { AssemblyAI, Deepgram, OpenAI } from "../src/providers.js"

type StreamItem<T> = T extends Stream.Stream<infer A, infer _E, infer _R> ? A : never
type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

const audio = Media.url("https://example.com/call.mp3")
const deepgram = Deepgram.configure({ apiKey: "test" }).transcription("nova-3")

Transcription.generate({
  model: deepgram,
  audio,
  timestamps: "word",
  providerOptions: { keyterm: ["OpenCode"], diarize_model: "future-model", futureOption: true },
})
Transcription.start({ model: AssemblyAI.configure({ apiKey: "test" }).transcription("universal-3-5-pro"), audio })

// @ts-expect-error Known provider options are inferred from the selected model.
Transcription.generate({ model: deepgram, audio, providerOptions: { keyterm: "OpenCode" } })
// @ts-expect-error Timestamp granularity is a closed set.
Transcription.generate({ model: deepgram, audio, timestamps: "character" })
// @ts-expect-error Audio is required.
Transcription.request({ model: deepgram })
// @ts-expect-error Speech models cannot be used for transcription requests.
Transcription.request({ model: OpenAI.configure({ apiKey: "test" }).speech("gpt-4o-mini-tts"), audio })

const streamed = Transcription.stream({
  model: OpenAI.configure({ apiKey: "test" }).transcription("gpt-transcribe"),
  audio,
})
type StreamEvent = Assert<Equal<StreamItem<typeof streamed>, TranscriptionEvent>>
void (true satisfies StreamEvent)
