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

test("uses Copilot API limits for each model", async () => {
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
              id: "claude-sonnet-4.6",
              name: "Claude Sonnet 4.6",
              version: "claude-sonnet-4.6-2026-02-24",
              capabilities: {
                family: "claude-sonnet",
                limits: {
                  max_context_window_tokens: 200000,
                  max_output_tokens: 32000,
                  max_prompt_tokens: 160000,
                },
                supports: {
                  streaming: true,
                  tool_calls: true,
                },
              },
            },
            {
              model_picker_enabled: true,
              id: "gpt-5.4-extended",
              name: "GPT-5.4 Extended",
              version: "gpt-5.4-extended-2026-04-01",
              capabilities: {
                family: "gpt",
                limits: {
                  max_context_window_tokens: 1000000,
                  max_output_tokens: 128000,
                  max_prompt_tokens: 872000,
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

  const models = (await CopilotModels.get("https://api.githubcopilot.com")).models

  expect(models["gpt-4o"].limit).toEqual({
    context: 64000,
    input: 64000,
    output: 16384,
  })
  expect(models["claude-sonnet-4.6"].limit).toEqual({
    context: 200000,
    input: 160000,
    output: 32000,
  })
  expect(models["gpt-5.4-extended"].limit).toEqual({
    context: 1000000,
    input: 872000,
    output: 128000,
  })
})

test("adds long context choices for Copilot tiered-context models", async () => {
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              model_picker_enabled: true,
              id: "gpt-5.4",
              name: "GPT-5.4",
              version: "gpt-5.4-2026-03-05",
              billing: {
                token_prices: {
                  batch_size: 1000000,
                  default: {
                    cache_price: 25,
                    cache_write_price: 0,
                    context_max: 272000,
                    input_price: 250,
                    output_price: 1500,
                  },
                  long_context: {
                    cache_price: 50,
                    cache_write_price: 0,
                    context_max: 922000,
                    input_price: 500,
                    output_price: 2250,
                  },
                },
              },
              capabilities: {
                family: "gpt",
                limits: {
                  max_context_window_tokens: 1050000,
                  max_output_tokens: 128000,
                  max_prompt_tokens: 922000,
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

  const models = (await CopilotModels.get("https://api.githubcopilot.com")).models

  expect(models["gpt-5.4"].api.id).toBe("gpt-5.4")
  expect(models["gpt-5.4"].limit).toEqual({
    context: 272000,
    input: 272000,
    output: 128000,
  })
  expect(models["gpt-5.4"].cost).toEqual({
    input: 2.5,
    output: 15,
    cache: {
      read: 0.25,
      write: 0,
    },
  })
  expect(models["gpt-5.4-long-context"].api.id).toBe("gpt-5.4")
  expect(models["gpt-5.4-long-context"].name).toBe("GPT-5.4 Long")
  expect(models["gpt-5.4-long-context"].limit).toEqual({
    context: 1050000,
    input: 922000,
    output: 128000,
  })
  expect(models["gpt-5.4-long-context"].cost).toEqual({
    input: 5,
    output: 22.5,
    cache: {
      read: 0.5,
      write: 0,
    },
  })
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
