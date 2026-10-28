import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Decision, DecisionClient, Image, ImageClient, type DecisionModel, type ImageModel } from "../../src/effect.js"
import { it } from "../lib/effect.js"
import { dynamicResponse, observe, type Call } from "../lib/http.js"

const shared = { headers: { "x-test": "yes" }, body: { extra: true } }

// Every request is answered with a 400, so each case only checks what the entrypoint sent.
const record = (calls: Array<Call>) =>
  dynamicResponse((input) => observe(calls, input).pipe(Effect.as(input.respond("{}", { status: 400 }))))

const sentImage = (model: ImageModel) =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    yield* Image.generate({ model, prompt: "A red circle" }).pipe(
      Effect.exit,
      Effect.provide(ImageClient.layer.pipe(Layer.provide(record(calls)))),
    )
    return calls
  })

const sentDecision = (model: DecisionModel) =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    yield* Decision.generate({
      model,
      input: [{ type: "text", text: "The sky is red." }],
      questions: [{ name: "red", type: "predicate", instructions: "Is the sky red?" }],
    }).pipe(Effect.exit, Effect.provide(DecisionClient.layer.pipe(Layer.provide(record(calls)))))
    return calls
  })

interface Case<Model> {
  readonly name: string
  readonly load: () => Promise<Model>
  readonly url: string
  readonly auth: readonly [string, string]
  readonly headers?: Record<string, string | null>
  readonly provider?: string
  /** The model id is in the URL instead of the JSON body. */
  readonly modelInURL?: boolean
  /** Cloudflare's Run API nests the System One body, and so the `body` setting, under `input`. */
  readonly bodyInInput?: boolean
}

const expectRequest = (calls: ReadonlyArray<Call>, model: ImageModel | DecisionModel, entry: Case<unknown>) => {
  expect(calls).toHaveLength(1)
  const call = calls[0]
  expect(call.url).toBe(entry.url)
  expect(call.headers.get(entry.auth[0])).toBe(entry.auth[1])
  expect(call.headers.get("x-test")).toBe("yes")
  for (const [key, value] of Object.entries(entry.headers ?? {})) expect(call.headers.get(key)).toBe(value)
  const body = JSON.parse(call.body)
  expect((entry.bodyInInput ? body.input : body).extra).toBe(true)
  if (!entry.modelInURL) expect(body.model).toBe(model.id)
  if (entry.provider) expect<string>(model.provider).toBe(entry.provider)
}

const images: ReadonlyArray<Case<ImageModel>> = [
  {
    name: "openai-compatible",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/openai-compatible/images")
      return model("qwen-image", {
        ...shared,
        apiKey: "regolo-key",
        baseURL: "https://api.regolo.test/v1",
        provider: "regolo-ai",
      })
    },
    url: "https://api.regolo.test/v1/images/generations",
    auth: ["authorization", "Bearer regolo-key"],
    provider: "regolo-ai",
  },
  {
    name: "openai",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/openai/images")
      return model("gpt-image-2", { ...shared, apiKey: "openai-key", organization: "org-1" })
    },
    url: "https://api.openai.com/v1/images/generations",
    auth: ["authorization", "Bearer openai-key"],
    headers: { "openai-organization": "org-1" },
  },
  {
    name: "openrouter",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/openrouter/images")
      return model("openai/gpt-image-2", { ...shared, apiKey: "openrouter-key" })
    },
    url: "https://openrouter.ai/api/v1/images/generations",
    auth: ["authorization", "Bearer openrouter-key"],
    provider: "openrouter",
  },
  {
    name: "vercel-ai-gateway",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/vercel-ai-gateway/images")
      return model("openai/gpt-image-2", { ...shared, apiKey: "vercel-key" })
    },
    url: "https://ai-gateway.vercel.sh/v1/images/generations",
    auth: ["authorization", "Bearer vercel-key"],
    provider: "vercel-ai-gateway",
  },
  {
    name: "digitalocean",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/digitalocean/images")
      return model("openai-gpt-image-1", { ...shared, apiKey: "do-key" })
    },
    url: "https://inference.do-ai.run/v1/images/generations",
    auth: ["authorization", "Bearer do-key"],
    provider: "digitalocean",
  },
  {
    name: "azure",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/azure/images")
      return model("gpt-image-2", { ...shared, apiKey: "azure-key", resourceName: "fixture" })
    },
    url: "https://fixture.openai.azure.com/openai/v1/images/generations?api-version=v1",
    auth: ["api-key", "azure-key"],
    headers: { authorization: null },
    provider: "azure",
  },
  {
    name: "xai",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/xai/images")
      return model("grok-imagine-image", { ...shared, apiKey: "xai-key" })
    },
    url: "https://api.x.ai/v1/images/generations",
    auth: ["authorization", "Bearer xai-key"],
  },
  {
    name: "zai",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/zai/images")
      return model("glm-image", { ...shared, apiKey: "zai-key", baseURL: "https://open.bigmodel.test/api/paas/v4" })
    },
    url: "https://open.bigmodel.test/api/paas/v4/images/generations",
    auth: ["authorization", "Bearer zai-key"],
  },
  {
    name: "minimax",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/minimax/images")
      return model("image-01", { ...shared, apiKey: "minimax-key", baseURL: "https://api.minimax.cn/v1" })
    },
    url: "https://api.minimax.cn/v1/image_generation",
    auth: ["authorization", "Bearer minimax-key"],
  },
  {
    name: "alibaba",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/alibaba/images")
      return model("qwen-image-2.0", {
        ...shared,
        apiKey: "dashscope-key",
        baseURL: "https://dashscope-intl.aliyuncs.com/api/v1",
      })
    },
    url: "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    auth: ["authorization", "Bearer dashscope-key"],
  },
  {
    name: "google",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/google/images")
      return model("gemini-2.5-flash-image", { ...shared, apiKey: "google-key" })
    },
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    auth: ["x-goog-api-key", "google-key"],
    modelInURL: true,
  },
  {
    name: "google-vertex",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/google-vertex/images")
      return model("gemini-2.5-flash-image", { ...shared, apiKey: "vertex-key" })
    },
    url: "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash-image:generateContent",
    auth: ["x-goog-api-key", "vertex-key"],
    modelInURL: true,
  },
  {
    name: "cloudflare-workers-ai",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/cloudflare-workers-ai/images")
      return model("@cf/leonardo/lucid-origin", { ...shared, apiKey: "cloudflare-key", accountId: "account-1" })
    },
    url: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/run/@cf/leonardo/lucid-origin",
    auth: ["authorization", "Bearer cloudflare-key"],
    modelInURL: true,
  },
]

