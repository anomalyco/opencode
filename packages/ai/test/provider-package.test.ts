import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect } from "effect"
import { Headers } from "effect/unstable/http"
import { LLM, ProviderPackage } from "@opencode-ai/ai"
import { model } from "@opencode-ai/ai/providers/openai"

const packageInput = <Input extends Record<string, unknown>>(id: string, input: Input) => {
  const { headers, body, limits, ...settings } = input
  return { id, settings, defaults: { headers, body, limits } }
}

const authHeaders = (
  selected: ReturnType<typeof model>,
  headers: Record<string, string> = {},
  env: Record<string, string> = {},
) =>
  Effect.runPromise(
    selected.route.auth
      .apply({
        request: LLM.request({ model: selected, prompt: "hello" }),
        method: "POST",
        url: "https://example.test/v1",
        body: "{}",
        headers: Headers.fromInput(headers),
      })
      .pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env })))),
  )

const applyAuth = (
  option: ReturnType<typeof ProviderPackage.bearerAuthOption>,
  headers: Record<string, string> = {},
) => {
  const selected = model(packageInput("gpt-5", { apiKey: "fixture" }))
  return Effect.runPromise(
    option.auth.apply({
      request: LLM.request({ model: selected, prompt: "hello" }),
      method: "POST",
      url: "https://example.test/v1",
      body: "{}",
      headers: Headers.fromInput(headers),
    }),
  )
}

describe("provider package credential lowering", () => {
  test("intentionally renders keys and OAuth credentials as bearer auth", async () => {
    const key = await applyAuth(ProviderPackage.bearerAuthOption({ type: "key", value: "provider-key" }))
    const oauth = await applyAuth(ProviderPackage.bearerAuthOption({ type: "oauth", accessToken: "provider-token" }))

    expect(key.authorization).toBe("Bearer provider-key")
    expect(oauth.authorization).toBe("Bearer provider-token")
  })

  test("keeps key-header credentials configurable and removes stale keys for OAuth", async () => {
    expect(ProviderPackage.apiKeyOrBearerAuthOption({ type: "key", value: "provider-key" }, "x-api-key")).toEqual({
      apiKey: "provider-key",
    })
    const oauth = ProviderPackage.apiKeyOrBearerAuthOption(
      { type: "oauth", accessToken: "provider-token" },
      "x-api-key",
    )
    if (!("auth" in oauth)) throw new Error("Expected OAuth credential to lower to auth")
    const headers = await applyAuth(oauth, { "x-api-key": "stale" })

    expect(headers.authorization).toBe("Bearer provider-token")
    expect(headers["x-api-key"]).toBeUndefined()
  })
})

