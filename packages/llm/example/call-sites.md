# LLM Call Site Sketches

Scratchpad for examples first, abstractions second. Current direction: routes
execute, provider facades organize configured route sets, and models carry route
values directly.

## Conversation Summary

Kit and Aidan want provider-specific LLM behavior to move out of opencode's AI
SDK transform path and into `packages/llm` where possible. The goal is not a big
generic transform layer; the goal is small composable route definitions backed by
recorded golden tests.

Things to keep testing against:

- Cache placement: `cache: "auto"`, manual cache breakpoints, provider cache usage.
- Images: golden image tests for providers/protocols that claim image support.
- Reasoning: canonical reasoning parts/events versus provider-native knobs.
- Auth: bearer, custom headers, multiple credentials, query auth, SigV4, OAuth, no auth.
- OpenAI-compatible providers: DeepSeek, Together, Groq, Alibaba/DashScope, custom routers.
- Provider switching: stale signatures, encrypted reasoning, provider metadata, incompatible parts.
- Error quality: typed errors instead of generic SDK/server failures.

## Final Guide: Routes Execute, Providers Organize

Do not introduce a first-class `Deployment` abstraction unless it gains real
semantics. Provider facades are ergonomic configured route groups, not execution
registries. The executable/composable thing is still a route. Do not make route
construction publish to a global registry; models should carry their route value
directly.

Keep durable identity separate from runtime capability:

- Durable identity is small serializable data like `{ providerID, modelID }` for
  config, sessions, logs, and catalogs.
- Runtime capability is a `Model` with a route value, protocol, transport, auth,
  and defaults. It is allowed to contain functions and schemas.
- If persisted identity needs to become executable, resolve it through an app
  boundary first. Do not make `LLMRequest` recover behavior from a global route
  side table.

Keep unconfigured behavior values as values, not factories. A transport like
`HttpTransport.sseJson` should be a reusable immutable value. Use a function only
when the caller supplies options or when construction needs fresh state.

Use constants to remove repetition before inventing abstractions. Provider ids
are branded once per provider facade and reused across routes; a plain exported
object is enough for the provider-facing API unless a helper earns its keep by
removing repeated route projection.

Expose default configured provider instances, and put provider-specific setup on
`.configure(...)`. Model selectors stay pure: `model(id)`, `responses(id)`,
`chat(id)`, etc. Endpoint/auth/resource/api-version configuration happens before
model selection, not as a second argument to model selection.

Use provider/product facades consistently:

- One coherent provider/product config surface gets one top-level facade.
- APIs/model kinds that share that config are methods on the facade.
- Different products with different required config get separate top-level
  facades, not a shared namespace with unrelated children.
- Default facades are exposed only when concrete defaults or lazy env/credential
  defaults make the facade valid.

Examples:

```ts
OpenAI.responses("gpt-4o")
OpenAI.chat("gpt-4o")
OpenAI.responsesWebSocket("gpt-4o")

Azure.configure({ resourceName, apiKey }).responses("my-deployment")
AmazonBedrock.configure({ region, credentials }).model("anthropic.claude-3-5-sonnet-20241022-v2:0")

CloudflareAIGateway.configure({ accountId, gatewayId, gatewayApiKey, apiKey }).model("openai/gpt-4o")
CloudflareWorkersAI.configure({ accountId, apiKey }).model("@cf/meta/llama-3.1-8b-instruct")

OpenAICompatible.configure({
  provider: "custom",
  baseURL: "https://custom.example/v1",
  auth: Auth.bearer(apiKey),
}).model("custom-model")
```

Standardize the provider facade contract before abstracting construction. A
plain object is enough at first; add a helper only if repeated route projection
starts hiding the real provider-specific config.

`Route.with(...)` patch semantics should be boring and explicit:

- Omitted fields inherit from the original route.
- `endpoint` patches merge with the existing endpoint, so overriding `baseURL`
  keeps the existing `path`.
- `endpoint.query` merges by default; later values win.
- `auth` replaces.
- `headers` merge by default; undefined values are omitted.
- `id` is optional in patches. Route ids are diagnostic/provider API labels, not
  global runtime registry keys.

