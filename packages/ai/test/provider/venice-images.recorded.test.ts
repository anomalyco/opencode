import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { ai } from "../../src/effect.js"
import { Venice } from "../../src/providers.js"
import { dimensions } from "../lib/image.js"
import { recordedTests } from "../recorded-test.js"

const recorded = recordedTests({
  prefix: "venice-images",
  provider: "venice",
  protocol: "openai-images",
  requires: ["VENICE_API_KEY"],
})

// Venice only takes a fixed list of sizes; replay matches the recorded body, so this also pins `size: 1792x1024`.
describe("Venice Images recorded", () => {
  recorded.effect(
    "renders the listed size closest to the requested aspect",
    () =>
      Effect.gen(function* () {
        const model = Venice.configure({ apiKey: process.env.VENICE_API_KEY ?? "fixture" }).image("z-image-turbo")
        const response = yield* ai.image.generate({
          model,
          prompt: "A simple flat black circle centered on a plain white background.",
          aspect: "16:9",
          providerOptions: { outputFormat: "jpeg" },
        })

        expect(model.provider).toBe("venice")
        expect(response.images).toHaveLength(1)
        expect(dimensions(yield* response.image.bytes())).toEqual({ width: 1792, height: 1024 })
      }),
    { timeout: 120_000 },
  )
})
