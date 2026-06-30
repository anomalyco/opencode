# auth-architecture-baseline Specification

## Purpose

Document the current authentication architecture in OpenCode as a baseline for implementing Microsoft Entra ID / Microsoft Account OAuth2/OIDC provider in a fork.

## Current Architecture

### Auth Storage (`packages/opencode/src/auth/index.ts`)

**Location**: `~/.local/share/opencode/auth.json` (or `OPENCODE_AUTH_CONTENT` env var)

**Schema** (lines 13-34):
```typescript
class Oauth {
  type: "oauth"
  refresh: string
  access: string
  expires: NonNegativeInt  // Unix timestamp
  accountId?: string
  enterpriseUrl?: string
}

class Api {
  type: "api"
  key: string
  metadata?: Record<string, string>
}

class WellKnown {
  type: "wellknown"
  key: string
  token: string
}
```

**Service Interface** (lines 42-47):
```typescript
interface Interface {
  get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  all: () => Effect.Effect<Record<string, Info>, AuthError>
  set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  remove: (key: string) => Effect.Effect<void, AuthError>
}
```

### Provider Auth System (`packages/opencode/src/provider/auth.ts`)

**AuthHook Definition** (`packages/plugin/src/index.ts` lines 88-208):
```typescript
type AuthHook = {
  provider: string  // Provider ID (e.g., "github-copilot", "azure")
  loader?: (auth: () => Promise<Auth>, provider: Provider) => Promise<Record<string, any>>
  methods: AuthMethod[]
}

type AuthMethod =
  | { type: "oauth"; label: string; prompts?: Prompt[]; authorize(inputs?: Record<string, string>): Promise<AuthOAuthResult> }
  | { type: "api"; label: string; prompts?: Prompt[]; authorize?(inputs?: Record<string, string>): Promise<AuthApiResult> }

type AuthOAuthResult = { url: string; instructions: string } & (
  | { method: "auto"; callback(): Promise<AuthCallbackResult> }
  | { method: "code"; callback(code: string): Promise<AuthCallbackResult> }
)

type AuthCallbackResult =
  | { type: "success"; provider?: string } & ( { refresh: string; access: string; expires: number; accountId?: string; enterpriseUrl?: string } | { key: string; metadata?: Record<string, string> } )
  | { type: "failed" }
```

**ProviderAuth Service Flow** (`packages/opencode/src/provider/auth.ts`):
1. `methods()` — Returns available auth methods from plugin hooks
2. `authorize(input)` — Validates prompts, calls plugin's `authorize()`, stores pending OAuth result
3. `callback(input)` — Retrieves pending, calls plugin's `callback(code)`, saves result to auth storage:
   - If `key` in result → saves as `Api` type
   - If `refresh` in result → saves as `Oauth` type (refresh, access, expires, accountId, enterpriseUrl)

### Existing OAuth Providers

| Provider | Auth Method | Implementation |
|----------|-------------|----------------|
| **GitHub Copilot** | Device Code Flow | `packages/core/src/plugin/provider/github-copilot.ts` + `packages/core/src/github-copilot/copilot-provider.ts` |
| **OpenAI (Codex)** | OAuth (Authorization Code + PKCE) | `packages/opencode/src/plugin/openai/codex.ts` |
| **Azure** | API Key (no OAuth) | `packages/core/src/plugin/provider/azure.ts` — uses `AZURE_RESOURCE_NAME` env var |
| **Google Vertex** | API Key + custom fetch | `packages/core/src/plugin/provider/google-vertex.ts` |

### Console Web Auth (`packages/console/function/src/auth.ts`)

Uses `@openauthjs/openauth` with:
- `GithubProvider` (clientID + clientSecret)
- `GoogleOidcProvider` (clientID only)
- Stores in Cloudflare KV + Drizzle SQLite (`AuthTable`)

### Plugin Registration

Plugins register via `PluginV2.define()` returning hooks including `auth`:
- `packages/core/src/plugin/provider/*.ts` — each provider plugin
- Hooks collected by `ProviderAuth` service via `Plugin.Service.list()`

## Gap Analysis for Microsoft Entra ID

### What's Missing

1. **No Microsoft/Entra ID provider plugin** — No `microsoft.ts` in `packages/core/src/plugin/provider/`
2. **No Authorization Code + PKCE implementation** for Microsoft endpoints:
   - Authorize: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`
   - Token: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
3. **No Microsoft Graph scope handling** — Need `openid`, `email`, `profile`, `offline_access`
4. **No tenant configuration** — Support `common`, `organizations`, `consumers`, or specific tenant ID
5. **No client secret handling** — Public client (CLI) should use PKCE only; confidential client (console) may use client secret

### Required Implementation

1. **New plugin**: `packages/core/src/plugin/provider/microsoft.ts`
2. **AuthHook with**:
   - `provider: "microsoft"`
   - `methods: [{ type: "oauth", label: "Microsoft Account", authorize: ..., ... }]`
3. **PKCE generation**: `code_verifier` (43-128 chars), `code_challenge` (S256)
4. **Local callback server**: `http://localhost:3000/callback` (or configurable port)
5. **Token exchange**: POST to token endpoint with `grant_type=authorization_code`, `code_verifier`
6. **Token refresh**: POST with `grant_type=refresh_token`
7. **Account ID extraction**: From ID token `oid` or `sub` claim

### Microsoft-Specific Considerations

| Aspect | Detail |
|--------|--------|
| **Endpoints** | v2.0: `/common/`, `/organizations/`, `/consumers/`, `/{tenant}/` |
| **Scopes** | `openid email profile offline_access` + optional `https://graph.microsoft.com/.default` |
| **Tokens** | Access token (JWT), Refresh token (opaque), ID token (JWT with claims) |
| **PKCE** | Required for public clients (S256) |
| **Client type** | Public client (CLI) = no client secret; Confidential (console) = client secret |
| **Multi-tenant** | Use `/common/` endpoint, validate `tid` claim in ID token |

## Non-Goals

- Microsoft Graph API integration (separate concern)
- Copilot model consumption via Microsoft auth (requires separate provider implementation)
- SSO/Enterprise features beyond basic OAuth login

## References

- `packages/opencode/src/auth/index.ts` — Auth storage service
- `packages/opencode/src/provider/auth.ts` — Provider auth orchestration
- `packages/plugin/src/index.ts` — AuthHook type definitions
- `packages/core/src/plugin/provider/github-copilot.ts` — Device code flow example
- `packages/opencode/src/plugin/openai/codex.ts` — OAuth code flow example
- `packages/console/function/src/auth.ts` — Web OAuth with @openauthjs/openauth
- Microsoft Identity Platform docs: https://learn.microsoft.com/en-us/entra/identity-platform/