1. **Route**
   - route id
   - provider id
   - protocol
   - body schema
   - body builder
   - stream event schema
   - parser/state machine
   - transport
     - method / IO shape
     - framing
     - request preparation
     - constants when unconfigured; functions only when configured
   - endpoint
     - base URL
     - static path
     - body/model-derived path
     - query params
   - auth
     - bearer
     - custom header
     - multiple credentials
     - SigV4
     - none
   - defaults
     - headers
     - generation defaults
     - provider options
     - limits
2. **Provider Facade**
   - default configured provider instance
   - provider-specific `.configure(...)`
   - plain object/function facade over one or more routes
   - top-level export only when it represents one coherent config surface
   - no passive `Provider.make(...)` wrapper unless it gains runtime behavior
3. **Model Selector**
   - route/provider-owned selector
   - accepts model id only
   - returns executable models
   - does not accept endpoint/auth/deployment overrides
4. **Model**
   - model id
   - route value
   - provider id
   - configured route value at selection time
5. **LLM Request**
   - model
   - messages/tools
   - generation/cache/reasoning/response-format options
   - request-level HTTP overlays for per-request headers/query/body additions,
     not provider endpoint/auth reconfiguration
6. **Compile**
   - read route from model
   - merge route defaults and request overrides
   - build final URL from route endpoint
   - apply auth from the configured route
   - build body with protocol
   - execute with transport and parse with protocol

## Provider Facade Shape

The provider abstraction is a facade over configured routes, not the runtime
execution mechanism:

```ts
type ProviderFacade<APIs, Config> = {
  readonly id: ProviderID
  readonly model: (id: string) => Model
  readonly configure: (input?: Config) => ProviderFacade<APIs, Config>
} & APIs
```

Manual construction is fine and should be the default until duplication earns a
helper:

```ts
export const OpenAI = {
  id: openAIProvider,
  model: openAIResponses.model,
  responses: openAIResponses.model,
  chat: openAIChat.model,
  configure: configureOpenAI,
} satisfies ProviderFacade<
  {
    responses: (id: string) => Model
    chat: (id: string) => Model
  },
  OpenAIConfig
>
```

If several providers repeat the same projection from route values to model
methods, the helper can stay deliberately tiny:

```ts
const configureOpenAI = (input: OpenAIConfig = {}) =>
  Provider.define({
    id: openAIProvider,
    routes: {
      responses: openAIResponses.with(openAIConfig(input)),
      chat: openAIChat.with(openAIConfig(input)),
    },
    default: "responses",
    configure: configureOpenAI,
  })

export const OpenAI = configureOpenAI()
```

`Provider.define(...)` would only project route methods and preserve types:

```ts
OpenAI.model("gpt-4o")
OpenAI.responses("gpt-4o")
OpenAI.chat("gpt-4o")
OpenAI.configure({ apiKey }).responses("gpt-4o")
```

It must not register routes, select routes dynamically, or participate in
execution. Execution still reads the route value carried by the model.

## Ideal Call Sites

Define concrete routes for a native provider, then project them through a
provider facade:

```ts
const openAIProvider = ProviderID.make("openai")

const openAIResponses = Route.make({
  id: "openai-responses",
  provider: openAIProvider,
  protocol: OpenAIResponses.protocol,
  transport: HttpTransport.sseJson,
  endpoint: {
    baseURL: "https://api.openai.com/v1",
    path: "/responses",
  },
  auth: Auth.envBearer("OPENAI_API_KEY"),
})

const openAIChat = Route.make({
  id: "openai-chat",
  provider: openAIProvider,
  protocol: OpenAIChat.protocol,
  transport: HttpTransport.sseJson,
  endpoint: {
    baseURL: "https://api.openai.com/v1",
    path: "/chat/completions",
  },
  auth: Auth.envBearer("OPENAI_API_KEY"),
})

const openAIResponsesWebSocket = openAIResponses.with({
  id: "openai-responses-websocket",
  transport: WebSocketTransport.json,
})

const openAIConfig = (input: OpenAIConfig) => ({
  endpoint: input.endpoint,
  auth: input.auth ?? (input.apiKey ? Auth.bearer(input.apiKey) : undefined),
  headers: {
    "OpenAI-Organization": input.organization,
    "OpenAI-Project": input.project,
  },
})

const configureOpenAI = (input: OpenAIConfig = {}) => {
  const responses = openAIResponses.with(openAIConfig(input))
  const responsesWebSocket = openAIResponsesWebSocket.with(openAIConfig(input))
  const chat = openAIChat.with(openAIConfig(input))

  return {
    id: openAIProvider,
    responses: responses.model,
    responsesWebSocket: responsesWebSocket.model,
    chat: chat.model,
    model: responses.model,
    configure: configureOpenAI,
  }
}

export const OpenAI = configureOpenAI()
```

