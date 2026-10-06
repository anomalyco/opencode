import { afterEach, expect, mock, test } from "bun:test"
import { CopilotModels } from "@/plugin/github-copilot/models"
import { CopilotAuthPlugin } from "@/plugin/github-copilot/copilot"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("preserves temperature support from existing provider models", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              model_picker_enabled: true,
              id: "gpt-4o",
              name: "GPT-4o",
              version: "gpt-4o-2024-05-13",
              capabilities: {
                family: "gpt",
                limits: {
                  max_context_window_tokens: 64000,
                  max_output_tokens: 16384,
                  max_prompt_tokens: 64000,
                },
                supports: {
                  streaming: true,
                  tool_calls: true,
                },
              },
            },
            {
              model_picker_enabled: true,
              id: "brand-new",
              name: "Brand New",
              version: "brand-new-2026-04-01",
              capabilities: {
                family: "test",
                limits: {
                  max_context_window_tokens: 32000,
                  max_output_tokens: 8192,
                  max_prompt_tokens: 32000,
                },
                supports: {
                  streaming: true,
                  tool_calls: false,
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  ) as unknown as typeof fetch

  const result = await CopilotModels.get(
    "https://api.githubcopilot.com",
    {},
    {
      "gpt-4o": {
        id: "gpt-4o",
        providerID: "github-copilot",
        api: {
          id: "gpt-4o",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/openai-compatible",
        },
        name: "GPT-4o",
        family: "gpt",
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: true,
          toolcall: true,
          input: {
            text: true,
            audio: false,
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
          interleaved: false,
        },
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: 64000,
          output: 16384,
        },
        options: {},
        headers: {},
        release_date: "2024-05-13",
        variants: {},
        status: "active",
      },
    },
  )
  const models = result.models

  expect(models["gpt-4o"].capabilities.temperature).toBe(true)
  expect(models["brand-new"].capabilities.temperature).toBe(true)
})

test("converts Copilot AIC token prices to USD per million tokens", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              model_picker_enabled: true,
              id: "gpt-5",
              name: "GPT-5",
              version: "gpt-5-2026-06-01",
              billing: {
                token_prices: {
                  batch_size: 500000,
                  default: {
                    input_price: 500,
                    output_price: 3000,
                    cache_price: 50,
                  },
                },
              },
              capabilities: {
                family: "gpt",
                limits: {
                  max_context_window_tokens: 200000,
                  max_output_tokens: 16384,
                  max_prompt_tokens: 200000,
                },
                supports: {
                  streaming: true,
                  tool_calls: true,
                },
              },
            },
            {
              model_picker_enabled: true,
              id: "incomplete-internal-model",
              name: "Incomplete Internal Model",
              version: "incomplete-internal-model-2026-06-01",
              capabilities: {
                family: "internal",
                supports: {},
              },
            },
            {
              model_picker_enabled: false,
              id: "ignored-non-chat-record",
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  ) as unknown as typeof fetch

  const models = (await CopilotModels.get("https://api.githubcopilot.com")).models

  expect(models["gpt-5"].cost).toEqual({
    input: 10,
    output: 60,
    cache: {
      read: 1,
      write: 0,
    },
  })
  expect(models["incomplete-internal-model"]).toBeUndefined()
  expect(models["ignored-non-chat-record"]).toBeUndefined()
})

test("detects PDF input support when vision and media type are advertised", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              model_picker_enabled: true,
              id: "pdf-model",
              name: "PDF Model",
              version: "pdf-model-2026-06-01",
              capabilities: {
                family: "pdf-model",
                limits: {
                  max_context_window_tokens: 128000,
                  max_output_tokens: 16384,
                  max_prompt_tokens: 128000,
                  vision: {
                    max_prompt_image_size: 10000000,
                    max_prompt_images: 10,
                    supported_media_types: ["application/pdf"],
                  },
                },
                supports: {
                  streaming: true,
                  vision: true,
                  tool_calls: true,
                },
              },
            },
            {
              model_picker_enabled: true,
              id: "vision-only-model",
              name: "Vision Only Model",
              version: "vision-only-model-2026-06-01",
              capabilities: {
                family: "vision-only-model",
                limits: {
                  max_context_window_tokens: 128000,
                  max_output_tokens: 16384,
                  max_prompt_tokens: 128000,
                  vision: {
                    max_prompt_image_size: 10000000,
                    max_prompt_images: 10,
                    supported_media_types: ["image/png"],
                  },
                },
                supports: {
                  streaming: true,
                  vision: true,
                  tool_calls: true,
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  ) as unknown as typeof fetch

  const models = (await CopilotModels.get("https://api.githubcopilot.com")).models
  const model = models["pdf-model"]

  expect(model.capabilities.input.pdf).toBe(true)
  expect(models["vision-only-model"].capabilities.input.pdf).toBe(false)
})

