# Provider Custom Loaders and Variable Substitution

This document describes the custom loader and variable substitution patterns used in `@opencode/Provider`.

## Custom Loaders

Custom loaders allow providers to implement specialized logic for model initialization, autoloading, and model discovery. They are defined in `src/provider/provider.ts` within the `custom` function.

### `CustomModelLoader`

Used to intercept and customize how a language model instance is created from the SDK.

```ts
type CustomModelLoader = (
  sdk: any, 
  modelID: string, 
  options?: Record<string, any>, 
  model?: Model
) => Promise<any>
```

**Example (Azure):**
Azure uses a custom loader to select between chat and completion endpoints based on the `useCompletionUrls` option.

### `CustomVarsLoader`

Used for dynamic variable substitution in base URLs.

```ts
type CustomVarsLoader = (options: Record<string, any>) => Record<string, string>
```

**Example (Google Vertex):**
Google Vertex uses this to inject `GOOGLE_VERTEX_LOCATION` and `GOOGLE_VERTEX_ENDPOINT` into the base URL.

### `CustomDiscoverModels`

Used for dynamic model discovery (e.g., fetching available models from a provider API).

```ts
type CustomDiscoverModels = () => Promise<Record<string, Model>>
```

**Example (GitLab):**
GitLab uses this to discover models available on the Agent Platform.

## Variable Substitution

Variable substitution happens in `resolveSDK` before initializing the provider SDK. It supports two types of variables:

1.  **Custom Loader Variables**: Provided by `CustomVarsLoader`.
2.  **Environment Variables**: Injected via `${VARIABLE_NAME}` syntax.

### Priority and Flow

1.  The `baseURL` is determined from provider options or model API info.
2.  If a `varsLoader` exists for the provider, it is executed.
3.  Any `${KEY}` in the URL is replaced with values from the `varsLoader`.
4.  Any remaining `${KEY}` matches are replaced with values from the environment (`env.all()`).
5.  The final `baseURL` is assigned back to the provider options.

## Built-in Custom Providers

Several providers have specialized logic implemented in the `custom` function:

- **Anthropic**: Adds beta headers for thinking and tool streaming.
- **OpenAI/xAI/GitHub Copilot**: Use custom `getModel` to select specific response/chat endpoints.
- **Azure**: Handles resource name resolution from environment or config.
- **Amazon Bedrock**: Implements complex region-based model ID prefixing and credential chain logic.
- **Cloudflare (Workers AI & AI Gateway)**: Handles account ID and API key resolution.
- **Snowflake Cortex**: Implements custom fetch to handle specific API behaviors like `max_tokens` renaming and role correction in streams.