Specialize it functionally for concrete providers:

```ts
const deepSeekProvider = ProviderID.make("deepseek")

const deepseekChat = openAIChat.with({
  id: "deepseek-chat",
  provider: deepSeekProvider,
  endpoint: {
    baseURL: "https://api.deepseek.com/v1",
  },
  auth: Auth.envBearer("DEEPSEEK_API_KEY"),
})

const configureDeepSeek = (input: OpenAICompatibleConfig = {}) => {
  const route = deepseekChat.with({
    endpoint: input.endpoint,
    auth: input.auth ?? (input.apiKey ? Auth.bearer(input.apiKey) : undefined),
  })

  return {
    id: deepSeekProvider,
    model: route.model,
    configure: configureDeepSeek,
  }
}

export const DeepSeek = {
  id: deepSeekProvider,
  model: deepseekChat.model,
  configure: configureDeepSeek,
}
```

Provider-specific configuration happens before model selection:

```ts
const deepseek = DeepSeek.configure({
  endpoint: {
    baseURL: "https://proxy.example.com/v1",
  },
  auth: Auth.bearer(apiKey),
})

const model = deepseek.model("deepseek-chat")
```

Final request call site stays boring:

```ts
const response =
  yield *
  LLM.generate(
    LLM.request({
      model: DeepSeek.model("deepseek-chat"),
      prompt: "Hello.",
    }),
  )
```

HTTP versus WebSocket is represented as named route selectors, not as model or
request overrides. Same protocol, different transport, different route:

```ts
OpenAI.responses("gpt-4o")
OpenAI.responsesWebSocket("gpt-4o")
```

The client should not require a different public layer just because a selected
route uses WebSocket. Use one `LLMClient.layer` with HTTP and WebSocket runtime
capabilities available; routes that do not need WebSocket simply never touch it.
If a WebSocket route is selected in an environment without WebSocket support,
fail with a typed transport configuration error.

Azure is a route specialization with auth/path/default changes plus input
mapping. The public API configures the Azure resource once, then selects
deployment ids with pure model selectors:

```ts
const azureProvider = ProviderID.make("azure")

const azureResponses = openAIResponses.with({
  id: "azure-openai-responses",
  provider: azureProvider,
  auth: Auth.envHeader("api-key", "AZURE_OPENAI_API_KEY"),
})

const configureAzure = (input: AzureConfig = {}) => {
  const route = azureResponses.with({
    endpoint: {
      baseURL:
        input.baseURL ??
        Endpoint.envBaseURL(
          "AZURE_RESOURCE_NAME",
          (resourceName) => `https://${resourceName}.openai.azure.com/openai/v1`,
        ),
      query: { "api-version": input.apiVersion ?? "v1" },
    },
    auth: input.apiKey ? Auth.header("api-key", input.apiKey) : Auth.envHeader("api-key", "AZURE_OPENAI_API_KEY"),
  })

  return {
    id: azureProvider,
    model: route.model,
    responses: route.model,
    configure: configureAzure,
  }
}

export const Azure = configureAzure()

const azure = Azure.configure({
  resourceName: "my-resource",
  apiVersion: "v1",
})

