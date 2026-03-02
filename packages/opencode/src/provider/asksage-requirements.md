# AskSage Provider Integration Requirements

## 1. Overview

AskSage is a FedRAMP High authorized, model-agnostic AI platform designed for
government and enterprise use. It supports 150+ LLMs from providers including
Anthropic, OpenAI/Azure, Google, and open-source models. The platform is
authorized for FedRAMP High, IL5, IL6, and Top Secret environments.

## 2. API Architecture

AskSage exposes **two API surface areas** relevant to OpenCode integration:

### 2.1 Native AskSage API (Custom REST)

- **User API Base:** `https://api.asksage.ai/user/`
- **Server API Base:** `https://api.asksage.ai/server/`
- Custom request/response format (NOT OpenAI-compatible)
- Main endpoint: `POST /server/query` with custom JSON body
- Model listing: `GET /server/get-models`
- Authentication via `x-access-tokens` header

### 2.2 Anthropic-Compatible Proxy Endpoint

- **Base URL:** `https://api.asksage.ai/server/anthropic`
- Proxies requests using the **Anthropic Messages API format**
- Used by Claude Code (`ANTHROPIC_BASE_URL`)
- Authentication via AskSage API token passed as `ANTHROPIC_AUTH_TOKEN`

### 2.3 OpenAI-Compatible Proxy Endpoint (Documented but URL unconfirmed)

- AskSage documentation references "OpenAI-Style Endpoints"
- Likely at `https://api.asksage.ai/server/openai` (by analogy with the
  Anthropic proxy path)
- The Continue.dev integration uses `https://api.asksage.ai/server/` as its
  base URL with an `askSage` provider type

### 2.4 DoD/Government Instance URLs

AskSage operates on multiple network instances:

| Environment | Base URL |
|---|---|
| Commercial SaaS | `https://api.asksage.ai` |
| Army GenAI | `https://api.genai.army.mil` |
| Other DoD/IC | Instance-specific (configurable) |

Government environments may require custom CA certificates via
`NODE_EXTRA_CA_CERTS`.

## 3. Authentication

### 3.1 API Key Authentication

- Users generate API keys from the AskSage platform
- Keys are passed in the `x-access-tokens` header for native API calls
- For Anthropic proxy: key is passed as the `Authorization: Bearer <token>`
  header (standard Anthropic auth flow via `@ai-sdk/anthropic`)

### 3.2 Token-Based Authentication (24-hour)

- Temporary tokens can be generated via
  `POST /user/get-token-with-api-key` with email + API key
- These tokens expire after 24 hours
- Not recommended for programmatic integrations

### 3.3 Credential Format

```json
{
  "credentials": {
    "api_key": "<asksage-api-key>",
    "Ask_sage_user_info": {
      "username": "<email>"
    }
  }
}
```

## 4. Available Models

AskSage routes to underlying provider models. Known available model identifiers
(from Continue.dev integration docs):

| Display Name | Model Key | Underlying Provider |
|---|---|---|
| Google Gemini 2.5 Pro | `google-gemini-2.5-pro` | Google |
| Anthropic Claude 4 Sonnet | `google-claude-4-sonnet` | Anthropic (via Google) |
| GPT-5 | `gpt-5` | OpenAI |
| Anthropic Claude 4.5 Sonnet | `google-claude-45-sonnet` | Anthropic (via Google) |

The full model list is available dynamically via `GET /server/get-models`.

Model capabilities available through AskSage (based on underlying models):
- Text generation (all models)
- Image input (vision-capable models)
- Tool use / function calling (supported models)
- Reasoning / extended thinking (supported models like Claude, GPT o-series)

## 5. Integration Approach

### 5.1 Recommended: Anthropic SDK via Proxy (Primary)

Since AskSage provides an Anthropic-compatible proxy at
`/server/anthropic`, the simplest integration uses the existing
`@ai-sdk/anthropic` SDK with a custom base URL:

```typescript
// Uses @ai-sdk/anthropic with custom baseURL
createAnthropic({
  baseURL: "https://api.asksage.ai/server/anthropic",
  apiKey: "<asksage-api-key>",
  headers: {
    "anthropic-beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
  }
})
```

