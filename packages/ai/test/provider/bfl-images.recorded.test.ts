import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Image } from "../../src/index.js"
import { BlackForestLabs } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"
import { queuedPoll } from "./queued-recording.js"

const model = BlackForestLabs.configure({
  apiKey: process.env.BFL_API_KEY ?? "fixture",
}).image("flux-2-klein-4b")

const recorded = recordedTests({
  prefix: "bfl-images",
  provider: "black-forest-labs",
  protocol: "bfl-images",
  requires: ["BFL_API_KEY"],
})

describe("Black Forest Labs Images recorded", () => {
  recorded.effect(
    "submits, resumes, and polls an image",
    () =>
      Effect.gen(function* () {
        const started = yield* Image.start({
          model,
          prompt: "A simple flat black circle centered on a plain white background.",
          size: "512x512",
          format: "jpeg",
        })
        const generation = yield* Image.resume(model, JSON.parse(JSON.stringify(started.token)))
        const response = yield* generation.await({ poll: queuedPoll })

        expect(response.image.source.type).toBe("bytes")
        expect(dimensions(yield* response.image.bytes())).toEqual({ width: 512, height: 512 })
        // BFL reports cost on submit only; the Ready result omits it.
        expect(response.usage).toEqual({ type: "credits", credits: 1.4000000000000001 })
      }),
    { timeout: 15 * 60 * 1000 },
  )
})