const model = azure.responses("my-deployment")
```

Default provider facades are only valid when required configuration has a lazy
default source. `Azure.responses("my-deployment")` can be valid if endpoint
resolution reads `AZURE_RESOURCE_NAME` lazily and fails with a typed
configuration error when missing. If a provider has no sensible lazy default,
do not expose a default model selector; expose only a configured entrypoint.

Cloudflare AI Gateway and Workers AI are separate product facades because their
configuration surfaces differ. Do not make a root `Cloudflare.configure(...)`
pretend there is one coherent Cloudflare provider configuration:

```ts
const cloudflareProvider = ProviderID.make("cloudflare-ai-gateway")

const cloudflareOpenAIChat = openAIChat.with({
  id: "cloudflare-ai-gateway-openai-chat",
  provider: cloudflareProvider,
  auth: Auth.bearerHeader("cf-aig-authorization").andThen(Auth.bearer()),
})

const configureCloudflareAIGateway = (input: CloudflareAIGatewayConfig) => {
  const route = cloudflareOpenAIChat.with({
    endpoint: {
      baseURL: `https://gateway.ai.cloudflare.com/v1/${input.accountId}/${input.gatewayId}/openai`,
    },
    auth: Auth.bearerHeader("cf-aig-authorization", input.gatewayApiKey).andThen(Auth.bearer(input.apiKey)),
  })

  return {
    id: cloudflareProvider,
    model: (modelID: string) => route.model({ id: modelID }),
    configure: configureCloudflareAIGateway,
  }
}

export const CloudflareAIGateway = {
  id: cloudflareProvider,
  configure: configureCloudflareAIGateway,
}

const gateway = CloudflareAIGateway.configure({
  accountId: "account",
  gatewayId: "gateway",
  gatewayApiKey,
  apiKey,
})

const model = gateway.model("openai/gpt-4o")
```

If a Cloudflare product gains a full lazy env default, it can expose a direct
selector too. Until then, omitting `CloudflareAIGateway.model(...)` makes missing
account/gateway configuration unrepresentable.

opencode's dynamic runtime should construct executable models at its app
boundary instead of exposing a giant unstructured public model constructor or a
generic dynamic resolver:

```ts
const model =
  providerID === "azure"
    ? Azure.configure(resolvedAzureConfig).responses(apiModelID)
    : endpoint.websocket
      ? OpenAI.responsesWebSocket(apiModelID)
      : OpenAI.responses(apiModelID)