**Pros:**
- Reuses existing Anthropic SDK (already bundled)
- Full compatibility with Anthropic features (streaming, tool use, thinking)
- Follows the same pattern already used by Claude Code integration
- No new npm dependency

**Cons:**
- Only exposes Anthropic/Claude models through this endpoint
- Non-Claude models (GPT, Gemini) would need a separate endpoint

### 5.2 Alternative: OpenAI-Compatible SDK (Secondary)

For non-Anthropic models, AskSage likely provides OpenAI-compatible endpoints:

```typescript
// Uses @ai-sdk/openai-compatible with custom baseURL
createOpenAICompatible({
  baseURL: "https://api.asksage.ai/server/openai",
  apiKey: "<asksage-api-key>",
  name: "asksage"
})
```

### 5.3 Recommended Hybrid Approach

Register AskSage as a provider that:
1. Uses `@ai-sdk/anthropic` for Claude models (via `/server/anthropic`)
2. Uses `@ai-sdk/openai-compatible` for other models (via `/server/openai`)

Since the Anthropic proxy is the most well-documented and battle-tested
(it powers the official Claude Code integration), we should prioritize that
path and expose Claude models first.

## 6. Provider Configuration Schema

### 6.1 Environment Variables

| Variable | Description |
|---|---|
| `ASKSAGE_API_KEY` | AskSage API key (primary) |
| `ASKSAGE_BASE_URL` | Custom API base URL (default: `https://api.asksage.ai`) |

### 6.2 Config File (opencode.json)

```json
{
  "provider": {
    "asksage": {
      "api": "https://api.asksage.ai/server/anthropic",
      "env": ["ASKSAGE_API_KEY"],
      "options": {
        "baseURL": "https://api.asksage.ai/server/anthropic"
      },
      "models": {
        "claude-sonnet-4-5": {
          "id": "claude-sonnet-4-5-20250514",
          "name": "Claude Sonnet 4.5 (AskSage)"
        }
      }
    }
  }
}
```

## 7. Implementation Details

### 7.1 Provider Registration

Add to `BUNDLED_PROVIDERS` or `CUSTOM_LOADERS` in `provider.ts`:

The provider should be registered via `CUSTOM_LOADERS` since it needs custom
logic to:
- Set the base URL to `/server/anthropic`
- Handle the API key mapping
- Set Anthropic-specific headers

```typescript
// In CUSTOM_LOADERS:
asksage: async () => {
  return {
    autoload: false,
    options: {
      headers: {
        "anthropic-beta":
          "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
      },
    },
  }
}
```

The npm package used should be `@ai-sdk/anthropic` (already bundled) with the
base URL overridden to `https://api.asksage.ai/server/anthropic`.

### 7.2 Models to Register