const decisions: ReadonlyArray<Case<DecisionModel>> = [
  {
    name: "typesafe-ai",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/typesafe-ai/decisions")
      return model("typesafe/jev", {
        ...shared,
        apiKey: "amd-key",
        baseURL: "https://developer.amd.test/radeon/api/v1",
      })
    },
    url: "https://developer.amd.test/radeon/api/v1/systemone",
    auth: ["authorization", "Bearer amd-key"],
    headers: { "typesafe-danger-zone-images": "true" },
    provider: "typesafe-ai",
  },
  {
    name: "opencode",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/opencode/decisions")
      return model("jev", { ...shared, apiKey: "zen-key", baseURL: "https://opencode.ai/inference/systemone/v1" })
    },
    url: "https://opencode.ai/inference/systemone/v1/systemone",
    auth: ["authorization", "Bearer zen-key"],
    headers: { "typesafe-danger-zone-images": "true" },
    provider: "opencode",
  },
  {
    name: "openrouter",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/openrouter/decisions")
      return model("cloudflare/clef-omni", { ...shared, apiKey: "openrouter-key" })
    },
    url: "https://openrouter.ai/api/v1/systemone",
    auth: ["authorization", "Bearer openrouter-key"],
    provider: "openrouter",
  },
  {
    name: "baseten",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/baseten/decisions")
      return model("decision-models/baseten-elephant-9b-latest", { ...shared, apiKey: "baseten-key" })
    },
    url: "https://inference.baseten.co/v1/systemone",
    auth: ["authorization", "Bearer baseten-key"],
    provider: "baseten",
  },
  {
    name: "digitalocean",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/digitalocean/decisions")
      return model("typesafe-jev", { ...shared, apiKey: "do-key" })
    },
    url: "https://inference.do-ai.run/v1/systemone",
    auth: ["authorization", "Bearer do-key"],
    provider: "digitalocean",
  },
  {
    name: "vercel-ai-gateway",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/vercel-ai-gateway/decisions")
      return model("typesafe/jev", { ...shared, apiKey: "vercel-key" })
    },
    url: "https://ai-gateway.vercel.sh/v1/decisions",
    auth: ["authorization", "Bearer vercel-key"],
    provider: "vercel-ai-gateway",
  },
  {
    name: "cloudflare-workers-ai",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/cloudflare-workers-ai/decisions")
      return model("@cf/cloudflare/clef-omni", { ...shared, apiKey: "cloudflare-key", accountId: "account-1" })
    },
    url: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/run",
    auth: ["authorization", "Bearer cloudflare-key"],
    bodyInInput: true,
    provider: "cloudflare-workers-ai",
  },
  {
    name: "cloudflare-ai-gateway",
    load: async () => {
      const { model } = await import("@opencode/ai/providers/cloudflare-ai-gateway/decisions")
      return model("@cf/cloudflare/clef-omni", {
        ...shared,
        apiKey: "gateway-key",
        accountId: "account-1",
        gatewayId: "gateway-1",
      })
    },
    url: "https://api.cloudflare.com/client/v4/accounts/account-1/ai/run",
    auth: ["authorization", "Bearer gateway-key"],
    headers: { "cf-aig-gateway-id": "gateway-1" },
    bodyInInput: true,
    provider: "cloudflare-ai-gateway",
  },
]

describe("image entrypoints", () => {
  for (const entry of images)
    it.effect(`providers/${entry.name}/images sends a configured request`, () =>
      Effect.gen(function* () {
        const model = yield* Effect.promise(entry.load)
        expectRequest(yield* sentImage(model), model, entry)
      }),
    )
})

describe("decision entrypoints", () => {
  for (const entry of decisions)
    it.effect(`providers/${entry.name}/decisions sends a configured request`, () =>
      Effect.gen(function* () {
        const model = yield* Effect.promise(entry.load)
        expectRequest(yield* sentDecision(model), model, entry)
      }),
    )
})
