import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import {
  AIError,
  Decision,
  DecisionResponse,
  Image,
  ImageResponse,
  Media,
  RateLimitError,
  Speech,
  SpeechResponse,
  Transcription,
  TranscriptionResponse,
  Video,
  VideoResponse,
} from "../src/effect.js"
import { AI } from "../src/index.js"
import { OpenAI, Runway } from "../src/providers.js"
import { TestDecision, TestImage, TestSpeech, TestTranscription, TestVideo } from "../src/testing.js"
import { testEffect } from "./lib/effect.js"

const openai = OpenAI.configure({ apiKey: "test" })
const runway = Runway.configure({ apiKey: "test" }).video("gen4.5")
const png = Media.bytes(Uint8Array.from([1, 2, 3]), "image/png")
const audio = Media.bytes(Uint8Array.from([4, 5, 6]), "audio/pcm")
const mp4 = Media.url("https://video.test/out.mp4")
const question = { name: "red", type: "predicate", instructions: "Is it red?" } as const
const answer = new DecisionResponse({ answers: [{ name: "red", type: "predicate", probability: 0.9 }] })

const doubles = () =>
  Layer.mergeAll(
    TestImage.testLayer(),
    TestVideo.testLayer(),
    TestSpeech.testLayer(),
    TestTranscription.testLayer(),
    TestDecision.testLayer(),
  )
const it = testEffect(doubles())

describe("media test clients", () => {
  it.effect("script image responses and failures and record requests", () =>
    Effect.gen(function* () {
      const test = yield* TestImage.Test
      const failure = new AIError({ reason: new RateLimitError({ message: "Try later" }) })
      yield* test.push(new ImageResponse({ images: [png] }), failure)
      yield* test.always(new ImageResponse({ images: [png, png] }))

      expect((yield* Image.generate({ model: openai.image("gpt-image-2"), prompt: "A lighthouse" })).image).toBe(png)
      expect(yield* Image.generate({ model: openai.image("gpt-image-2"), prompt: "A kite" }).pipe(Effect.flip)).toBe(
        failure,
      )
      const events = yield* Stream.runCollect(Image.stream({ model: openai.image("gpt-image-2"), prompt: "A boat" }))
      expect(Array.from(events, (event) => event.type)).toEqual(["image", "image", "finish"])
      expect((yield* test.requests()).map((request) => request.prompt)).toEqual(["A lighthouse", "A kite", "A boat"])
    }),
  )

  it.effect("starts completed video generations that resume from their token", () =>
    Effect.gen(function* () {
      const test = yield* TestVideo.Test
      yield* test.serve((request) => new VideoResponse({ videos: request.prompt === "A kite" ? [mp4] : [] }))

      const generation = yield* Video.start({ model: runway, prompt: "A kite" })
      expect(generation.status).toBe("completed")
      expect((yield* generation.await()).video).toBe(mp4)
      const resumed = yield* Video.resume(runway, JSON.parse(JSON.stringify(generation.token)))
      expect((yield* resumed.result()).video).toBe(mp4)
      expect(yield* test.requests()).toHaveLength(1)
      expect(yield* Video.resume(runway, "unknown").pipe(Effect.catchDefect(Effect.succeed))).toMatchObject({
        message: "TestVideo has no generation unknown",
      })
    }),
  )

  it.effect("script speech, transcription, and decision responses", () =>
    Effect.gen(function* () {
      yield* (yield* TestSpeech.Test).push(new SpeechResponse({ audio }))
      yield* (yield* TestTranscription.Test).push(new TranscriptionResponse({ text: "Hello there." }))
      const decision = yield* TestDecision.Test
      yield* decision.push(answer)

      const speech = yield* Stream.runCollect(Speech.stream({ model: openai.speech("gpt-4o-mini-tts"), text: "Hi" }))
      expect(Array.from(speech, (event) => event.type)).toEqual(["finish"])
      expect(
        (yield* Transcription.generate({ model: openai.transcription("gpt-4o-mini-transcribe"), audio })).text,
      ).toBe("Hello there.")
      const response = yield* Decision.generate({
        model: openai.decision("decision-model"),
        input: [{ type: "text", text: "A red apple" }],
        questions: [question],
      })
      expect(response.answers).toEqual([{ name: "red", type: "predicate", probability: 0.9 }])
      expect((yield* decision.requests())[0].questions).toEqual([question])
      expect(
        yield* Speech.generate({ model: openai.speech("gpt-4o-mini-tts"), text: "Hi" }).pipe(
          Effect.catchDefect(Effect.succeed),
        ),
      ).toMatchObject({ message: "TestSpeech has no response for request 2" })
    }),
  )

  test("replace the Promise client's defaults and expose their controls to run", async () => {
    const ai = AI.make({ clients: doubles() })
    await ai.run(
      Effect.gen(function* () {
        yield* (yield* TestImage.Test).push(new ImageResponse({ images: [png] }))
        yield* (yield* TestVideo.Test).push(new VideoResponse({ videos: [mp4] }))
        yield* (yield* TestSpeech.Test).push(new SpeechResponse({ audio }))
        yield* (yield* TestTranscription.Test).push(new TranscriptionResponse({ text: "Hello there." }))
        yield* (yield* TestDecision.Test).push(answer)
      }),
    )

    expect((await ai.image.generate({ model: openai.image("gpt-image-2"), prompt: "A lighthouse" })).image).toBe(png)
    const generation = await ai.video.start({ model: runway, prompt: "A kite" })
    expect((await ai.video.resume(runway, generation.token).then((resumed) => resumed.await())).video).toBe(mp4)
    expect(
      await ai.bytes((await ai.speech.generate({ model: openai.speech("gpt-4o-mini-tts"), text: "Hi" })).audio),
    ).toEqual(Uint8Array.from([4, 5, 6]))
    const deltas = await Array.fromAsync(
      ai.transcription.stream({ model: openai.transcription("gpt-4o-mini-transcribe"), audio }),
    )
    expect(deltas.map((event) => event.type)).toEqual(["finish"])
    const decided = await ai.decision.generate({
      model: openai.decision("decision-model"),
      input: [{ type: "text", text: "A red apple" }],
      questions: [question],
    })
    expect(decided.answers).toEqual([{ name: "red", type: "predicate", probability: 0.9 }])
    expect((await ai.run(TestImage.Test.use((test) => test.requests())))[0].prompt).toBe("A lighthouse")
    await ai.dispose()
  })
})
