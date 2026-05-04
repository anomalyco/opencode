# AI SDK Dependency Upgrade Report

> Generated: 2026-05-04
> Scope: Minor and patch upgrades only (no major version bumps)

---

## Summary

| Status | Count |
|--------|-------|
| Upgradable (safe) | 23 |
| Already at latest | 2 |
| **Total checked** | **25** |

---

## Vercel AI SDK Monorepo (`ai` + `@ai-sdk/*`)

All packages below are part of the [Vercel AI SDK monorepo](https://github.com/vercel/ai). Versions were published on May 1, 2026 across 4 coordinated release waves. Many packages only received dependency bumps (not their own code changes).

| Package | Current | Latest | Bump | Real Change |
|---------|---------|--------|------|-------------|
| `ai` | 6.0.168 | **6.0.174** | patch | MCP server name propagation through dynamic tool parts |
| `@ai-sdk/alibaba` | 1.0.17 | **1.0.21** | patch | Deps bump only |
| `@ai-sdk/amazon-bedrock` | 4.0.96 | **4.0.100** | patch | Fix: `createAmazonBedrock()` no longer captures `globalThis.fetch` at init time — OpenTelemetry/Datadog patches no longer ignored |
| `@ai-sdk/anthropic` | 3.0.71 | **3.0.74** | patch | Deps bump only |
| `@ai-sdk/azure` | 3.0.49 | **3.0.59** | patch | Deps bump (OpenAI v3.0.58) |
| `@ai-sdk/cerebras` | 2.0.41 | **2.0.49** | patch | Deps bump only |
| `@ai-sdk/cohere` | 3.0.27 | **3.0.33** | patch | Deps bump only |
| `@ai-sdk/deepinfra` | 2.0.41 | **2.0.49** | patch | Deps bump only |
| `@ai-sdk/gateway` | 3.0.104 | **3.0.109** | patch | Backport: updated gateway model settings files |
| `@ai-sdk/google` | 3.0.63 | **3.0.67** | patch | Deps bump only |
| `@ai-sdk/google-vertex` | 4.0.112 | **4.0.118** | patch | Add Grok models to Vertex provider; fix: avoid recreating Node GoogleAuth clients on repeated requests |
| `@ai-sdk/groq` | 3.0.31 | **3.0.38** | patch | Deps bump only |
| `@ai-sdk/mistral` | 3.0.27 | **3.0.33** | patch | Deps bump only |
| `@ai-sdk/openai` | 3.0.53 | **3.0.58** | patch | Added type for image model options; preserve namespace on `function_call` output items |
| `@ai-sdk/openai-compatible` | 2.0.41 | **2.0.45** | patch | Add Grok models to Vertex provider |
| `@ai-sdk/perplexity` | 3.0.26 | **3.0.32** | patch | Deps bump only |
| `@ai-sdk/provider` | 3.0.8 | **3.0.10** | patch | Internal deps only |
| `@ai-sdk/provider-utils` | 4.0.23 | **4.0.26** | patch | Propagate MCP server name through dynamic tool parts |
| `@ai-sdk/togetherai` | 2.0.41 | **2.0.49** | patch | Deps bump only |
| `@ai-sdk/vercel` | 2.0.39 | **2.0.47** | patch | Deps bump only |
| `@ai-sdk/xai` | 3.0.82 | **3.0.87** | patch | Deps bump only |

**Notable substantive changes (not just deps bumps):**
- `@ai-sdk/amazon-bedrock` — Fixes `globalThis.fetch` capture bug affecting instrumentation
- `@ai-sdk/google-vertex` — Grok model support + GoogleAuth client reuse fix
- `@ai-sdk/openai` — Image model options type + function_call namespace fix
- `@ai-sdk/provider-utils` — MCP server name propagation
- `ai` — MCP server name propagation through dynamic tool parts

All safe patch upgrades — no breaking changes expected.

---

## Third-Party AI SDK Providers

### `@openrouter/ai-sdk-provider` — 2.8.1 → **2.9.0** (minor)

- Fix: allow query strings and fragments in image URL regex
- Fix: allow opting out of `response_format` strict mode
- Fix: stop emitting duplicate tool-call events on trailing-whitespace deltas

Changelog: https://github.com/OpenRouterTeam/openrouter-ai-sdk-provider/releases/tag/2.9.0

### `ai-gateway-provider` — 3.1.2 → **3.1.3** (patch)

- Build tool swap: tsup → tsdown (faster, ESM-first bundler)
- Dependency updates

Changelog: https://github.com/cloudflare/ai/releases/tag/ai-gateway-provider%403.1.3

### `@agentclientprotocol/sdk` — 0.16.1 → **0.21.0** (⚠️ caution)

Spans 8 releases (0.17.0–0.21.0). Significant changes:
- 0.17.0: Schema update to 0.11.3
- 0.18.0: `additionalDirectories` + NES support
- 0.19.0: Initial elicitation support
- 0.20.0: **Stabilized** `closeSession` and `resumeSession`
- 0.21.0: Add `providers/*` support

**⚠️ Since `@agentclientprotocol/sdk` is still on 0.x, the 0.16 → 0.21 bump in the "minor" position may include breaking changes.** Review changelog carefully before upgrading.

Changelog: https://github.com/agentclientprotocol/typescript-sdk/releases

---

## Already at Latest — No Upgrade Needed

| Package | Version | Notes |
|---------|---------|-------|
| `gitlab-ai-provider` | 6.6.0 | Latest |
| `venice-ai-sdk-provider` | 2.0.1 | Latest (`ai` v6 compatible) |

---

## Recommended Action Items

1. **Safe to batch-upgrade** (all patch bumps, deps-only): `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/mistral`, `@ai-sdk/groq`, `@ai-sdk/cohere`, `@ai-sdk/perplexity`, `@ai-sdk/xai`, `@ai-sdk/cerebras`, `@ai-sdk/deepinfra`, `@ai-sdk/togetherai`, `@ai-sdk/vercel`, `@ai-sdk/alibaba`, `@ai-sdk/provider`
2. **Upgrade with review** (has actual changes): `ai`, `@ai-sdk/openai`, `@ai-sdk/amazon-bedrock`, `@ai-sdk/google-vertex`, `@ai-sdk/provider-utils`, `@ai-sdk/gateway`, `@ai-sdk/openai-compatible`, `@ai-sdk/azure`
3. **Review carefully**: `@openrouter/ai-sdk-provider` (minor bump), `@agentclientprotocol/sdk` (0.x 0.16→0.21), `ai-gateway-provider` (build tool change)
