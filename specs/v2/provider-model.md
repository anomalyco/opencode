# Provider and Model Catalog

## Provider Schema

```ts
export const ID = Schema.String.pipe(
  Schema.brand("ProviderV2.ID"),
  withStatics((schema) => ({
    opencode: schema.make("opencode"),
    anthropic: schema.make("anthropic"),
    openai: schema.make("openai"),
    google: schema.make("google"),
    googleVertex: schema.make("google-vertex"),
    githubCopilot: schema.make("github-copilot"),
    amazonBedrock: schema.make("amazon-bedrock"),
    azure: schema.make("azure"),
    openrouter: schema.make("openrouter"),
    mistral: schema.make("mistral"),
    gitlab: schema.make("gitlab"),
  })),
)
export type ID = typeof ID.Type

const OpenAIResponses = Schema.Struct({
  type: Schema.Literal("openai/responses"),
  url: Schema.String,
  websocket: Schema.optional(Schema.Boolean),
})

const OpenAICompletions = Schema.Struct({
  type: Schema.Literal("openai/completions"),
  url: Schema.String,
  reasoning: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("reasoning_content"),
    }),
    Schema.Struct({
      type: Schema.Literal("reasoning_details"),
    }),
  ]).pipe(Schema.optional),
})
export type OpenAICompletions = typeof OpenAICompletions.Type

const AISDK = Schema.Struct({
  type: Schema.Literal("aisdk"),
  package: Schema.String,
  url: Schema.String.pipe(Schema.optional),
})

const AnthropicMessages = Schema.Struct({
  type: Schema.Literal("anthropic/messages"),
  url: Schema.String,
})

const UnknownEndpoint = Schema.Struct({
  type: Schema.Literal("unknown"),
})

export const Endpoint = Schema.Union([
  UnknownEndpoint,
  OpenAIResponses,
  OpenAICompletions,
  AnthropicMessages,
  AISDK,
]).pipe(Schema.toTaggedUnion("type"))
export type Endpoint = typeof Endpoint.Type

export const Options = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.Record(Schema.String, Schema.Any),
  aisdk: Schema.Struct({
    provider: Schema.Record(Schema.String, Schema.Any),
    request: Schema.Record(Schema.String, Schema.Any),
  }),
})
export type Options = typeof Options.Type

export class Info extends Schema.Class<Info>("ProviderV2.Info")({
  id: ID,
  name: Schema.String,
  enabled: Schema.Union([
    Schema.Literal(false),
    Schema.Struct({ via: Schema.Literal("env"), name: Schema.String }),
    Schema.Struct({ via: Schema.Literal("account"), service: Schema.String }),
    Schema.Struct({ via: Schema.Literal("custom"), data: Schema.Record(Schema.String, Schema.Any) }),
  ]),
  env: Schema.String.pipe(Schema.Array),
  endpoint: Endpoint,
  options: Options,
}) {
  static empty(providerID: ID) {
    return new Info({
      id: providerID,
      name: providerID,
      enabled: false,
      env: [],
      endpoint: {
        type: "unknown",
      },
      options: {
        headers: {},
        body: {},
        aisdk: { provider: {}, request: {} },
      },
    })
  }
}

export class NotFound extends Schema.TaggedErrorClass<NotFound>("ProviderV2.NotFound")("ProviderV2.NotFound", {
  providerID: ID,
}) {}
```

## Model Schema