test("uses zero cost when Copilot reports a zero billing batch size", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              model_picker_enabled: true,
              id: "mercury-alpha",
              name: "Mercury Alpha",
              version: "mercury-alpha-2026-07-09",
              billing: {
                token_prices: {
                  batch_size: 0,
                  default: {
                    input_price: 0,
                    output_price: 0,
                    cache_price: 0,
                  },
                },
              },
              capabilities: {
                family: "mercury",
                limits: {
                  max_context_window_tokens: 128000,
                  max_output_tokens: 16384,
                  max_prompt_tokens: 128000,
                },
                supports: {
                  streaming: true,
                  tool_calls: true,
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  ) as unknown as typeof fetch

  const model = (await CopilotModels.get("https://api.githubcopilot.com")).models["mercury-alpha"]

  expect(model.cost).toEqual({
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  })
  expect(JSON.stringify(model)).not.toContain("null")
})

test("records Copilot advertised responses endpoint for non-GPT model IDs", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              model_picker_enabled: true,
              id: "mai-code-1-flash-picker",
              name: "MAI-Code-1-Flash",
              version: "mai-code-1-flash-picker",
              supported_endpoints: ["/responses"],
              capabilities: {
                family: "oswe-vscode-modelD",
                limits: {
                  max_context_window_tokens: 256000,
                  max_output_tokens: 128000,
                  max_prompt_tokens: 128000,
                },
                supports: {
                  streaming: true,
                  structured_outputs: true,
                  tool_calls: true,
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  ) as unknown as typeof fetch

  const model = (await CopilotModels.get("https://api.githubcopilot.com")).models["mai-code-1-flash-picker"]

  expect("endpoint" in model.api ? model.api.endpoint : undefined).toBe("responses")
})

test("clears existing variants so refreshed models calculate provider-specific variants", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              model_picker_enabled: true,
              id: "claude-opus-4.7",
              name: "Claude Opus 4.7",
              version: "claude-opus-4.7-2026-04-16",
              supported_endpoints: ["/v1/messages"],
              capabilities: {
                family: "claude-opus",
                limits: {
                  max_context_window_tokens: 144000,
                  max_output_tokens: 64000,
                  max_prompt_tokens: 128000,
                },
                supports: {
                  adaptive_thinking: true,
                  streaming: true,
                  tool_calls: true,
                },
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  ) as unknown as typeof fetch

  const result = await CopilotModels.get(
    "https://api.githubcopilot.com",
    {},
    {
      "claude-opus-4.7": {
        id: "claude-opus-4.7",
        providerID: "github-copilot",
        api: {
          id: "claude-opus-4.7",
          url: "https://api.githubcopilot.com",
          npm: "@ai-sdk/github-copilot",
        },
        name: "Claude Opus 4.7",
        family: "claude-opus",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: {
            text: true,
            audio: false,
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
          interleaved: false,
        },
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: 144000,
          input: 128000,
          output: 64000,
        },
        options: {},
        headers: {},
        release_date: "2026-04-16",
        variants: {
          low: {
            reasoningEffort: "low",
          },
        },
        status: "active",
      },
    },
  )
  const models = result.models

  expect(models["claude-opus-4.7"].api.npm).toBe("@ai-sdk/anthropic")
  expect(models["claude-opus-4.7"].variants).toBeUndefined()
})

