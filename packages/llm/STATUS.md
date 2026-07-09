# LLM Provider Parity Status

Last reviewed: 2026-07-08

This file tracks the gap between the native `@opencode-ai/llm` package and the AI SDK provider packages that opencode still depends on for many catalog/runtime paths.

## Existing Status Sources

| File | What it tracks | Limitation |
| --- | --- | --- |
| `packages/llm/DESIGN.md` | Future clean-break API proposal, currently named `@opencode-ai/ai` in the draft. | Not a provider parity tracker. |
| `packages/llm/example/call-sites.md` | Route/value/provider-facade migration checklist and call-site sketches. | Architecture migration only; not AI SDK package parity. |
| `specs/v2/provider-model.md` | V2 catalog endpoint schema and current Session runner adaptation surface. | Runner-specific; not a native LLM package status matrix. |

## Current Implementation Snapshot

| Native slice | Source | Current state | Main gaps |
| --- | --- | --- | --- |
| OpenAI Chat | `src/protocols/openai-chat.ts`, `src/providers/openai.ts` | Usable. Streams text, reasoning deltas, tool calls, usage, images, and common generation controls. | No typed structured-output / `response_format` path. Limited typed OpenAI option surface compared with SDK escape hatches. |
| OpenAI Responses HTTP | `src/protocols/openai-responses.ts`, `src/providers/openai.ts` | Usable. Supports hosted-tool event surfacing, reasoning replay metadata, GPT-5 defaults, and cache usage. | No explicit `previous_response_id` path. Typed options cover only a subset of Responses fields. Structured output is still mostly synthetic-tool based. |
| OpenAI Responses WebSocket | `src/protocols/openai-responses.ts`, `src/route/transport/websocket.ts` | Present as `OpenAI.responsesWebSocket(...)`. | Runner/catalog support explicitly must not downgrade WebSocket routes; broader runtime selection is not complete. |
| OpenAI-compatible Chat | `src/protocols/openai-compatible-chat.ts`, `src/providers/openai-compatible.ts` | Usable for generic Chat and several profiles: Baseten, Cerebras, DeepInfra, DeepSeek, Fireworks, Groq, TogetherAI. | No OpenAI-compatible Responses protocol/facade. Family quirks are mostly endpoint defaults, not full typed behavior. |
| Anthropic Messages | `src/protocols/anthropic-messages.ts`, `src/providers/anthropic.ts` | Usable. Supports tools, thinking, cache control, images, server-hosted tool events, and usage. | Provider option surface is small. Beta/header handling, metadata, and newer Messages fields need a typed parity pass. |
| Gemini Developer API | `src/protocols/gemini.ts`, `src/providers/google.ts` | Usable for Google API key flow. Supports text, images, tools, thinking signatures, and cache usage. | This is not Vertex. Typed provider options are narrow; many Gemini request fields currently require raw `http.body` overlays. |
| Bedrock Converse | `src/protocols/bedrock-converse.ts`, `src/providers/amazon-bedrock.ts` | Partial but real. Supports AWS event-stream framing, SigV4 with supplied credentials, bearer auth, tools, reasoning signatures, media, cache points, and recorded tests. | Native facade does not mirror the AI SDK plugin's default AWS credential chain/profile behavior. Runner/catalog mapping is missing. Guardrails, inference profiles, region-specific model ID fixes, and model-specific request fields need a parity pass. |
| Azure OpenAI | `src/providers/azure.ts` using OpenAI Chat/Responses protocols | Partial. Supports resource/base URL setup, API key auth, API version query, Chat, and Responses selectors. | Core runner does not map `@ai-sdk/azure` to this native facade. AAD/token auth and Azure-specific endpoint variants need review. |
| Cloudflare AI Gateway / Workers AI | `src/providers/cloudflare.ts` | Present via OpenAI-compatible Chat routes. | Useful but not part of the critical AI SDK replacement set yet. Needs per-product recorded coverage before relying on it broadly. |
| OpenRouter | `src/providers/openrouter.ts` | Present with OpenRouter-specific usage/reasoning/prompt-cache options over Chat. | Responses-style OpenRouter support is absent. |
| xAI | `src/providers/xai.ts` | Present with Responses and Chat selectors. | Needs package-parity review against the AI SDK xAI provider. |
| GitHub Copilot | `src/providers/github-copilot.ts` | Present as explicit-base-URL OpenAI Chat/Responses facade. | Runtime/catalog integration remains specialized and should stay separate from public OpenAI-compatible defaults. |

