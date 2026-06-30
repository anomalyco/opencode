# Delta for auth-architecture-baseline

## MODIFIED Requirements

### Requirement: Existing OAuth Providers

The following OAuth providers are registered in the system (previously excluding Microsoft, this table now includes the new entry).

| Provider | Auth Method | Implementation |
|----------|-------------|----------------|
| **GitHub Copilot** | Device Code Flow | `packages/core/src/plugin/provider/github-copilot.ts` |
| **OpenAI (Codex)** | OAuth (Authorization Code + PKCE) | `packages/opencode/src/plugin/openai/codex.ts` |
| **Microsoft** | OAuth (Auth Code + PKCE + Device Code) | `packages/opencode/src/plugin/microsoft.ts` |
| **xAI (Grok)** | OAuth (Auth Code + PKCE + Device Code) | `packages/opencode/src/plugin/xai.ts` |
| **Azure** | API Key (no OAuth) | `packages/core/src/plugin/provider/azure.ts` |
| **Google Vertex** | API Key + custom fetch | `packages/core/src/plugin/provider/google-vertex.ts` |

(Previously: Table listed 5 OAuth providers without Microsoft and xAI entries.)

### Requirement: Gap Analysis — What's Missing (Removed)

The entire `## Gap Analysis for Microsoft Entra ID` section is REMOVED — the gap is now closed by the `microsoft-auth` spec implementation.

## ADDED Requirements

### Requirement: Provider ID Registration

The system MUST recognize `microsoft` as a well-known `ProviderV2.ID`.

#### Scenario: microsoft in provider ID list

- GIVEN the provider ID registry
- WHEN `ProviderV2.ID.make("microsoft")` is called
- THEN it returns a valid branded string
- AND it is usable as a provider key in auth storage and model routing