describe("provider package entrypoints", () => {
  test("semantic API aliases expose the same contract", async () => {
    const modules = await Promise.all([
      import("@opencode-ai/ai/providers/openai"),
      import("@opencode-ai/ai/providers/openai/responses"),
      import("@opencode-ai/ai/providers/openai/chat"),
      import("@opencode-ai/ai/providers/anthropic"),
      import("@opencode-ai/ai/providers/anthropic-compatible"),
      import("@opencode-ai/ai/providers/openai-compatible"),
      import("@opencode-ai/ai/providers/openai-compatible/responses"),
      import("@opencode-ai/ai/providers/amazon-bedrock"),
      import("@opencode-ai/ai/providers/azure"),
      import("@opencode-ai/ai/providers/azure/responses"),
      import("@opencode-ai/ai/providers/azure/chat"),
      import("@opencode-ai/ai/providers/google"),
      import("@opencode-ai/ai/providers/google-vertex"),
      import("@opencode-ai/ai/providers/google-vertex/gemini"),
      import("@opencode-ai/ai/providers/google-vertex/chat"),
      import("@opencode-ai/ai/providers/google-vertex/responses"),
      import("@opencode-ai/ai/providers/google-vertex/messages"),
      import("@opencode-ai/ai/providers/openrouter"),
      import("@opencode-ai/ai/providers/xai"),
      import("@opencode-ai/ai/providers/amazon-bedrock/mantle"),
      import("@opencode-ai/ai/providers/amazon-bedrock/mantle/chat"),
      import("@opencode-ai/ai/providers/amazon-bedrock/mantle/responses"),
    ])

    for (const module of modules) expect(module.model).toBeFunction()
    expect(modules[0].model).toBe(modules[1].model)
    expect(modules[8].model).toBe(modules[9].model)
    expect(modules[12].model).toBe(modules[13].model)
    expect(modules[19].model).toBe(modules[20].model)
  })

  test("maps OpenRouter and xAI package settings onto executable models", async () => {
    const OpenRouter = await import("@opencode-ai/ai/providers/openrouter")
    const XAI = await import("@opencode-ai/ai/providers/xai")
    const settings = {
      apiKey: "fixture",
      baseURL: "https://provider.example.test/v1",
      headers: { "x-application": "opencode" },
      body: { service_tier: "priority" },
      limits: { context: 200_000, output: 64_000 },
    }
    const openrouter = OpenRouter.model(
      packageInput("anthropic/claude-sonnet-4", {
        ...settings,
        providerOptions: { usage: true },
      }),
    )
    const xai = XAI.model(
      packageInput("grok-4", {
        ...settings,
        providerOptions: { reasoningEffort: "high" },
      }),
    )

    for (const selected of [openrouter, xai]) {
      expect(selected.route.endpoint.baseURL).toBe(settings.baseURL)
      expect(selected.route.defaults.headers).toEqual(settings.headers)
      expect(selected.route.defaults.http?.body).toEqual(settings.body)
      expect(selected.route.defaults.limits).toEqual(settings.limits)
    }
    expect(openrouter.route.defaults.providerOptions).toEqual({ usage: true })
    expect(xai.route.defaults.providerOptions).toMatchObject({ reasoningEffort: "high", store: false })
  })

  test("maps package settings onto the executable model", () => {
    const selected = model(
      packageInput("gpt-5", {
        apiKey: "fixture",
        baseURL: "https://api.openai.test/v1",
        headers: { "x-application": "opencode" },
        body: { service_tier: "priority" },
        limits: { context: 200_000, output: 64_000 },
        reasoningEffort: "high",
        unrelatedInheritedSetting: true,
      }),
    )

    expect(selected.route.id).toBe("openai-responses")
    expect(selected.route.defaults.headers).toEqual({ "x-application": "opencode" })
    expect(selected.route.defaults.http?.body).toEqual({ service_tier: "priority" })
    expect(selected.route.defaults.limits).toEqual({ context: 200_000, output: 64_000 })
    expect(selected.route.defaults.providerOptions).toEqual({
      store: false,
      reasoningEffort: "high",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    })
  })

  test("lets provider packages interpret resolved credentials", async () => {
    const Anthropic = await import("@opencode-ai/ai/providers/anthropic")
    const Azure = await import("@opencode-ai/ai/providers/azure")
    const Google = await import("@opencode-ai/ai/providers/google")
    const GoogleVertex = await import("@opencode-ai/ai/providers/google-vertex")
    const GoogleVertexChat = await import("@opencode-ai/ai/providers/google-vertex/chat")
    const openai = model({
      id: "gpt-5",
      settings: {},
      credential: { type: "oauth", accessToken: "openai-token" },
      defaults: {},
    })
    const anthropicKey = Anthropic.model({
      id: "claude-sonnet-4-6",
      settings: {},
      credential: { type: "key", value: "anthropic-key" },
      defaults: {},
    })
    const anthropicOAuth = Anthropic.model({
      id: "claude-sonnet-4-6",
      settings: {},
      credential: { type: "oauth", accessToken: "anthropic-token" },
      defaults: {},
    })
    const anthropicEmptyKey = Anthropic.model({
      id: "claude-sonnet-4-6",
      settings: {},
      credential: { type: "key", value: "" },
      defaults: {},
    })
    const azureKey = Azure.model({
      id: "deployment",
      settings: { resourceName: "opencode-test" },
      credential: { type: "key", value: "azure-key" },
      defaults: {},
    })
    const azureOAuth = Azure.model({
      id: "deployment",
      settings: { resourceName: "opencode-test" },
      credential: { type: "oauth", accessToken: "azure-token" },
      defaults: {},
    })
    const googleKey = Google.model({
      id: "gemini-2.5-flash",
      settings: {},
      credential: { type: "key", value: "google-key" },
      defaults: {},
    })
    const googleOAuth = Google.model({
      id: "gemini-2.5-flash",
      settings: {},
      credential: { type: "oauth", accessToken: "google-token" },
      defaults: {},
    })
    const vertexKey = GoogleVertex.model({
      id: "gemini-3.5-flash",
      settings: {},
      credential: { type: "key", value: "vertex-key" },
      defaults: {},
    })
    const vertexOAuth = GoogleVertex.model({
      id: "gemini-3.5-flash",
      settings: { project: "vertex-project" },
      credential: { type: "oauth", accessToken: "vertex-token" },
      defaults: {},
    })
    const vertexChatOAuth = GoogleVertexChat.model({
      id: "deepseek-ai/deepseek-v3.2-maas",
      settings: { apiKey: "configured-key", project: "vertex-project" },
      credential: { type: "oauth", accessToken: "vertex-chat-token" },
      defaults: {},
    })

    expect((await authHeaders(openai)).authorization).toBe("Bearer openai-token")
    const anthropicKeyHeaders = await authHeaders(anthropicKey, { authorization: "Bearer stale" })
    const anthropicOAuthHeaders = await authHeaders(anthropicOAuth, { "x-api-key": "stale" })
    const anthropicEmptyKeyHeaders = await authHeaders(
      anthropicEmptyKey,
      { authorization: "Bearer stale" },
      { ANTHROPIC_API_KEY: "environment-key" },
    )
    const azureKeyHeaders = await authHeaders(azureKey, { authorization: "Bearer stale" })
    const azureOAuthHeaders = await authHeaders(azureOAuth, { "api-key": "stale" })
    const googleKeyHeaders = await authHeaders(googleKey, { authorization: "Bearer stale" })
    const googleOAuthHeaders = await authHeaders(googleOAuth, { "x-goog-api-key": "stale" })
    const vertexKeyHeaders = await authHeaders(vertexKey, { authorization: "Bearer stale" })
    const vertexOAuthHeaders = await authHeaders(vertexOAuth, { "x-goog-api-key": "stale" })
    expect(anthropicKeyHeaders["x-api-key"]).toBe("anthropic-key")
    expect(anthropicKeyHeaders.authorization).toBeUndefined()
    expect(anthropicOAuthHeaders.authorization).toBe("Bearer anthropic-token")
    expect(anthropicOAuthHeaders["x-api-key"]).toBeUndefined()
    expect(anthropicEmptyKeyHeaders["x-api-key"]).toBe("environment-key")
    expect(anthropicEmptyKeyHeaders.authorization).toBeUndefined()
    expect(azureKeyHeaders["api-key"]).toBe("azure-key")
    expect(azureKeyHeaders.authorization).toBeUndefined()
    expect(azureOAuthHeaders.authorization).toBe("Bearer azure-token")
    expect(azureOAuthHeaders["api-key"]).toBeUndefined()
    expect(googleKeyHeaders["x-goog-api-key"]).toBe("google-key")
    expect(googleKeyHeaders.authorization).toBeUndefined()
    expect(googleOAuthHeaders.authorization).toBe("Bearer google-token")
    expect(googleOAuthHeaders["x-goog-api-key"]).toBeUndefined()
    expect(vertexKeyHeaders["x-goog-api-key"]).toBe("vertex-key")
    expect(vertexKeyHeaders.authorization).toBeUndefined()
    expect(vertexOAuthHeaders.authorization).toBe("Bearer vertex-token")
    expect(vertexOAuthHeaders["x-goog-api-key"]).toBeUndefined()
    expect((await authHeaders(vertexChatOAuth)).authorization).toBe("Bearer vertex-chat-token")
  })

  test("maps OpenAI-compatible Responses settings onto the executable model", async () => {
    const OpenAICompatibleResponses = await import("@opencode-ai/ai/providers/openai-compatible/responses")
    const selected = OpenAICompatibleResponses.model(
      packageInput("custom-model", {
        apiKey: "fixture",
        baseURL: "https://responses.example.test/v1",
        provider: "example",
        headers: { "x-application": "opencode" },
        body: { service_tier: "priority" },
        limits: { context: 200_000, output: 64_000 },
        providerOptions: { reasoningEffort: "low", store: true },
      }),
    )

    expect(String(selected.provider)).toBe("example")
    expect(selected.route.id).toBe("openai-compatible-responses")
    expect(selected.route.endpoint).toMatchObject({
      baseURL: "https://responses.example.test/v1",
      path: "/responses",
    })
    expect(selected.route.defaults.headers).toEqual({ "x-application": "opencode" })
    expect(selected.route.defaults.http?.body).toEqual({ service_tier: "priority" })
    expect(selected.route.defaults.limits).toEqual({ context: 200_000, output: 64_000 })
    expect(selected.route.defaults.providerOptions).toEqual({ reasoningEffort: "low", store: true })
  })

  test("maps Anthropic-compatible settings onto the executable model", async () => {
    const AnthropicCompatible = await import("@opencode-ai/ai/providers/anthropic-compatible")
    const selected = AnthropicCompatible.model(
      packageInput("compatible-model", {
        apiKey: "fixture",
        baseURL: "https://messages.example.test/v1",
        provider: "example",
        headers: { "x-application": "opencode" },
        body: { metadata: { user_id: "user_1" } },
        limits: { context: 200_000, output: 64_000 },
        providerOptions: { effort: "low" },
      }),
    )

    expect(String(selected.provider)).toBe("example")
    expect(selected.route.id).toBe("anthropic-messages")
    expect(selected.route.endpoint).toMatchObject({
      baseURL: "https://messages.example.test/v1",
      path: "/messages",
    })
    expect(selected.route.defaults.headers).toEqual({ "x-application": "opencode" })
    expect(selected.route.defaults.http?.body).toEqual({ metadata: { user_id: "user_1" } })
    expect(selected.route.defaults.limits).toEqual({ context: 200_000, output: 64_000 })
    expect(selected.route.defaults.providerOptions).toEqual({ effort: "low" })
  })

  test("maps Anthropic provider options onto the executable model", async () => {
    const Anthropic = await import("@opencode-ai/ai/providers/anthropic")
    const selected = Anthropic.model(
      packageInput("claude-sonnet-4-6", {
        apiKey: "fixture",
        providerOptions: { thinking: { type: "adaptive" } },
      }),
    )

    expect(selected.route.defaults.providerOptions).toEqual({ thinking: { type: "adaptive" } })
  })

  test("requires an Anthropic-compatible base URL at runtime", async () => {
    const AnthropicCompatible = await import("@opencode-ai/ai/providers/anthropic-compatible")
    expect(() =>
      Reflect.apply(AnthropicCompatible.model, undefined, [packageInput("compatible-model", { apiKey: "fixture" })]),
    ).toThrow("Anthropic-compatible providers require a baseURL")
  })

  test("rejects conflicting Anthropic-compatible auth settings at runtime", async () => {
    const Anthropic = await import("@opencode-ai/ai/providers/anthropic")
    const AnthropicCompatible = await import("@opencode-ai/ai/providers/anthropic-compatible")
    expect(() =>
      Reflect.apply(AnthropicCompatible.model, undefined, [
        packageInput("compatible-model", {
          apiKey: "fixture",
          authToken: "token",
          baseURL: "https://messages.example.test/v1",
        }),
      ]),
    ).toThrow("Anthropic-compatible apiKey cannot be combined with authToken")
    expect(() =>
      Reflect.apply(Anthropic.model, undefined, [
        packageInput("claude-sonnet-4-6", { apiKey: "fixture", authToken: "token" }),
      ]),
    ).toThrow("Anthropic apiKey cannot be combined with authToken")
  })

  test("maps legacy OpenAI organization and project settings to headers", () => {
    const selected = model(
      packageInput("gpt-5", {
        apiKey: "fixture",
        organization: "org_123",
        project: "proj_123",
      }),
    )

    expect(selected.route.defaults.headers).toMatchObject({
      "OpenAI-Organization": "org_123",
      "OpenAI-Project": "proj_123",
    })
  })

  test("selects Azure API entrypoints with the same model contract", async () => {
    const Azure = await import("@opencode-ai/ai/providers/azure")
    const AzureChat = await import("@opencode-ai/ai/providers/azure/chat")
    const AzureResponses = await import("@opencode-ai/ai/providers/azure/responses")
    const settings = {
      apiKey: "fixture",
      resourceName: "opencode-test",
      headers: { "x-application": "opencode" },
      body: { service_tier: "priority" },
      limits: { context: 200_000, output: 64_000 },
    }

    const responses = AzureResponses.model(packageInput("deployment", settings))
    const chat = AzureChat.model(packageInput("deployment", settings))

    expect(Azure.model(packageInput("deployment", settings)).route.id).toBe("azure-openai-responses")
    expect(responses.route.id).toBe("azure-openai-responses")
    expect(responses.route.endpoint.baseURL).toBe("https://opencode-test.openai.azure.com/openai/v1")
    expect(responses.route.defaults.headers).toEqual({ "x-application": "opencode" })
    expect(responses.route.defaults.http?.body).toEqual({ service_tier: "priority" })
    expect(responses.route.defaults.limits).toEqual({ context: 200_000, output: 64_000 })
    expect(chat.route.id).toBe("azure-openai-chat")
  })

  test("constructs Azure deployment URLs and preserves custom gateway URLs", async () => {
    const Azure = await import("@opencode-ai/ai/providers/azure")
    const deployment = Azure.model(
      packageInput("custom-deployment", {
        apiKey: "fixture",
        resourceName: "opencode-test",
        apiVersion: "2025-01-01-preview",
        useDeploymentBasedUrls: true,
      }),
    )
    const gateway = Azure.model(
      packageInput("gateway-model", {
        apiKey: "fixture",
        baseURL: "https://gateway.example/azure/",
      }),
    )

    expect(deployment.route.endpoint).toMatchObject({
      baseURL: "https://opencode-test.openai.azure.com/openai/deployments/custom-deployment",
      query: { "api-version": "2025-01-01-preview" },
    })
    expect(gateway.route.endpoint.baseURL).toBe("https://gateway.example/azure")
    expect(gateway.route.endpoint.query).toBeUndefined()
  })

  test("maps Google package settings onto the Gemini model", async () => {
    const Google = await import("@opencode-ai/ai/providers/google")
    const selected = Google.model(
      packageInput("gemini-2.5-flash", {
        apiKey: "fixture",
        baseURL: "https://generativelanguage.test/v1beta",
        headers: { "x-application": "opencode" },
        body: { safetySettings: [] },
        limits: { context: 1_000_000, output: 65_536 },
        providerOptions: { thinkingConfig: { thinkingBudget: 1_024 } },
      }),
    )

    expect(selected.route.id).toBe("gemini")
    expect(selected.route.endpoint.baseURL).toBe("https://generativelanguage.test/v1beta")
    expect(selected.route.defaults.headers).toEqual({ "x-application": "opencode" })
    expect(selected.route.defaults.http?.body).toEqual({ safetySettings: [] })
    expect(selected.route.defaults.limits).toEqual({ context: 1_000_000, output: 65_536 })
    expect(selected.route.defaults.providerOptions).toEqual({ thinkingConfig: { thinkingBudget: 1_024 } })
  })

  test("selects Vertex entrypoints with the same model contract", async () => {
    const GoogleVertex = await import("@opencode-ai/ai/providers/google-vertex")
    const GoogleVertexGemini = await import("@opencode-ai/ai/providers/google-vertex/gemini")
    const GoogleVertexChat = await import("@opencode-ai/ai/providers/google-vertex/chat")
    const GoogleVertexResponses = await import("@opencode-ai/ai/providers/google-vertex/responses")
    const GoogleVertexMessages = await import("@opencode-ai/ai/providers/google-vertex/messages")
    const gemini = GoogleVertex.model(
      packageInput("gemini-3.5-flash", {
        apiKey: "fixture",
        headers: { "x-application": "opencode" },
        body: { safetySettings: [] },
        limits: { context: 1_000_000, output: 65_536 },
      }),
    )
    const messages = GoogleVertexMessages.model(
      packageInput("claude-sonnet-4-6", {
        accessToken: "fixture",
        location: "global",
        project: "vertex-project",
      }),
    )
    const chat = GoogleVertexChat.model(
      packageInput("deepseek-ai/deepseek-v3.2-maas", {
        accessToken: "fixture",
        location: "global",
        project: "vertex-project",
      }),
    )
    const responses = GoogleVertexResponses.model(
      packageInput("xai/grok-4.20-reasoning", {
        accessToken: "fixture",
        location: "global",
        project: "vertex-project",
      }),
    )

    expect(GoogleVertexGemini.model).toBe(GoogleVertex.model)
    expect(gemini.route.id).toBe("google-vertex-gemini")
    expect(gemini.route.protocol).toBe("gemini")
    expect(gemini.route.endpoint.baseURL).toBe("https://aiplatform.googleapis.com/v1/publishers/google")
    expect(gemini.route.defaults.headers).toEqual({ "x-application": "opencode" })
    expect(gemini.route.defaults.http?.body).toEqual({ safetySettings: [] })
    expect(gemini.route.defaults.limits).toEqual({ context: 1_000_000, output: 65_536 })
    expect(
      GoogleVertex.model(
        packageInput("gemini-3.5-flash", {
          accessToken: "fixture",
          location: "eu",
          project: "vertex-project",
        }),
      ).route.endpoint.baseURL,
    ).toBe("https://aiplatform.eu.rep.googleapis.com/v1beta1/projects/vertex-project/locations/eu/publishers/google")
    expect(messages.route.id).toBe("google-vertex-messages")
    expect(messages.route.protocol).toBe("anthropic-messages")
    expect(messages.route.endpoint.baseURL).toBe(
      "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/anthropic/models",
    )
    expect(chat.route.id).toBe("google-vertex-chat")
    expect(chat.route.protocol).toBe("openai-chat")
    expect(chat.route.endpoint).toMatchObject({
      baseURL: "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/endpoints/openapi",
      path: "/chat/completions",
    })
    expect(responses.route.id).toBe("google-vertex-responses")
    expect(responses.route.protocol).toBe("open-responses")
    expect(responses.route.endpoint).toMatchObject({
      baseURL: "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/endpoints/openapi",
      path: "/responses",
    })
    expect(responses.route.defaults.providerOptions).toEqual({ store: false })
  })

  test("rejects conflicting Vertex auth settings at runtime", async () => {
    const GoogleVertex = await import("@opencode-ai/ai/providers/google-vertex")
    const GoogleVertexChat = await import("@opencode-ai/ai/providers/google-vertex/chat")
    const GoogleVertexMessages = await import("@opencode-ai/ai/providers/google-vertex/messages")
    const GoogleVertexResponses = await import("@opencode-ai/ai/providers/google-vertex/responses")
    const Providers = await import("@opencode-ai/ai/providers")
    expect(() =>
      Reflect.apply(GoogleVertex.model, undefined, [
        packageInput("gemini-3.5-flash", {
          accessToken: "token",
          apiKey: "fixture",
          project: "vertex-project",
        }),
      ]),
    ).toThrow("Google Vertex apiKey cannot be combined with accessToken or auth")
    const configured = Reflect.apply(GoogleVertex.configure, undefined, [
      { accessToken: "token", auth: {}, project: "vertex-project" },
    ])
    expect(() => configured.model("gemini-3.5-flash")).toThrow("Google Vertex accessToken cannot be combined with auth")
    expect(() =>
      Reflect.apply(GoogleVertexMessages.model, undefined, [
        packageInput("claude-sonnet-4-6", { apiKey: "fixture", project: "vertex-project" }),
      ]),
    ).toThrow("Google Vertex Messages does not support API keys")
    expect(() =>
      Reflect.apply(Providers.GoogleVertexMessages.configure, undefined, [
        { apiKey: "fixture", project: "vertex-project" },
      ]),
    ).toThrow("Google Vertex Messages does not support API keys")
    expect(() =>
      Reflect.apply(GoogleVertexChat.model, undefined, [
        packageInput("deepseek-ai/deepseek-v3.2-maas", { apiKey: "fixture", project: "vertex-project" }),
      ]),
    ).toThrow("Google Vertex Chat does not support API keys")
    expect(() =>
      Reflect.apply(Providers.GoogleVertexChat.configure, undefined, [
        { apiKey: "fixture", project: "vertex-project" },
      ]),
    ).toThrow("Google Vertex Chat does not support API keys")
    expect(() =>
      Reflect.apply(GoogleVertexResponses.model, undefined, [
        packageInput("xai/grok-4.20-reasoning", { apiKey: "fixture", project: "vertex-project" }),
      ]),
    ).toThrow("Google Vertex Responses does not support API keys")
    expect(() =>
      Reflect.apply(Providers.GoogleVertexResponses.configure, undefined, [
        { apiKey: "fixture", project: "vertex-project" },
      ]),
    ).toThrow("Google Vertex Responses does not support API keys")
  })
})