## V2 Runner Status

`packages/core/src/session/runner/model.ts` currently resolves only this native subset from catalog `aisdk` metadata:

| Catalog API | Native route used today |
| --- | --- |
| `aisdk:@ai-sdk/openai` | `OpenAIResponses.route` |
| `aisdk:@ai-sdk/anthropic` | `AnthropicMessages.route` |
| `aisdk:@ai-sdk/openai-compatible` with explicit URL | `OpenAICompatibleChat.route` |

Everything else currently fails with `SessionRunnerModel.UnsupportedApiError` when the V2 native runner tries to resolve it. This includes `@ai-sdk/google`, `@ai-sdk/google-vertex`, `@ai-sdk/google-vertex/anthropic`, `@ai-sdk/azure`, `@ai-sdk/amazon-bedrock`, and `@ai-sdk/amazon-bedrock/mantle`.

## AI SDK Package Parity Matrix

| AI SDK package | Intended native target | Status | Biggest gaps |
| --- | --- | --- | --- |
| `@ai-sdk/openai` | `OpenAI.chat`, `OpenAI.responses`, `OpenAI.responsesWebSocket` | Partial / usable | Add complete typed option coverage, structured output strategy, explicit Responses continuation support, and runner route selection between Chat/Responses/WebSocket. |
| `@ai-sdk/openai-compatible` | Generic OpenAI-compatible Chat plus future Responses | Partial | Add OpenAI-compatible Responses. Decide per-family namespace/profile behavior for providers that support Responses versus Chat only. |
| `@ai-sdk/anthropic` | `AnthropicMessages` | Partial / usable | Finish Messages API parity for headers/betas/metadata/newer fields and document hosted-tool continuation expectations. |
| `@ai-sdk/google` | Gemini Developer API | Partial / usable | Add typed options for safety, response schema/modalities, cached content, grounding/search/code execution, and non-text output modes where supported. |
| `@ai-sdk/google-vertex` | Vertex Gemini namespace/facade | Missing | Implement Vertex endpoint derivation, ADC/OAuth auth, project/location/env resolution, OpenAI-compatible Vertex endpoint handling, and runner/catalog mapping. |
| `@ai-sdk/google-vertex/anthropic` | Anthropic Messages over Vertex namespace/facade | Missing | Implement Vertex Anthropic endpoint/auth selection, regional endpoint behavior, and compatibility with Anthropic Messages lowering/parsing. |
| `@ai-sdk/azure` | Azure OpenAI Chat/Responses facade | Partial | Map runner/catalog metadata to native Azure, handle resourceName/baseURL/apiVersion variants, add AAD/token auth story, and verify Chat vs Responses deployment selection. |
| `@ai-sdk/amazon-bedrock` | Bedrock Converse | Partial | Add default AWS credential chain/profile support, region/inference-profile model ID handling, provider option parity via `additionalModelRequestFields`, guardrails/performance config, and runner/catalog mapping. |
| `@ai-sdk/amazon-bedrock/mantle` | Bedrock Mantle OpenAI-compatible Chat/Responses namespace | Missing | Decide native Mantle shape, likely separate from Converse because it uses OpenAI-compatible Chat/Responses semantics over Bedrock. Add package mapping and tests. |

## Highest-Risk Gaps

