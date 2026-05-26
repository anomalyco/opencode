# Unported Provider Logic Checklist

This tracks legacy provider behavior from `packages/opencode/src/provider/provider.ts` that still needs to be ported into the v2 provider plugins under `packages/opencode/src/v2/plugin/provider/`. Keep entries checked only when v2 has equivalent behavior or when the item is intentionally skipped.

## Provider Setup

- [x] Cloudflare AI Gateway custom SDK construction with `createAiGateway` / `createUnified`.
- [x] Google Vertex authenticated `fetch` injection.
- [x] Amazon Bedrock AWS credential chain setup.
- [x] Amazon Bedrock bearer token setup.
- [x] SAP AI Core service key setup.

## Provider Options

- [x] Azure resource name resolution.
- [x] Azure missing-resource error.
- [x] Azure Cognitive Services baseURL resolution.
- [x] Cloudflare Workers AI account ID validation.
- [x] Cloudflare Workers AI account ID vars.
- [x] Cloudflare AI Gateway account ID validation.
- [x] Cloudflare AI Gateway gateway ID validation.
- [x] Cloudflare AI Gateway token validation.
- [x] Amazon Bedrock region precedence.
- [x] Amazon Bedrock profile precedence.
- [x] Amazon Bedrock endpoint precedence.
- [x] Google Vertex project resolution.
- [x] Google Vertex location resolution.
- [x] GitLab instance URL resolution.
- [x] GitLab token resolution.
- [x] GitLab AI gateway headers.
- [x] GitLab feature flags.
- [x] Opencode unauthenticated paid-model filtering.
- [x] Opencode public API key fallback.

## Request Behavior

- [x] Request timeout handling.
- [x] Chunk timeout handling.
- [x] SSE timeout wrapping.
- [x] OpenAI response item ID stripping.
- [x] Azure response item ID stripping.
- [x] OpenAI-compatible `includeUsage` defaulting.

## Dynamic Models

- [ ] GitLab workflow model discovery.

## Model Filtering

- [ ] Experimental alpha model filtering.
- [ ] Deprecated model filtering.
- [ ] Config whitelist filtering.
- [ ] Config blacklist filtering.
- [ ] `gpt-5-chat-latest` filtering.
- [ ] OpenRouter `openai/gpt-5-chat` filtering.

## Default Models

- [x] Configured default model selection. Replaced by explicit `Catalog.model.setDefault`.
- [SKIP] Recent-history default model selection — not porting to server-side v2 catalog.
- [x] Default model fallback sorting. Uses newest available model, not legacy hard-coded priority.

## Small Models

- [SKIP] Configured `small_model` selection — not porting config-driven selection to server-side v2 catalog.
- [x] Provider-specific small model priority. Replaced by cheapest output cost selection.
- [x] Opencode small model priority. Replaced by cheapest output cost selection.
- [x] GitHub Copilot small model priority. Replaced by cheapest output cost selection.
- [x] Amazon Bedrock region-aware small model selection. Replaced by cheapest output cost selection.

## URL And Env Vars

- [SKIP] BaseURL `${VAR}` interpolation — not porting generic URL templating; provider plugins should construct concrete URLs.
- [x] Azure `AZURE_RESOURCE_NAME` vars. Handled by Azure provider plugins.
- [x] Google Vertex vars. Handled by Google Vertex provider plugins.
- [x] Cloudflare Workers AI vars. Handled by Cloudflare Workers AI provider plugin.

## Auth

- [ ] Auth-derived provider API keys.
- [ ] OpenAI OAuth/API auth distinction.
- [ ] GitLab OAuth token selection.
- [ ] GitLab API token selection.
- [ ] Azure auth metadata resource name.
- [ ] Cloudflare auth metadata account ID.
- [ ] Cloudflare auth metadata gateway ID.

## Config And Plugin Parity

- [ ] Legacy plugin auth loader behavior.
- [ ] Config provider merge behavior.
- [ ] Config model merge behavior.
- [ ] Variant generation from model metadata.
- [ ] Config variant merge behavior.
- [ ] Config variant disable behavior.
