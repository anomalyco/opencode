import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { AIError, LLM } from "../../src/index.js"
import { AmazonBedrock, AmazonBedrockMantle } from "../../src/providers.js"
import { it } from "../lib/effect.js"

const providers = [AmazonBedrock, AmazonBedrockMantle]
const credentials = {
  region: "us-east-2",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
}

function withRegion<A, E, R>(region: string | undefined, effect: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.AWS_REGION
      if (region === undefined) delete process.env.AWS_REGION
      else process.env.AWS_REGION = region
      return previous
    }),
    effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.AWS_REGION
        else process.env.AWS_REGION = previous
      }),
  )
}

describe("Bedrock region resolution", () => {
  it.effect("uses AWS_REGION for bearer endpoints and lets an explicit region override it", () =>
    withRegion("eu-west-1", () =>
      Effect.gen(function* () {
        for (const provider of providers) {
          for (const region of [undefined, "us-west-2"]) {
            const model = provider.configure({ apiKey: "test", region }).model("model")
            expect(model.route.endpoint.baseURL).toContain(`.${region ?? "eu-west-1"}.`)
          }
        }
      }),
    ),
  )

  it.effect("uses the same resolved region for the endpoint and signing without mutating credentials", () =>
    withRegion("eu-west-1", () =>
      Effect.gen(function* () {
        for (const provider of providers) {
          for (const region of [undefined, "us-west-2"]) {
            const model = provider.configure({ credentials, region }).model("model")
            const expected = region ?? credentials.region
            expect(model.route.endpoint.baseURL).toContain(`.${expected}.`)
            const headers = yield* model.route.auth.apply({
              request: LLM.request({ model, prompt: "Hi" }),
              method: "POST",
              url: `${model.route.endpoint.baseURL}/test`,
              body: "{}",
              headers: Headers.empty,
            })
            expect(headers.authorization).toContain(`/${expected}/bedrock`)
            expect(credentials.region).toBe("us-east-2")
          }
        }
      }),
    ),
  )

  it.effect("allows unconfigured facades but rejects model initialization without a region", () =>
    withRegion(undefined, () =>
      Effect.gen(function* () {
        for (const provider of providers) {
          expect(() => provider.configure()).not.toThrow()
          expect(() => provider.provider.model("model")).toThrow(AIError)
          expect(() => provider.configure({ apiKey: "test" }).model("model")).toThrow("Set region or AWS_REGION")
          expect(() => provider.configure({ baseURL: "https://gateway.test/v1" }).model("model")).toThrow(AIError)
          expect(() => provider.model("model", { apiKey: "test" })).toThrow(AIError)
        }
        expect(() => AmazonBedrockMantle.configure({ apiKey: "test" }).chat("model")).toThrow(AIError)
      }),
    ),
  )

  it.effect("does not require a region for custom endpoints with bearer auth", () =>
    withRegion(undefined, () =>
      Effect.gen(function* () {
        for (const provider of providers) {
          const model = provider.configure({ apiKey: "test", baseURL: "https://gateway.test/v1" }).model("model")
          expect(model.route.endpoint.baseURL).toBe("https://gateway.test/v1")
        }
      }),
    ),
  )

  it.effect("rejects blank configured and environment regions rather than inventing a default", () =>
    withRegion("  ", () =>
      Effect.gen(function* () {
        for (const provider of providers) {
          expect(() => provider.configure({ apiKey: "test" }).model("model")).toThrow(AIError)
          expect(
            provider.configure({ apiKey: "test", region: " us-west-2 " }).model("model").route.endpoint.baseURL,
          ).toContain(".us-west-2.")
        }
        yield* withRegion("eu-west-1", () =>
          Effect.sync(() => {
            for (const provider of providers)
              expect(() => provider.configure({ apiKey: "test", region: "" }).model("model")).toThrow(AIError)
          }),
        )
      }),
    ),
  )
})
