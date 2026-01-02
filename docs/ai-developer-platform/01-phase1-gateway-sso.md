# Phase 1: AI Gateway + SSO Integration

## Overview

Phase 1 establishes the security foundation by routing all AI requests through an internal gateway and authenticating users via corporate SSO.

## Components

### 1.1 AI Gateway

**Purpose**: Single point of control for all LLM API requests

**Responsibilities**:

- Route requests to appropriate LLM providers
- Enforce rate limits and quotas
- Log all requests for audit
- Handle authentication/authorization
- Provide unified API interface

**Recommended Solution**: LiteLLM (see [AI Gateway Analysis](./04-ai-gateway-analysis.md))

### 1.2 SSO Integration

**Purpose**: Authenticate users via corporate identity provider

**Supported Protocols**:

- OIDC (OpenID Connect) - Recommended
- SAML 2.0 - For legacy systems

**Supported IdPs**:

- Okta
- Azure AD / Entra ID
- Google Workspace
- Auth0
- Keycloak (self-hosted)

## Architecture

```
+------------------+
|    OpenCode      |
|    Client        |
+--------+---------+
         |
         | 1. SSO Login (OIDC)
         v
+--------+---------+
|    Corporate     |
|    IdP (Okta)    |
+--------+---------+
         |
         | 2. ID Token + Access Token
         v
+--------+---------+
|    OpenCode      |
|    Client        |
+--------+---------+
         |
         | 3. API Request + Bearer Token
         v
+--------+---------+
|    AI Gateway    |
|    (LiteLLM)     |
+--------+---------+
         |
         | 4. Validate token, forward request
         v
+--------+---------+
|    LLM Provider  |
|    (OpenAI/etc)  |
+------------------+
```

## Implementation Details

### Gateway Setup

#### Option A: LiteLLM (Recommended for PoC)

```yaml
# litellm-config.yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

  - model_name: claude-sonnet
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_API_KEY

general_settings:
  master_key: sk-enterprise-master-key

litellm_settings:
  success_callback: ["langfuse"] # For logging
  cache: true
```

#### Option B: Custom Gateway

If building custom, implement these endpoints:

```
POST /v1/chat/completions     - OpenAI-compatible chat
POST /v1/completions          - Legacy completions
POST /v1/embeddings           - Embeddings
GET  /v1/models               - List available models
GET  /health                  - Health check
```

### OpenCode Client Changes

#### 1. Add SSO Auth Type

**File**: `packages/opencode/src/auth/index.ts`

```typescript
// Add new auth type
export const SSO = z
  .object({
    type: z.literal("sso"),
    idToken: z.string(),
    accessToken: z.string(),
    refreshToken: z.string().optional(),
    expires: z.number(),
    orgId: z.string().optional(),
  })
  .meta({ ref: "SSOAuth" })

export const Info = z.discriminatedUnion("type", [Oauth, Api, WellKnown, SSO])
```

#### 2. Add SSO Login Flow

**File**: `packages/opencode/src/cli/cmd/auth.ts` (new method)

```typescript
async function handleSSOAuth(enterpriseUrl: string): Promise<void> {
  // 1. Fetch OIDC configuration
  const oidcConfig = await fetch(`${enterpriseUrl}/.well-known/openid-configuration`).then((r) => r.json())

  // 2. Generate PKCE challenge
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)

  // 3. Build authorization URL
  const authUrl = new URL(oidcConfig.authorization_endpoint)
  authUrl.searchParams.set("client_id", "opencode")
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("scope", "openid profile email")
  authUrl.searchParams.set("redirect_uri", "http://localhost:19191/callback")
  authUrl.searchParams.set("code_challenge", challenge)
  authUrl.searchParams.set("code_challenge_method", "S256")

  // 4. Open browser, wait for callback
  await open(authUrl.toString())
  const code = await waitForCallback()

  // 5. Exchange code for tokens
  const tokens = await fetch(oidcConfig.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://localhost:19191/callback",
      client_id: "opencode",
      code_verifier: verifier,
    }),
  }).then((r) => r.json())

  // 6. Store auth
  await Auth.set("enterprise", {
    type: "sso",
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expires: Date.now() + tokens.expires_in * 1000,
  })
}
```

#### 3. Enforce Gateway in Provider

**File**: `packages/opencode/src/provider/provider.ts`