```

That boundary can branch on durable config/catalog metadata and call typed
provider APIs directly. Transport selection belongs there too: map metadata like
`endpoint.websocket` to `OpenAI.responsesWebSocket(apiModelID)`; otherwise use
the normal `OpenAI.responses(apiModelID)` route. The client runtime only executes
the route carried by the model.

## Competitive Shape

This follows the strongest parts of adjacent libraries:

- AI SDK: configured provider instances expose provider-specific model methods.
- Effect AI: executable models carry provider requirements and can be resolved by
  an app boundary.
- LiteLLM/opencode config: dynamic `providerID/modelID` branching belongs at the
  app boundary, not in the typed public provider API or a global runtime
  resolver.
- LangChain/LlamaIndex: constructor-style config plus model id is convenient,
  but we avoid making model selection also configure endpoint/auth.

The chosen split is:

```txt
Route = execution mechanics
Provider facade = configured route group
Model = selected executable model carrying route value
App boundary = explicit durable-config -> typed-provider call
```

## What This Removes

- No `Provider.make(...)` as a core abstraction.
- No `Provider.make(...)` wrapper just to bind an id to model functions. Use a
  branded provider id constant and a plain exported provider facade.
- No `Deployment.define(...)` unless future examples force it.
- No global route registry as the normal execution path.
- No import side effects required before a model can execute.
- No duplicate `provider.id` object when selected models already carry provider
  id.
- No `model(id, overrides)` escape hatch. Model selection takes the model id;
  endpoint/auth/deployment customization happens by configuring the route first.
- No transport override on model/request. HTTP SSE versus WebSocket is a named
  route selector such as `responses` versus `responsesWebSocket`.
- No separate public `LLMClient.layerWithWebSocket`. The runtime should expose one
  client layer with the available transport capabilities.
- No executable `ModelRef`. The executable handle is `Model`; durable model
  identity stays separate and cannot execute on its own.

## Implementation Todo

- [x] Replace the current executable `ModelRef` with `Model`.
- [x] Change `Model.route` to carry a route value, not a `RouteID` string.
- [ ] Keep a separate durable model identity type for persisted/session/catalog
      data, likely `{ providerID, modelID }`, and make it clear that it cannot
      execute without resolver context.
- [x] Change route model selectors so `route.model(id)` returns an executable
      model with the route value attached, not a globally registered route id.
- [x] Remove the standalone `Route.model(route, defaults, mapInput)` helper;
      configured route instances own model selection.
- [x] Remove endpoint/auth escape hatches from route model selection; callers must
      configure endpoint/auth through `route.with(...)` or provider facades before
      calling `.model(...)`.
- [x] Remove request-shaping defaults from `Model`; selected models now carry only
      id, provider, and configured route while defaults live on routes or requests.
- [x] Rework `LLMClient.prepare` / `stream` / `generate` to read
      `request.model.route` directly instead of calling `registeredRoute(...)`.
- [x] Remove `Route.make(...)` global registration from the normal execution
      path; keep route ids only as diagnostics/provider API labels.
- [x] Model endpoint as `{ baseURL, path, query }` on routes, then remove the
      current split where host/query live on the model and path lives in route
      transport setup.
- [x] Define `Route.with(...)` with explicit patch semantics for endpoint merge,
      query merge, header merge, auth replacement, and optional diagnostic id.
- [x] Make unconfigured transports reusable constants such as
      `HttpTransport.sseJson`; keep transport functions only for configured/fresh
      state construction.
- [x] Collapse the public WebSocket runtime split so one `LLMClient.layer`
      exposes available transport capabilities and selected routes fail with typed
      transport config errors when a required capability is missing.
- [x] Convert OpenAI provider APIs to provider-facade shape:
      `OpenAI.configure(config).responses(id)`, `.chat(id)`, and
      `.responsesWebSocket(id)`.
- [x] Convert Azure to a configured facade where resource/base URL/api version
      setup happens before selecting deployment ids.
- [x] Split Cloudflare products into separate facades such as
      `CloudflareAIGateway` and `CloudflareWorkersAI`; do not expose a shared root
      config surface unless one product actually exists.
- [x] Migrate remaining built-in provider facades one at a time so configuration
      happens before model selection and selectors accept only ids:
      xAI, GitHub Copilot, OpenRouter, OpenAI-compatible families, Anthropic,
      Google/Gemini, and Amazon Bedrock now use configured facades such as
      `Provider.configure(options).model(id)` with named selectors where needed.
- [ ] Decide whether a tiny `Provider.define(...)` helper is warranted after two
      or three provider conversions; start with plain objects if duplication is not
      yet painful.
- [x] Update `packages/opencode/src/session/llm/native-request.ts` to construct
      executable models at the session boundary with explicit provider facade
      calls, mapping catalog metadata such as `endpoint.websocket` to the correct
      named route selector.
- [ ] Update tests so direct route/provider tests assert route values are carried
      by executable models, and opencode/native tests assert boundary-based route
      selection.
- [ ] Remove compatibility exports or stale docs only after internal call sites
      are migrated; do not keep duplicate constructor paths without an external
      compatibility need.

## Open Questions

- Default facades with required setup: should providers like Azure and Bedrock
  expose default model selectors only when all required setup has lazy env or
  credential-chain defaults? If not, omit the default selector so missing config
  is impossible at the type/API level.
- Lazy endpoint/auth values: should `Endpoint.envBaseURL(...)` and env-backed
  auth produce typed configuration/authentication errors at compile/prepare time
  or only when executing the transport?
- `Route.with(...)` clearing semantics: endpoint/query/header patches merge by
  default, but what is the explicit way to remove an inherited value?
- Provider facade helper: keep plain objects until duplication hurts, or add a
  tiny `Provider.define(...)` immediately to enforce shape and method projection?
- Auth shape: should auth stay as today's composable `Auth`, or split into an
  auth placement/strategy and credential sources?
- Naming: is `baseURL` still the right endpoint field name, or should it be
  `origin` / `urlPrefix` to clarify that route `path` is appended?