Initial model set (matching AskSage's known Anthropic model availability):

| Model ID | API ID | Context | Output | Reasoning |
|---|---|---|---|---|
| `claude-sonnet-4-5` | `claude-sonnet-4-5-20250514` | 200000 | 16384 | Yes |
| `claude-sonnet-4` | `claude-sonnet-4-20250514` | 200000 | 16384 | Yes |
| `claude-opus-4` | `claude-opus-4-20250514` | 200000 | 16384 | Yes |
| `claude-haiku-3-5` | `claude-3-5-haiku-20241022` | 200000 | 8192 | No |

Note: Exact model IDs exposed by AskSage should be confirmed via their
`/server/get-models` endpoint. AskSage may use different model identifiers
(e.g., `google-claude-4-sonnet` in Continue.dev docs).

### 7.3 Models.dev Entry

The provider definition in models.dev format:

```json
{
  "asksage": {
    "id": "asksage",
    "name": "AskSage",
    "api": "https://api.asksage.ai/server/anthropic",
    "npm": "@ai-sdk/anthropic",
    "env": ["ASKSAGE_API_KEY"],
    "models": {
      "claude-sonnet-4-5": {
        "id": "claude-sonnet-4-5-20250514",
        "name": "Claude Sonnet 4.5",
        "release_date": "2025-05-14",
        "reasoning": true,
        "temperature": false,
        "tool_call": true,
        "attachment": true,
        "modalities": {
          "input": ["text", "image", "pdf"],
          "output": ["text"]
        },
        "limit": {
          "context": 200000,
          "output": 16384
        },
        "cost": {
          "input": 3,
          "output": 15,
          "cache_read": 0.3,
          "cache_write": 3.75
        }
      }
    }
  }
}
```

### 7.4 Transform Considerations

Since AskSage uses the Anthropic API proxy, most transforms from
`transform.ts` that apply to `@ai-sdk/anthropic` will work automatically:

- Message normalization for Claude models (tool call ID sanitization)
- Cache control (ephemeral caching for Anthropic)
- Thinking/reasoning variants
- Temperature handling (undefined for Claude)

The provider ID check in `transform.ts` uses `model.api.id.includes("claude")`
or `model.api.npm === "@ai-sdk/anthropic"`, so AskSage models will
automatically get Anthropic transforms applied.

### 7.5 Error Handling

AskSage may return custom error responses. The `error.ts` module should handle:
- Standard Anthropic error codes (passed through the proxy)
- AskSage-specific errors (token expiry, quota limits)
- Network-level errors for government networks (certificate issues)

No new overflow patterns are expected since the proxy passes through
Anthropic error responses.

## 8. FedRAMP Compliance Considerations

### 8.1 Data Handling

- AskSage uses "fire and forget" - data is never retained, logged, or used
  for model training
- Zero Trust Architecture with label-based access control
- FIPS 140-3 validated cryptographic modules

### 8.2 Network Requirements

- Government deployments may require:
  - Custom CA certificates (`NODE_EXTRA_CA_CERTS`)
  - DoD PKI certificate chains
  - Instance-specific base URLs
- All traffic must go through the AskSage proxy (no direct model provider
  API calls)

### 8.3 Configuration for Government Networks

```json
{
  "provider": {
    "asksage": {
      "options": {
        "baseURL": "https://api.genai.army.mil/server/anthropic"
      }
    }
  }
}
```

Environment variable `NODE_EXTRA_CA_CERTS` should be set to the path of the
DoD Root CA certificate bundle.

## 9. Security Considerations

- API keys should be stored via the OpenCode `Auth` module (not in config files)
- Support env var (`ASKSAGE_API_KEY`) and `opencode auth asksage` flow
- No sensitive data should be logged
- Certificate validation must not be disabled (no `NODE_TLS_REJECT_UNAUTHORIZED=0`)
- The provider should validate that the base URL uses HTTPS

## 10. Testing Strategy

### 10.1 Unit Tests

- Provider registration and model listing
- API key detection from env vars and Auth module
- Base URL configuration (default and custom)
- Model capability mapping
- Header injection (anthropic-beta headers)

### 10.2 Integration Tests

- Mock AskSage Anthropic proxy responses
- Verify request format matches Anthropic Messages API
- Verify authentication header is correctly set
- Test custom base URL for government instances
- Test error handling for common failure modes

### 10.3 Test File Location

Tests should be placed alongside provider code or in a test directory
following the project's existing patterns.

## 11. Open Questions

1. **Exact model IDs:** The model identifiers used by AskSage's Anthropic
   proxy need to be confirmed. Are they standard Anthropic IDs
   (`claude-sonnet-4-5-20250514`) or AskSage-specific
   (`google-claude-45-sonnet`)?

2. **OpenAI-compatible endpoint URL:** The exact path for OpenAI-compatible
   models needs confirmation. Is it `/server/openai/v1/` or another path?

3. **Rate limits:** AskSage may impose its own rate limits separate from
   the underlying model providers.

4. **Streaming support:** Confirm that the Anthropic proxy supports SSE
   streaming (expected but should be verified).

5. **Token costs:** AskSage pricing may differ from direct provider pricing.
   Costs listed above are direct Anthropic prices and may not reflect
   AskSage's actual pricing (they likely add a markup as a managed service).
   Consider setting costs to 0 to avoid misleading users, or clearly
   documenting them as estimates. Review how other proxy providers (e.g.,
   OpenRouter) handle cost discrepancies.

6. **Dynamic model discovery:** Should OpenCode call `/server/get-models`
   at startup to discover available models, or use a static list?
