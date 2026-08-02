import { expect, test } from "bun:test"
import type { Model, Provider } from "@opencode-ai/sdk/v2"
import { ModalPlugin } from "@/plugin/modal/modal"

const BASE_MODEL_ID = "thinkingmachines/Inkling-NVFP4"
const RUNTIME_MODEL_ID = "workspace--inkling.us-west.modal.direct"
const FALLBACK_RUNTIME_MODEL_ID = "workspace--inkling-fallback.us-west.modal.direct"

function makeProvider(baseURL: string): Provider {
  const template: Model = {
    id: BASE_MODEL_ID,
    providerID: "modal",
    name: "Inkling",
    family: "ling",
    api: {
      id: BASE_MODEL_ID,
      url: baseURL,
      npm: "@ai-sdk/openai-compatible",
    },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: 1,
      output: 4,
      cache: {
        read: 0.2,
        write: 0,
      },
    },
    limit: {
      context: 128_000,
      output: 8_192,
    },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: {
        text: true,
        audio: true,
        image: true,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: {
        field: "reasoning_content",
      },
    },
    release_date: "2026-07-15",
    variants: {
      fallback: {
        reasoningEffort: "fallback",
      },
    },
  }

  return {
    id: "modal",
    name: "Modal",
    source: "api",
    env: ["MODAL_PROXY_TOKEN"],
    options: {},
    models: {
      [template.id]: template,
    },
  }
}

test("discovers Modal workspace models", async () => {
  const requests: Array<{ authorization: string | null; path: string }> = []
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push({
        authorization: request.headers.get("authorization"),
        path: new URL(request.url).pathname,
      })
      return Response.json({
        data: [
          {
            id: RUNTIME_MODEL_ID,
            base_model_id: BASE_MODEL_ID,
            name: "Thinking Machines: Inkling",
            input_modalities: ["text", "image", "audio"],
            output_modalities: ["text"],
            context_length: 1_048_576,
            max_output_length: 262_144,
            pricing: {
              prompt: "0.0000012",
              completion: "0.000005",
              input_cache_read: "0.00000027",
            },
            supported_sampling_parameters: ["temperature"],
            supported_features: ["tools", "reasoning"],
            reasoning_options: [
              {
                type: "effort",
                values: ["none", "low", "medium", "high", "xhigh", "max"],
              },
            ],
            interleaved: {
              field: "reasoning_content",
            },
          },
          {
            id: FALLBACK_RUNTIME_MODEL_ID,
            base_model_id: BASE_MODEL_ID,
          },
        ],
      })
    },
  })
  const provider = makeProvider(`${server.url}v1`)

  const plugin = await ModalPlugin()
  const models = await plugin.provider!.models!(provider, {
    auth: {
      type: "api",
      key: "test-token",
    },
  })
  const model = models[RUNTIME_MODEL_ID]

  expect(requests).toEqual([
    {
      authorization: "Bearer test-token",
      path: "/v1/models",
    },
  ])
  expect(Object.keys(models)).toEqual([RUNTIME_MODEL_ID, FALLBACK_RUNTIME_MODEL_ID])
  expect(model.api).toEqual({
    id: RUNTIME_MODEL_ID,
    url: `${server.url}v1`,
    npm: "@ai-sdk/openai-compatible",
  })
  expect(model.family).toBe("ling")
  expect(model.capabilities.interleaved).toEqual({ field: "reasoning_content" })
  expect(model.capabilities.input).toEqual({
    text: true,
    audio: true,
    image: true,
    video: false,
    pdf: false,
  })
  expect(model.cost).toEqual({
    input: 1.2,
    output: 5,
    cache: {
      read: 0.27,
      write: 0,
    },
  })
  expect(model.limit).toEqual({
    context: 1_048_576,
    output: 262_144,
  })
  expect(model.variants).toEqual({
    none: { reasoningEffort: "none" },
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
    xhigh: { reasoningEffort: "xhigh" },
    max: { reasoningEffort: "max" },
  })
  expect(models[FALLBACK_RUNTIME_MODEL_ID].variants).toEqual({
    fallback: {
      reasoningEffort: "fallback",
    },
  })
})

test("hides Modal models when discovery fails", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(null, { status: 503 })
    },
  })

  const plugin = await ModalPlugin()
  const models = await plugin.provider!.models!(makeProvider(`${server.url}v1`), {
    auth: {
      type: "api",
      key: "test-token",
    },
  })

  expect(models).toEqual({})
})
