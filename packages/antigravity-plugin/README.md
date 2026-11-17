# Antigravity provider plugin

Included and enabled by default in every Shuvcode Bun and Node install. No
separate package installation or `plugins` config entry is required.

Public Effect plugin for Google AI Pro / Antigravity. Exports
`GoogleAntigravityPlugin` (also default), with plugin ID
`opencode.provider.google-antigravity`, integration `google`, and OAuth method
`google-ai-pro`.

Core's default provider registry supplies `@opencode/plugin`'s public Context.
Bun and Node builds bundle the real implementation; the non-CLI workerd host
uses a stub for its Node-only callback surface. Explicit
browser authorization uses a Node HTTP callback listener on localhost port 36742.
There are no Core imports, SDK transport wrappers, or proxy servers.

- Provider/model transforms expose the shipped Gemini 4 Carbon, Argon and
  Hydrogen (including Hydrogen XHigh), Gemini 3.8 Flash, and older subscription
  variants without overriding the user's default model.
  Fallback requests without a model ID resolve to `gemini-3.8-flash-high`.
- Access-only imports activate using shipped models without discovery requests.
  Normal OAuth connections may discover model enums and suppress shipped variants
  explicitly denied by catalog entries (such as `gemini-4-hydrogen-disabled` or a
  disabled shipped model ID), with shipped defaults if discovery is unavailable.
- Native Gemini requests resolve the active credential afresh, then use the
  Cloud Code envelope and `metadata.projectId`. Only responses belonging to
  rewritten requests are unwrapped. API-key connections are unchanged.
- Failed rewritten responses are re-emitted as a Google error with the Cloud
  Code status, message, and (on 429) a best-effort quota summary readout. Only
  an explicit `QUOTA_EXHAUSTED` reason, an exhausted 5h bucket in the failed
  model's own group, or a long-window reset message becomes non-retryable
  `QUOTA_EXHAUSTED`; other `RESOURCE_EXHAUSTED` errors stay retryable throttles.
- Browser login is explicit. No HOME, legacy account, or IDE credential discovery
  is performed. Offline credential import belongs to the host's test importer.
- Credentials marked `metadata.shuvcodeAuthImport: "access-only"` cannot refresh;
  the guard runs before network I/O. The host must also reject resolution within
  five minutes of expiry. Refresh preserves metadata.
- Scoped credential events reload provider state; Google switches are filtered,
  while `credential.updated` has no integration payload and requires a reload.

## Verification

From this directory: `bun test` and `bun run typecheck`.

Real host/editor coverage lives in
`packages/core/test/plugin/provider-antigravity.test.ts`; run that test from
`packages/core`. All tests use fixture credentials and injected or loopback HTTP,
never a real model or provider endpoint.
