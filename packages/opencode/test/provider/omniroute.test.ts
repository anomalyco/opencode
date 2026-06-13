import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Provider } from "../../src/provider/provider"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

const OMNIRoute = ProviderV2.ID.omniroute
const it = testEffect(Layer.mergeAll(Provider.defaultLayer))

function withEnv<A, E, R>(values: Record<string, string>, effect: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]] as const))
      Object.assign(process.env, values)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )
}

function startMockServer(handler: (req: Request) => Response) {
  return Bun.serve({ port: 0, fetch: handler })
}

const MOCK_RESPONSE = {
  object: "list",
  data: [
    {
      id: "llama-3.1-8b",
      object: "model",
      name: "Llama 3.1 8B",
      context_length: 131072,
      max_output_tokens: 8192,
      capabilities: {
        tool_calling: true,
        reasoning: false,
        thinking: false,
        vision: false,
      },
    },
    {
      id: "qwen-2.5-72b",
      object: "model",
      name: "Qwen 2.5 72B",
      context_length: 131072,
      max_output_tokens: 32768,
      capabilities: {
        tool_calling: true,
        reasoning: true,
        thinking: true,
        vision: true,
      },
    },
  ],
}

it.instance(
  "omniroute discoverModels maps valid /v1/models response to Model objects",
  () =>
    Effect.gen(function* () {
      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          return new Response(JSON.stringify(MOCK_RESPONSE), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`

        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test-key" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        const omni = providers[OMNIRoute]
        expect(omni).toBeDefined()
        expect(omni.name).toBe("OmniRoute")
        expect(omni.source).toBe("config")

        expect(omni.models["llama-3.1-8b"]).toBeDefined()
        const llama = omni.models["llama-3.1-8b"]
        expect(llama.id).toEqual(ModelV2.ID.make("llama-3.1-8b"))
        expect(llama.providerID).toEqual(OMNIRoute)
        expect(llama.name).toBe("Llama 3.1 8B")
        expect(llama.api.id).toBe("llama-3.1-8b")
        expect(llama.api.url).toBe(baseURL)
        expect(llama.api.npm).toBe("@ai-sdk/openai-compatible")
        expect(llama.limit.context).toBe(131072)
        expect(llama.limit.output).toBe(8192)
        expect(llama.capabilities.toolcall).toBe(true)
        expect(llama.capabilities.reasoning).toBe(false)
        expect(llama.capabilities.attachment).toBe(false)

        expect(omni.models["qwen-2.5-72b"]).toBeDefined()
        const qwen = omni.models["qwen-2.5-72b"]
        expect(qwen.id).toEqual(ModelV2.ID.make("qwen-2.5-72b"))
        expect(qwen.providerID).toEqual(OMNIRoute)
        expect(qwen.name).toBe("Qwen 2.5 72B")
        expect(qwen.limit.context).toBe(131072)
        expect(qwen.limit.output).toBe(32768)
        expect(qwen.capabilities.toolcall).toBe(true)
        expect(qwen.capabilities.reasoning).toBe(true)
        expect(qwen.capabilities.attachment).toBe(false)
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute applies default context_length=128000 when missing",
  () =>
    Effect.gen(function* () {
      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          return new Response(
            JSON.stringify({
              object: "list",
              data: [{ id: "no-ctx", object: "model", name: "No Context Model" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        const omni = providers[OMNIRoute]
        expect(omni).toBeDefined()
        const model = omni.models["no-ctx"]
        expect(model).toBeDefined()
        expect(model.limit.context).toBe(128000)
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute applies default max_output_tokens=4096 when missing",
  () =>
    Effect.gen(function* () {
      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          return new Response(
            JSON.stringify({
              object: "list",
              data: [{ id: "no-output", object: "model", name: "No Output Model" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        const omni = providers[OMNIRoute]
        expect(omni).toBeDefined()
        const model = omni.models["no-output"]
        expect(model).toBeDefined()
        expect(model.limit.output).toBe(4096)
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute applies default capabilities (all false) when missing",
  () =>
    Effect.gen(function* () {
      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          return new Response(
            JSON.stringify({
              object: "list",
              data: [{ id: "no-caps", object: "model", name: "No Capabilities Model" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        const omni = providers[OMNIRoute]
        expect(omni).toBeDefined()
        const model = omni.models["no-caps"]
        expect(model).toBeDefined()
        expect(model.capabilities.toolcall).toBe(false)
        expect(model.capabilities.reasoning).toBe(false)
        expect(model.capabilities.input.image).toBe(false)
        expect(model.capabilities.attachment).toBe(false)
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute skips model entries missing id field",
  () =>
    Effect.gen(function* () {
      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          return new Response(
            JSON.stringify({
              object: "list",
              data: [
                { object: "model", name: "No ID Model" },
                { id: "valid-model", object: "model", name: "Valid Model" },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        const omni = providers[OMNIRoute]
        expect(omni).toBeDefined()
        expect(omni.models["valid-model"]).toBeDefined()
        expect(Object.keys(omni.models)).toEqual(["valid-model"])
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute deduplicates model IDs using first occurrence",
  () =>
    Effect.gen(function* () {
      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          return new Response(
            JSON.stringify({
              object: "list",
              data: [
                {
                  id: "dup-model",
                  object: "model",
                  name: "First Occurrence",
                  context_length: 100000,
                  max_output_tokens: 5000,
                  capabilities: { tool_calling: true, reasoning: false, vision: false },
                },
                {
                  id: "dup-model",
                  object: "model",
                  name: "Second Occurrence",
                  context_length: 200000,
                  max_output_tokens: 8000,
                  capabilities: { tool_calling: false, reasoning: true, vision: true },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        const omni = providers[OMNIRoute]
        expect(omni).toBeDefined()
        expect(Object.keys(omni.models)).toEqual(["dup-model"])
        const model = omni.models["dup-model"]
        expect(model.name).toBe("First Occurrence")
        expect(model.limit.context).toBe(100000)
        expect(model.limit.output).toBe(5000)
        expect(model.capabilities.toolcall).toBe(true)
        expect(model.capabilities.reasoning).toBe(false)
        expect(model.capabilities.input.image).toBe(false)
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute maps reasoning capability from reasoning field",
  () =>
    Effect.gen(function* () {
      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          return new Response(
            JSON.stringify({
              object: "list",
              data: [
                {
                  id: "reasoning-model",
                  object: "model",
                  name: "Reasoning Model",
                  capabilities: { tool_calling: false, reasoning: true, thinking: false, vision: true },
                },
                {
                  id: "no-reasoning-model",
                  object: "model",
                  name: "No Reasoning Model",
                  capabilities: { tool_calling: false, reasoning: false, thinking: true, vision: false },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        const omni = providers[OMNIRoute]
        expect(omni).toBeDefined()

        const reasoning = omni.models["reasoning-model"]
        expect(reasoning.capabilities.reasoning).toBe(true)
        expect(reasoning.capabilities.input.image).toBe(true)

        const noReasoning = omni.models["no-reasoning-model"]
        expect(noReasoning.capabilities.reasoning).toBe(false)
        expect(noReasoning.capabilities.input.image).toBe(false)
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute integration: models appear in provider list with correct capabilities and limits",
  () =>
    Effect.gen(function* () {
      let receivedAuthHeader: string | undefined

      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          receivedAuthHeader = req.headers.get("Authorization") ?? undefined
          return new Response(
            JSON.stringify({
              object: "list",
              data: [
                {
                  id: "gpt-4o",
                  object: "model",
                  name: "GPT-4o",
                  context_length: 128000,
                  max_output_tokens: 16384,
                  capabilities: {
                    tool_calling: true,
                    reasoning: false,
                    thinking: false,
                    vision: true,
                  },
                },
                {
                  id: "claude-3.5-sonnet",
                  object: "model",
                  name: "Claude 3.5 Sonnet",
                  context_length: 200000,
                  max_output_tokens: 8192,
                  capabilities: {
                    tool_calling: true,
                    reasoning: true,
                    thinking: true,
                    vision: true,
                  },
                },
                {
                  id: "minimal-model",
                  object: "model",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-integration-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        expect(receivedAuthHeader).toBe("Bearer sk-integration-test")

        const omni = providers[OMNIRoute]
        expect(omni).toBeDefined()
        expect(omni.name).toBe("OmniRoute")
        expect(omni.source).toBe("config")

        expect(Object.keys(omni.models)).toHaveLength(3)

        const gpt = omni.models["gpt-4o"]
        expect(gpt).toBeDefined()
        expect(gpt.id).toEqual(ModelV2.ID.make("gpt-4o"))
        expect(gpt.providerID).toEqual(OMNIRoute)
        expect(gpt.name).toBe("GPT-4o")
        expect(gpt.api.id).toBe("gpt-4o")
        expect(gpt.api.url).toBe(baseURL)
        expect(gpt.api.npm).toBe("@ai-sdk/openai-compatible")
        expect(gpt.limit.context).toBe(128000)
        expect(gpt.limit.output).toBe(16384)
        expect(gpt.capabilities.toolcall).toBe(true)
        expect(gpt.capabilities.reasoning).toBe(false)
        expect(gpt.capabilities.input.image).toBe(true)
        expect(gpt.capabilities.input.text).toBe(true)

        const claude = omni.models["claude-3.5-sonnet"]
        expect(claude).toBeDefined()
        expect(claude.id).toEqual(ModelV2.ID.make("claude-3.5-sonnet"))
        expect(claude.name).toBe("Claude 3.5 Sonnet")
        expect(claude.limit.context).toBe(200000)
        expect(claude.limit.output).toBe(8192)
        expect(claude.capabilities.toolcall).toBe(true)
        expect(claude.capabilities.reasoning).toBe(true)
        expect(claude.capabilities.input.image).toBe(true)

        const minimal = omni.models["minimal-model"]
        expect(minimal).toBeDefined()
        expect(minimal.name).toBe("minimal-model")
        expect(minimal.limit.context).toBe(128000)
        expect(minimal.limit.output).toBe(4096)
        expect(minimal.capabilities.toolcall).toBe(false)
        expect(minimal.capabilities.reasoning).toBe(false)
        expect(minimal.capabilities.input.image).toBe(false)
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute error handling: unreachable endpoint (HTTP 503) does not crash and leaves provider absent",
  () =>
    Effect.gen(function* () {
      const server = startMockServer(() => {
        return new Response("Service Unavailable", { status: 503 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        expect(providers).toBeDefined()
        expect(providers[OMNIRoute]).toBeUndefined()
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute error handling: connection refused does not crash and leaves provider absent",
  () =>
    Effect.gen(function* () {
      const unusedPort = 1
      const baseURL = `http://127.0.0.1:${unusedPort}`

      const providers = yield* withEnv(
        {
          OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            provider: { omniroute: { options: { baseURL } } },
          }),
        },
        Provider.use.list(),
      )

      expect(providers).toBeDefined()
      expect(providers[OMNIRoute]).toBeUndefined()
    }),
  { config: {} },
)

