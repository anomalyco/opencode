import { expect } from "bun:test"
import { Effect, Stream } from "effect"
import { SpeechEvent } from "../../src/index.js"

export const TEXT = "Hello from OpenCode."

export const collectSpeech = <E, R>(stream: Stream.Stream<SpeechEvent, E, R>) =>
  Effect.gen(function* () {
    const events = Array.from(yield* Stream.runCollect(stream))
    const finish = events.at(-1)
    const deltas = events.filter(SpeechEvent.is.audioDelta)
    expect(deltas.length).toBeGreaterThan(0)
    expect(events.filter(SpeechEvent.is.finish)).toHaveLength(1)
    if (!finish || !SpeechEvent.is.finish(finish)) throw new Error("Expected the speech stream to end with finish")
    const audio = yield* finish.audio.bytes()
    expect(audio.length).toBeGreaterThan(0)
    expect(audio.length).toBe(deltas.reduce((total, event) => total + event.chunk.length, 0))
    return { events, finish }
  })