```ts
export const ID = Schema.String.pipe(Schema.brand("ModelV2.ID"))
export type ID = typeof ID.Type

export const VariantID = Schema.String.pipe(Schema.brand("VariantID"))
export type VariantID = typeof VariantID.Type

export const Family = Schema.String.pipe(Schema.brand("Family"))
export type Family = typeof Family.Type

export const Capabilities = Schema.Struct({
  tools: Schema.Boolean,
  input: Schema.String.pipe(Schema.Array),
  output: Schema.String.pipe(Schema.Array),
})
export type Capabilities = typeof Capabilities.Type

export const Variant = Schema.Struct({
  id: VariantID,
  ...ProviderV2.Options.fields,
})
export type Variant = typeof Variant.Type

export const Cost = Schema.Struct({
  tier: Schema.Struct({
    type: Schema.Literal("context"),
    size: Schema.Int,
  }).pipe(Schema.optional),
  input: Schema.Finite,
  output: Schema.Finite,
  cache: Schema.Struct({
    read: Schema.Finite,
    write: Schema.Finite,
  }),
})
export type Cost = typeof Cost.Type

export const Limit = Schema.Struct({
  context: Schema.Int,
  input: Schema.Int.pipe(Schema.optional),
  output: Schema.Int,
})
export type Limit = typeof Limit.Type

export const Ref = Schema.Struct({
  id: ID,
  providerID: ProviderV2.ID,
  variant: VariantID.pipe(Schema.optional),
})
export type Ref = typeof Ref.Type

export class Info extends Schema.Class<Info>("ModelV2.Info")({
  id: ID,
  apiID: ID,
  providerID: ProviderV2.ID,
  family: Family.pipe(Schema.optional),
  name: Schema.String,
  endpoint: ProviderV2.Endpoint,
  options: Schema.Struct({
    ...ProviderV2.Options.fields,
    variant: Schema.String.pipe(Schema.optional),
  }),
  capabilities: Capabilities,
  variants: Variant.pipe(Schema.Array),
  time: Schema.Struct({
    released: DateTimeUtcFromMillis,
  }),
  cost: Cost.pipe(Schema.Array),
  status: Schema.Literals(["alpha", "beta", "deprecated", "active"]),
  enabled: Schema.Boolean,
  limit: Limit,
}) {
  static empty(providerID: ProviderV2.ID, modelID: ID) {
    return new Info({
      id: modelID,
      apiID: modelID,
      providerID,
      name: modelID,
      endpoint: {
        type: "unknown",
      },
      capabilities: {
        tools: false,
        input: [],
        output: [],
      },
      options: {
        headers: {},
        body: {},
        aisdk: { provider: {}, request: {} },
      },
      variants: [],
      time: {
        released: DateTime.makeUnsafe(0),
      },
      cost: [],
      status: "active",
      enabled: true,
      limit: {
        context: 0,
        output: 0,
      },
    })
  }
}
```

## Catalog Interface

```ts
export interface Interface {
  readonly transform: State.Interface<Data, Editor>["transform"]
  readonly provider: {
    readonly get: (providerID: ProviderV2.ID) => Effect.Effect<ProviderV2.Info, ProviderNotFoundError>
    readonly all: () => Effect.Effect<ProviderV2.Info[]>
    readonly available: () => Effect.Effect<ProviderV2.Info[]>
  }

  readonly model: {
    readonly get: (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
    ) => Effect.Effect<ModelV2.Info, ProviderNotFoundError | ModelNotFoundError>
    readonly all: () => Effect.Effect<ModelV2.Info[]>
    readonly available: () => Effect.Effect<ModelV2.Info[]>
    readonly default: () => Effect.Effect<Option.Option<ModelV2.Info>>
    readonly small: (providerID: ProviderV2.ID) => Effect.Effect<Option.Option<ModelV2.Info>>
  }
}
```

`ProviderV2.Info.enabled` is stored provider state. Provider plugins set it to `false` or record whether availability comes from environment, account, or custom configuration.

`ProviderV2.Endpoint` includes `{ type: "unknown" }`. `CatalogV2.model.get()` and `CatalogV2.model.all()` resolve `unknown` endpoints from the provider before returning models.

Model storage is nested by provider because model ids are only unique within a provider.

```ts
type ProviderRecord = {
  provider: ProviderV2.Info
  models: HashMap.HashMap<ModelV2.ID, ModelV2.Info>
}

let records = HashMap.empty<ProviderV2.ID, ProviderRecord>()
```

`ModelV2.Info.enabled` stores model availability. `CatalogV2.model.available()` also requires a usable provider.

```ts
const available = provider.enabled !== false && model.enabled
```

## Current Session Runner Adaptation