```typescript
// In getAllProviders() or similar
const cfg = await Config.get()

if (cfg.enterprise?.enforceGateway) {
  // Disable all providers except gateway
  for (const id of Object.keys(database)) {
    if (id !== "gateway") {
      disabled.add(id)
    }
  }

  // Inject SSO token into gateway requests
  const ssoAuth = await Auth.get("enterprise")
  if (ssoAuth?.type === "sso") {
    // Refresh if expired
    if (ssoAuth.expires < Date.now()) {
      await refreshSSOToken()
    }

    // Set auth header for gateway
    process.env.GATEWAY_API_KEY = ssoAuth.accessToken
  }
}
```

#### 4. Enterprise Config Schema

**File**: `packages/opencode/src/config/config.ts`

```typescript
enterprise: z
  .object({
    url: z.string().optional().describe("Enterprise server URL"),
    enforceGateway: z.boolean().optional().describe("Force all requests through gateway"),
    sso: z
      .object({
        issuer: z.string().describe("OIDC issuer URL"),
        clientId: z.string().default("opencode"),
        scopes: z.array(z.string()).default(["openid", "profile", "email"]),
      })
      .optional(),
    gateway: z
      .object({
        url: z.string().describe("Gateway base URL"),
        models: z.array(z.string()).optional().describe("Allowed models"),
      })
      .optional(),
  })
  .optional(),
```

### Enterprise Config Example

```json
{
  "$schema": "https://opencode.ai/config.json",
  "enterprise": {
    "url": "https://ai-platform.corp.example.com",
    "enforceGateway": true,
    "sso": {
      "issuer": "https://corp.okta.com",
      "clientId": "opencode-enterprise"
    },
    "gateway": {
      "url": "https://ai-gateway.corp.example.com",
      "models": ["gpt-4o", "claude-sonnet"]
    }
  },
  "share": "disabled",
  "provider": {
    "gateway": {
      "type": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://ai-gateway.corp.example.com/v1"
      }
    }
  },
  "enabled_providers": ["gateway"],
  "model": "gateway/gpt-4o"
}
```

## Security Considerations

### Token Handling

1. **Storage**: Tokens stored in `~/.config/opencode/auth.json` with 0600 permissions
2. **Refresh**: Automatic refresh before expiry
3. **Revocation**: Logout clears all tokens

### Network Security

1. **TLS**: All connections must use HTTPS
2. **Certificate Pinning**: Optional for high-security environments
3. **mTLS**: Gateway can require client certificates

### Audit Logging

Gateway should log:

- User ID (from token)
- Timestamp
- Model requested
- Token count (input/output)
- Request ID for correlation

## Testing Plan

### Unit Tests

```typescript
describe("SSO Auth", () => {
  it("should complete PKCE flow", async () => {
    // Mock OIDC endpoints
    // Verify token storage
  })

  it("should refresh expired tokens", async () => {
    // Set expired token
    // Trigger request
    // Verify refresh occurred
  })
})
```

### Integration Tests

1. **Happy Path**: Login -> Request -> Response
2. **Token Expiry**: Request with expired token triggers refresh
3. **Gateway Enforcement**: Direct provider calls blocked
4. **Offline**: Graceful handling when gateway unreachable

## Rollout Plan

### Week 1-2: Gateway Setup

- Deploy LiteLLM
- Configure models
- Setup monitoring

### Week 3-4: SSO Integration

- Configure IdP (Okta/AAD)
- Implement OpenCode auth flow
- Test with pilot users

### Week 5-6: Hardening

- Security review
- Load testing
- Documentation
- Pilot expansion

## Metrics

Track:

- **Latency**: P50/P95/P99 through gateway
- **Error Rate**: Failed requests
- **Token Usage**: Per user/team
- **Auth Events**: Logins, refreshes, failures

## Troubleshooting

### Common Issues

| Issue                 | Cause           | Solution                  |
| --------------------- | --------------- | ------------------------- |
| "Token expired"       | Clock skew      | Sync NTP                  |
| "Gateway unreachable" | Network         | Check firewall rules      |
| "Model not found"     | Config mismatch | Verify gateway model list |
| "Unauthorized"        | Token invalid   | Re-authenticate           |

## Dependencies

- LiteLLM or equivalent gateway
- Corporate IdP with OIDC support
- PostgreSQL (for gateway persistence)
- Redis (optional, for caching)
