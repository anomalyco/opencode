## Why

Enterprise users need to access SAP AI Core hosted AI deployments (LLMs and other inference endpoints) through opencode. This enables governance, regional hosting, and tenant isolation inside existing workflows.

## What Changes

- Add new provider `sap-ai-core` with conditional autoload
- Support service key JSON OR discrete env vars (**SAP_AI_CORE_SERVICE_KEY** or **SAP_AI_CORE_URL**, **SAP_AI_CORE_CLIENT_ID**, **SAP_AI_CORE_CLIENT_SECRET**, **SAP_AI_CORE_OAUTH_URL**)
- Implement OAuth2 client credentials token acquisition + caching
- Provide model alias mapping (config `id` indirection)
- Inject provider-specific options (timeout, region header)
- Normalize errors (auth, throttle, missing model)
- Add minimal observability (init + timing logs)
- Optional dynamic deployment listing (flag-gated, not default)
- Perform third‑party library evaluation (official SAP Cloud SDK, community clients) against opencode simplicity rules before implementation; prefer lean HTTP wrapper if dependencies are heavy.

## Impact

- Affected specs: `sap-ai-core` (new capability)
- Affected code: `provider.ts`, `config.ts` provider section, test harness
- No breaking changes to existing providers
- Introduces new enterprise integration path

## Third-Party Evaluation Plan

1. Discover official SAP AI Core REST docs & any JS/TS libraries (e.g. parts of SAP Cloud SDK, xssec, @sap/\* packages, community wrappers).
2. Collect metrics: dependency count, bundle size, transitive native modules, Bun compatibility, maintenance cadence, license.
3. Acceptance criteria: single-file or minimal code addition (< ~150 lines), no large framework initialization, works under Bun, no unsupported Node-only APIs, license compatible.
4. Decision: If library exceeds criteria, implement custom lightweight fetch wrapper (OAuth2 token + deployment invocation) using service key fields.
5. Document final decision in `design.md` (add section "Library Evaluation & Decision").
6. Re-run proposal validation after any update.

## Decision Gate

Implementation MUST NOT begin until evaluation tasks completed and decision recorded in `design.md`.