The first local V2 Session runner waits for Location plugin boot, then resolves an explicit Session model without silently falling back. Without an explicit model it uses a supported Location catalog default, then falls back to the first available model with a supported route, and otherwise fails with `SessionRunnerModel.ModelNotSelectedError`. Its native adaptation surface is deliberately narrow:

```text
openai/responses over HTTP
openai/completions for OpenAI Chat
openai/completions for OpenAI-compatible Chat
anthropic/messages
aisdk:@ai-sdk/openai
aisdk:@ai-sdk/openai-compatible with an explicit URL
aisdk:@ai-sdk/anthropic
```

Native endpoint URLs are complete endpoint URLs and are split into base URL plus request path when building an LLM route. AI SDK endpoint URLs remain base URLs. The adapter preserves model headers and body options, environment-backed provider credentials, direct model API keys, and selected Session variant overlays.

Unsupported routes fail explicitly with `SessionRunnerModel.UnsupportedEndpointError`. In particular, `openai/responses` with WebSocket transport must not silently downgrade to HTTP. Google, Azure, Bedrock, OpenRouter-specific behavior, GitHub Copilot, Vertex, gateway adapters, and signed authentication remain future provider slices.

## Plugin Interface

```ts
type HookSpec = {
  "account.update": {
    input: {
      id: AccountV2.ID
      serviceID: AccountV2.ServiceID
    }
    output: {
      description: string
      credential: AccountV2.Credential
      cancel: boolean
    }
  }

  "account.remove": {
    input: {
      account: AccountV2.Info
    }
    output: {
      cancel: boolean
    }
  }

  "account.activate": {
    input: {}
    output: {
      from?: AccountV2.ID
      to: AccountV2.ID
      cancel: boolean
    }
  }

  "account.activated": {
    input: {
      from?: AccountV2.ID
      to: AccountV2.ID
    }
    output: {}
  }
}

export type Definition<R = never> = Effect.Effect<
  {
    readonly order: number
    readonly hooks: HookFunctions
  },
  never,
  R
>

export interface Interface {
  readonly add: <R = never>(input: { id: ID; definition: Definition<R> }) => Effect.Effect<void, never, R>

  readonly remove: (id: ID) => Effect.Effect<void>

  readonly trigger: <Name extends keyof Hooks>(name: Name, input: HookInput<Name>) => Effect.Effect<HookInput<Name>>
}
```

## Plugin Order

```ts
export const Order = {
  modelsDev: 0,
  env: 10,
  account: 20,
  provider: 30,
  config: 40,
  discovery: 50,
} as const
```

## Built-In Plugins

```ts
export const ModelsDevPlugin: PluginV2.Definition<ProviderV2.Service | ModelV2.Service | ModelsDev.Service>

export const EnvPlugin: PluginV2.Definition<ProviderV2.Service | Env.Service>

export const AccountPlugin: PluginV2.Definition<ProviderV2.Service | AccountV2.Service>

export const ConfigPlugin: PluginV2.Definition<ProviderV2.Service | ModelV2.Service | Config.Service>

export const AnthropicPlugin: PluginV2.Definition<ProviderV2.Service | AccountV2.Service>

export const OpenRouterPlugin: PluginV2.Definition<ProviderV2.Service>

export const AmazonBedrockPlugin: PluginV2.Definition<ProviderV2.Service | AccountV2.Service | Env.Service>

export const GoogleVertexPlugin: PluginV2.Definition<ProviderV2.Service | AccountV2.Service | Env.Service>

export const GitLabPlugin: PluginV2.Definition<ProviderV2.Service | AccountV2.Service | Env.Service>

export const GitLabDiscoveryPlugin: PluginV2.Definition<ProviderV2.Service | ModelV2.Service | AccountV2.Service>
```

## Plugin Hooks

```ts
export type Hooks = {
  init: {}

  "provider.update": {
    provider: Draft<ProviderV2.Info>
    cancel: boolean
  }

  "model.update": {
    model: Draft<ModelV2.Info>
    cancel: boolean
  }
}
```
