# Jules AI Agent Integration — Infrastructure Module

> **Decision**: DECISION_120_Google_Jules_Integration
> **Architecture**: `DE51GN3R/architectures/ARCHITECTURE_DECISION_120_Jules_Integration.md`
> **Codemap**: `DE51GN3R/architectures/CODEMAP_AI_Provider_Architecture.md`

## Purpose

Standalone client and session management for Google Jules AI coding agent (alpha). Jules provides session-based coding tasks with GitHub repo integration, operating on a REST + polling model distinct from the streaming ProviderHelper pattern used by Anthropic/OpenAI/Google Gemini.

## File Structure

```
Jules/
├── IJulesClient.ts          # Interface: session CRUD + polling
├── JulesClient.ts           # Implementation: HTTP client
├── JulesSessionManager.ts   # Lifecycle: create → poll → approve → complete
├── JulesTypes.ts            # Types: session, activity, artifact, status
├── JulesConfig.ts           # Config: endpoints, polling params, timeouts
├── JulesEntityMapper.ts     # Maps Jules responses → Pantheon entities
├── JulesAuthAdapter.ts      # Reuses existing auth/BYOK for Google credentials
└── README.md                # This file
```

## Architecture Decision: Why Not ProviderHelper?

The existing `ProviderHelper` interface assumes streaming chat completions with a single request/response cycle. Jules is a **stateful task agent** with a multi-step lifecycle (`QUEUED → PLANNING → AWAITING_PLAN_APPROVAL → IN_PROGRESS → COMPLETED`). See the full analysis in the architecture document.

## Session Lifecycle

```
QUEUED → PLANNING → AWAITING_PLAN_APPROVAL → IN_PROGRESS → COMPLETED
                                │
                          (approve/reject)
```

## Shared Infrastructure

Reuses from existing provider architecture:
- **Authentication**: `KeyTable` + `BillingTable` + `ProviderTable`
- **BYOK**: `ProviderTable.credentials` for Google API keys
- **Error types**: `AuthError`, `CreditsError`, `ModelError`
- **KV Config**: Provider entry alongside existing providers

## Status

Awaiting Oracle approval before implementation begins.