1. Runner support is narrower than the LLM package. The package has native provider facades for Google, Azure, and Bedrock, but the V2 Session runner only maps OpenAI, Anthropic, and explicit OpenAI-compatible Chat from `aisdk` catalog metadata.
2. OpenAI-compatible is Chat-only. We need a separate OpenAI-compatible Responses slice for providers/deployments that expose `/responses`, not an overloaded Chat route.
3. Bedrock native auth is not AI SDK parity. The AI SDK plugin uses the default AWS provider chain, profile, container credentials, and Bedrock bearer token env behavior. Native Bedrock currently expects explicit credentials or bearer auth on the facade.
4. Vertex is not implemented natively. Google Gemini Developer API exists, but Vertex Gemini and Vertex Anthropic are separate auth/endpoint products and should be separate namespaces/facades.
5. Azure is only a provider facade, not a full runtime replacement. Native Azure exists, but the catalog runner does not select it, and token auth/resource variants need review.
6. Provider option typing is uneven. OpenAI, Anthropic, Gemini, Bedrock, and OpenRouter each expose a small typed subset plus raw HTTP overlays; this is useful but not equivalent to AI SDK provider option coverage.
7. Structured output is not provider-native yet. `LLM.generateObject` still uses a synthetic tool strategy, while the future design expects native structured output where reliable and tool fallback where needed.
8. Package/namespace boundaries for the current native loading set are explicit in docs and exports. Other exported provider facades are not catalog package entrypoints until they implement the contract. Missing native API boundaries remain for OpenAI-compatible Responses, Vertex Gemini, Vertex Anthropic Messages, and Bedrock Mantle.
9. Recorded coverage is uneven. OpenAI, Anthropic, Gemini, Bedrock Converse, Cloudflare, OpenRouter, and several OpenAI-compatible Chat providers have cassettes. Azure, Vertex, and Mantle need first-class recorded scenarios before switching defaults.

## Native Namespace Shape

These are implementation/API slices, not separate npm packages.

| API slice | Package-like entrypoint | Purpose |
| --- | --- | --- |
| OpenAI Chat | `@opencode-ai/llm/providers/openai/chat` | OpenAI `/chat/completions` semantics. |
| OpenAI Responses | `@opencode-ai/llm/providers/openai/responses` | OpenAI `/responses` semantics with HTTP/WebSocket selected through settings. |
| OpenAI-compatible Chat | `@opencode-ai/llm/providers/openai-compatible` | Generic OpenAI-compatible `/chat/completions`. |
| OpenAI-compatible Responses | Missing | Generic OpenAI-compatible `/responses`. |
| Anthropic Messages | `@opencode-ai/llm/providers/anthropic` | Anthropic Messages API. |
| Gemini Developer API | `@opencode-ai/llm/providers/google` | Google AI Studio Gemini API. |
| Vertex Gemini | Missing | Vertex Gemini API. |
| Vertex Anthropic Messages | Missing | Vertex-hosted Anthropic Messages API. |
| Bedrock Converse | `@opencode-ai/llm/providers/amazon-bedrock` | AWS Bedrock Converse API. |
| Bedrock Mantle | Missing | AWS Bedrock Mantle OpenAI-compatible APIs. |
| Azure OpenAI Chat | `@opencode-ai/llm/providers/azure/chat` | Azure specialization of OpenAI Chat. |
| Azure OpenAI Responses | `@opencode-ai/llm/providers/azure/responses` | Azure specialization of OpenAI Responses. |

## Suggested Next Work Slices

1. Add native runner/catalog mappings for `@ai-sdk/azure`, `@ai-sdk/google`, and `@ai-sdk/amazon-bedrock` where the existing native facades are already close.
2. Implement `OpenAICompatibleResponses` as a separate protocol/route/facade instead of extending Chat.
3. Bring Bedrock native auth/config to AI SDK parity: region, profile, default AWS credential chain, bearer token env, endpoint override, and cross-region inference profile handling.
4. Add Vertex Gemini and Vertex Anthropic native facades with ADC/OAuth auth and project/location endpoint derivation.
5. Add Bedrock Mantle as a separate OpenAI-compatible Bedrock namespace after deciding whether it uses Chat, Responses, or both by model.
6. Expand typed provider options from the existing V1 lowerer knowledge in `packages/core/src/v1/config/provider-options.ts` before adding more raw overlay examples.
7. Add recorded provider tests for Azure, Vertex Gemini, Vertex Anthropic, Bedrock credential-chain behavior, and Mantle before making native runtime the default for those packages.
