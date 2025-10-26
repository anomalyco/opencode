## Context

SAP AI Core hosts AI deployments (LLM, embedding, custom inference) behind OAuth2 client credentials. Users often hold a service key JSON with URLs and secrets. Integrating as an opencode provider unifies invocation and telemetry.

Capability name `sap-ai-core` is retained as a brand-based provider integration (exception to verb-noun rule) to align with existing provider naming conventions (e.g. `anthropic`, `openai`).

## Goals / Non-Goals

- Goals: seamless autoload, secure token caching, alias-based model selection, minimal code changes.
- Non-Goals: lifecycle management (deploy/start/stop), training operations, full dynamic listing by default.

## Decisions

- Service key parsing preferred (single env var) with fallback discrete vars.
- Cache tokens in memory keyed by credential hash, refresh with 60s buffer + jitter.
- Alias mapping uses existing `realIdByKey` pattern with `id` override.
- Introduce explicit error classes: `ProviderAuthError` (401/403 inference), `ProviderRateLimitError` (429 with optional `retry` ms from `Retry-After`).
- Dynamic listing hidden behind future flag to avoid wide API calls.

## Alternatives Considered

- Treat AI Core as OpenAI-compatible (rejected: API & auth differ).
- Forcing users to always configure models manually (less ergonomic).

## Risks / Trade-offs

- Token endpoint latency -> Mitigation: concurrency de-dup (promise cache).
- Secret leakage risk -> Mitigation: never log secrets, only hash.
- Model mismatch -> Mitigation: explicit error normalization.

## Migration Plan

New capability only; no migration. Add provider, release, document.

## Library Evaluation & Decision

### Decision

Adopt a custom lightweight fetch wrapper (no external SAP SDK).

### Evaluation Summary

| Library                          | Dependencies                | Bundle Size (rough) | Bun Compatibility          | Maintenance | License    | Notes                                                      |
| -------------------------------- | --------------------------- | ------------------- | -------------------------- | ----------- | ---------- | ---------------------------------------------------------- |
| SAP Cloud SDK (core/http)        | >20 direct (transitive ~60) | Large (>300KB min)  | Mixed (Node-specific APIs) | Active      | Apache-2.0 | Heavy initialization, broad scope                          |
| xssec (@sap/xssec)               | 8+ (incl. JWT libs)         | Medium              | Node-only crypto usage     | Active      | Apache-2.0 | Focused on XSUAA, not needed for simple client credentials |
| Community wrappers (none mature) | Varies                      | Unknown             | Unverified                 | Sparse      | Various    | No clear minimal maintained package                        |

Metrics gathered from npm metadata (dependency counts) and prior knowledge of package internals; installing would exceed <150 LOC goal.

### Rationale

- Exceeds simplicity threshold: large transitive graphs, unused features (destination caching, JWT handling) for simple OAuth2 client credentials.
- Potential Bun incompatibilities (Node stream, crypto fallbacks) increase maintenance risk.
- Custom wrapper: ~120 LOC target (credential parsing, token cache, request helper, error normalization, timing log).
- Avoids version churn; relies only on native `fetch`.

### Implementation Outline

1. Add custom loader `sap-ai-core` to `CUSTOM_LOADERS`.
2. Detect credentials via `SAP_AI_CORE_SERVICE_KEY` (JSON) OR discrete env vars.
3. Build in-memory token cache keyed by hash of `{url, oauth, client_id}`; refresh with 60s buffer; concurrency de-dup via shared promise.
4. Inject `fetch` wrapper with timeout + region header if provided in service key.
5. Support alias mapping via existing config (`provider.models[alias].id = realDeploymentId`).
6. Normalize HTTP errors to `ModelNotFoundError` (404/410), `InitError` (auth failure), generic NamedError for throttling (429) with retry hint.
7. Minimal observability: log `init` and per-call timing using existing `log.time()`.

### Scope Confirmation

Decision does NOT expand scope beyond original proposal; no proposal update required.

## Open Questions

- Enable dynamic deployment listing by default?
- Support additional inference types (embeddings, batch)?
- Standard tracing header naming (confirm official guidance)?