it.instance(
  "omniroute error handling: invalid JSON response returns empty model set and leaves provider absent",
  () =>
    Effect.gen(function* () {
      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          return new Response("not valid json {{{", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        expect(providers).toBeDefined()
        expect(providers[OMNIRoute]).toBeUndefined()
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute error handling: non-JSON content-type response returns empty model set and leaves provider absent",
  () =>
    Effect.gen(function* () {
      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          return new Response("<html><body>Error</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          })
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        expect(providers).toBeDefined()
        expect(providers[OMNIRoute]).toBeUndefined()
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)

it.instance(
  "omniroute uses id as display name when name field is missing",
  () =>
    Effect.gen(function* () {
      const server = startMockServer((req) => {
        const url = new URL(req.url)
        if (url.pathname === "/v1/models") {
          return new Response(
            JSON.stringify({
              object: "list",
              data: [{ id: "fallback-name", object: "model" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        }
        return new Response("Not Found", { status: 404 })
      })

      try {
        const baseURL = `http://127.0.0.1:${server.port}`
        const providers = yield* withEnv(
          {
            OPENCODE_AUTH_CONTENT: JSON.stringify({ omniroute: { type: "api", key: "sk-test" } }),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({
              provider: { omniroute: { options: { baseURL } } },
            }),
          },
          Provider.use.list(),
        )

        const omni = providers[OMNIRoute]
        expect(omni).toBeDefined()
        const model = omni.models["fallback-name"]
        expect(model).toBeDefined()
        expect(model.name).toBe("fallback-name")
      } finally {
        server.stop()
      }
    }),
  { config: {} },
)