test("remaps fallback oauth model urls to the enterprise host", async () => {
  globalThis.fetch = mock(() => Promise.reject(new Error("timeout"))) as unknown as typeof fetch

  const hooks = await CopilotAuthPlugin({
    client: {} as never,
    project: {} as never,
    directory: "",
    worktree: "",
    experimental_workspace: {
      register() {},
    },
    serverUrl: new URL("https://example.com"),
    $: {} as never,
  })

  const models = await hooks.provider!.models!(
    {
      id: "github-copilot",
      models: {
        claude: {
          id: "claude",
          providerID: "github-copilot",
          api: {
            id: "claude-sonnet-4.5",
            url: "https://api.githubcopilot.com/v1",
            npm: "@ai-sdk/anthropic",
          },
        },
      },
    } as never,
    {
      auth: {
        type: "oauth",
        refresh: "token",
        access: "token",
        expires: Date.now() + 60_000,
        enterpriseUrl: "ghe.example.com",
      } as never,
    },
  )

  expect(models.claude.api.url).toBe("https://copilot-api.ghe.example.com")
  expect(models.claude.api.npm).toBe("@ai-sdk/github-copilot")
})

test.each([
  [undefined, "https://api.githubcopilot.com"],
  ["ghe.example.com", "https://copilot-api.ghe.example.com"],
])("discovers independent context variants on one OAuth model for %s", async (enterpriseUrl, host) => {
  globalThis.fetch = mock((request, init) => {
    expect(String(request)).toBe(`${host}/models`)
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token")
    expect(new Headers(init?.headers).get("X-GitHub-Api-Version")).toBe("2026-06-01")
    return Promise.resolve(
      Response.json({
        data: [
          {
            id: "gpt-test",
            name: "GPT Test",
            version: "gpt-test-2026-10-01",
            model_picker_enabled: true,
            supported_endpoints: ["/responses"],
            billing: {
              token_prices: {
                batch_size: 1_000_000,
                default: { context_max: 272_000, input_price: 200, output_price: 1000, cache_price: 10 },
                long_context: { context_max: 922_000, input_price: 400, output_price: 1500, cache_price: 20 },
              },
            },
            capabilities: {
              family: "gpt",
              limits: { max_context_window_tokens: 1_050_000, max_prompt_tokens: 922_000, max_output_tokens: 128_000 },
              supports: { tool_calls: true, reasoning_effort: ["medium", "high"] },
            },
          },
        ],
      }),
    )
  }) as unknown as typeof fetch
  const hooks = await CopilotAuthPlugin({
    client: {} as never,
    project: {} as never,
    directory: "",
    worktree: "",
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost"),
    $: {} as never,
  })
  const models = await hooks.provider!.models!({ id: "github-copilot", models: {} } as never, {
    auth: { type: "oauth", refresh: "test-token", access: "different-access-token", expires: 0, enterpriseUrl },
  })
  expect(Object.keys(models)).toEqual(["gpt-test"])
  const model = models["gpt-test"]
  expect(model.name).toBe("GPT Test")
  expect(model.api).toMatchObject({ id: "gpt-test", url: host, npm: "@ai-sdk/github-copilot" })
  expect("endpoint" in model.api ? model.api.endpoint : undefined).toBe("responses")
  expect(model.options.copilotContext).toEqual({ default: 272_000, long: 922_000 })
  expect(model.cost).toEqual({
    input: 2,
    output: 10,
    cache: { read: 0.1, write: 0 },
    tiers: [{ input: 4, output: 15, cache: { read: 0.2, write: 0 }, tier: { type: "context", size: 272_000 } }],
  })
  expect(Object.keys(model.variants ?? {}).sort()).toEqual([
    "default@default",
    "default@long",
    "high",
    "high@default",
    "high@long",
    "medium",
    "medium@default",
    "medium@long",
  ])
  expect(model.variants?.high).toEqual({
    reasoningEffort: "high",
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"],
  })
  for (const tier of ["default", "long"]) {
    expect(model.variants?.[`high@${tier}`]).toEqual({ copilotContextTier: tier })
    expect(model.variants?.[`default@${tier}`]).toEqual({ copilotContextTier: tier })
    expect(CopilotModels.context(model, `high@${tier}`).limit).toEqual({
      context: tier === "long" ? 1_050_000 : 400_000,
      input: tier === "long" ? 922_000 : 272_000,
      output: 128_000,
    })
  }
  expect(CopilotModels.context(model).limit.input).toBe(272_000)
  expect(model.limit.input).toBe(922_000)
})
