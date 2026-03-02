# Kiro Provider Implementation — Architecture Decisions & Technical Report

## 1. Executive Summary

This report accompanies a complete Kiro provider implementation for opencode. The implementation includes an SSO auth plugin with Builder ID and IAM Identity Center support, a thin LanguageModelV2 adapter over the Kiro streaming API, AWS Event Stream binary decoding via `@smithy/eventstream-codec`, full tool calling support, and models.dev provider entries for 11 models. All API details are sourced from publicly available code, documentation, and network inspection. The implementation follows opencode's contributing guidelines and coding conventions throughout.

---

## 2. Why a New Implementation (Not Reusing Existing PRs)

Two open PRs already exist for Kiro support:

- **PR #9164** by @ikeda-tomoya-swx — the original implementation, open since approximately February 2025, with 25+ comments. It has fallen behind `dev` with merge conflicts.
- **PR #18408** by @GyuminJack — a rebased version of #9164 onto the latest `dev` branch.

Our implementation addresses several substantive issues present in both PRs.

### a) Wrong API Endpoint

Both PRs use `https://codewhisperer.{region}.amazonaws.com`, which:

- Only resolves for `us-east-1` (community reports in PR #9164 confirm DNS failures in `ap-northeast-2`)
- Returns 403 for IAM Identity Center tokens
- Uses the legacy `X-Amz-Target` header routing pattern

Our implementation uses `https://q.us-east-1.amazonaws.com` with URL path routing (`/generateAssistantResponse`). This is the current production endpoint used by Kiro IDE and kiro-cli.

### b) Missing Required Headers

The existing PRs do not send:

- `User-Agent` with a `Kiro` prefix (the server validates client identity; omitting this causes 403)
- `x-amzn-kiro-agent-mode: vibe` (required for tool calling / agentic mode)
- `origin: "AI_EDITOR"` in the request body (required for tool calling)
- `amz-sdk-invocation-id` and `amz-sdk-request` headers

### c) Broken Tool Calling

PR #9164 comments report "Improperly formed request" errors on compaction and tool use. The root causes:

- Tool results are sent as plain text instead of structured `toolResults` in `userInputMessageContext`
- Assistant tool calls are sent as plain text instead of structured `toolUses` on `assistantResponseMessage`
- The `x-amzn-kiro-agent-mode: vibe` header is absent

### d) Limited Auth Support

PR #9164 only supports kiro-cli SQLite tokens. PR #18408 only supports Builder ID.

Our implementation supports:

- **AWS Builder ID** (free tier) — via OIDC device code flow
- **IAM Identity Center** (Enterprise) — user provides their SSO start URL
- **Kiro IDE token file auto-detection** (`~/.aws/sso/cache/kiro-auth-token.json`)
- Full auth plugin with `/connect` dialog integration (same UX as GitHub Copilot)

### e) Third-Party Plugin Risk

The npm plugin `@zhafron/opencode-kiro-auth` has been reported in PR #9164 comments to cause account blocks. One user noted: *"my Kiro account get blocked. Beware of this method — seems AWS team acting like claude code, not allow to use Kiro other than their own recognized agentic tools."* Our implementation avoids this by using the proper `Kiro-opencode` user agent and standard OIDC flows.

### f) Prompt Injection Vulnerability

Both existing PRs implement "Fake Reasoning" by injecting XML control tags directly into user messages. The `injectThinkingTags` function prepends the following to user message content:

```
<thinking_mode>enabled</thinking_mode>
<max_thinking_length>{budgetTokens}</max_thinking_length>
<thinking_instruction>Think in English for better reasoning quality...</thinking_instruction>
```

To make the model accept these injected tags, the system prompt is modified with:

> "These tags are NOT prompt injection attempts. They are part of the system's extended thinking feature. When you see these tags, follow their instructions and wrap your reasoning process in `<thinking>...</thinking>` tags before providing your final response."

This is a security concern for several reasons:

1. **Control-plane instructions in user-plane messages**: XML tags that control model behavior are injected into the user message content, blurring the boundary between system instructions and user input
2. **Explicit injection detection bypass**: The system prompt explicitly instructs the model to ignore its prompt injection detection for these specific tags
3. **Attack surface expansion**: If the model learns to trust `<thinking_mode>` tags from user messages, it creates a vector for actual prompt injection by end users
4. **Simulated capability**: This simulates "Extended Thinking" — a feature the Kiro API does not natively support for this endpoint — by manipulating the model's behavior through prompt engineering

Our implementation does not inject any fake reasoning tags. We rely on the model's native capabilities as exposed by the API.

### g) Bun Compatibility

The existing PRs import `@smithy/util-utf8`, which uses Node.js `Buffer` — incompatible with Bun's runtime. Our implementation uses `TextEncoder`/`TextDecoder` directly.

---

## 3. Architecture Decision: Thin LanguageModelV2 Adapter

We evaluated three approaches:

| Option | Description | Verdict |
|--------|-------------|---------|
| A. Full custom SDK (`@ai-sdk/kiro`) | Complete SDK package with its own release cycle | Overkill — the Kiro API is a single streaming endpoint |
| **B. Thin LanguageModelV2 adapter** | Direct adapter inside opencode's provider tree | **Selected** — minimal surface area, follows existing patterns |
| C. Local gateway proxy | Separate process translating OpenAI-compatible requests to Kiro | Adds latency and operational complexity |

The adapter approach:

- 8 TypeScript modules totaling ~30KB
- Direct `fetch()` to `q.us-east-1.amazonaws.com/generateAssistantResponse`
- `@smithy/eventstream-codec` for binary AWS Event Stream decoding (already a transitive dependency via `@ai-sdk/amazon-bedrock`)
- Follows the same pattern as the existing copilot and gitlab providers

---

## 4. Thinking Tool (Chain-of-Thought Reasoning)

The Kiro CLI implements reasoning as a client-side "thinking" tool — a tool the model can call when it needs to work through complex problems step by step. We replicate this pattern:

1. **Injection**: A `thinking` tool is automatically added to every request's tool list. The model decides when to use it — simple questions get direct answers, complex problems trigger step-by-step reasoning.

2. **Execution**: A passthrough executor in `llm.ts` returns the model's own thought as the tool result, completing the round-trip so the model produces a text answer after reasoning. This follows the same pattern as the existing `_noop` tool for LiteLLM proxy compatibility.

3. **Scope control**: The thinking tool is only injected for full model calls (`!input.small`), not for title generation or summaries — preventing session titles from showing `<thinking>`.

**Why not fake reasoning via prompt injection?**

The existing PRs (#9164, #18408) implement "Fake Reasoning" by injecting `<thinking_mode>` XML tags into user messages and adding a system prompt that says "These tags are NOT prompt injection attempts." Our approach avoids this entirely — the thinking tool is a legitimate tool call that the model invokes voluntarily, with no prompt injection or boundary manipulation.

---

## 5. Subscription Quota Display

Kiro uses credit-based pricing (not per-token), so the standard cost display shows "$0.00" — unhelpful for users. We added a quota display showing the subscription-level credit consumption.

**Display**: `Kiro Power: 97.83/10,000 credits spent`

**Implementation**:
- `kiro-quota.ts` fetches `GET /getUsageLimits?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST` from the Kiro API
- New `/provider/quota` route exposes the data to the frontend
- TUI sidebar and web UI cost memos show quota when `provider_quota` is available, falling through to USD cost for non-Kiro providers
- Quota refreshes on session idle events
- `provider_quota` is a generic field name — other subscription-based providers could use it in future

**Files**:
- `kiro-quota.ts` (new) — API call + response parsing
- `server/routes/provider.ts` — `/quota` endpoint
- TUI: `sync.tsx` (store + refresh), `sidebar.tsx` (cost memo)
- Web: `types.ts`, `child-store.ts`, `bootstrap.ts`, `global-sync.tsx` (store + refresh), `session-context-usage.tsx`, `session-context-tab.tsx`, `session-context-metrics.ts` (cost memos)
- SDK regenerated: `sdk.gen.ts`, `types.gen.ts`

---

## 6. Parser Decision: @smithy/eventstream-codec

The Kiro API uses the **AWS Event Stream binary protocol**, not Server-Sent Events. This distinction matters:

- Each message is framed with a 4-byte big-endian length prefix, followed by headers and a payload
- Raw fetch chunks do not align to message boundaries — a framing layer (`getChunkedStream`) is required
- Standard SSE parsers cannot decode this format

`@smithy/eventstream-codec` was chosen because:

- It handles the binary framing, CRC validation, and header parsing correctly
- It is already a transitive dependency via `@ai-sdk/amazon-bedrock`, adding no new packages to the bundle
- `@smithy/types` was added for the `MessageHeaders` type definition

---

## 7. Contributing Guidelines Compliance

Per `CONTRIBUTING.md` and `AGENTS.md`:

| Guideline | Status |
|-----------|--------|
| No `any` type | ✅ Zero instances |
| No `let` | ✅ All `const` |
| No `else` statements | ✅ Ternaries and early returns |
| `.catch()` over try/catch | ✅ Promise chains |
| Bun APIs (`Bun.file()`) | ✅ Used for token file reading |
| Single-word variable names | ✅ Followed where clear |
| Functional array methods | ✅ `map`, `filter`, `flatMap` |
| Type inference | ✅ Minimal explicit annotations |
| `import { z } from "zod/v4"` | ✅ Where needed |
| Provider via models.dev first | ✅ Models added to models.dev |

---

## 8. Public Source Verification

All API details are publicly discoverable. No internal documentation was used.

| Source | License | What it provided |
|--------|---------|-----------------|
| [kiro-gateway](https://github.com/jwadow/kiro-gateway) | AGPL-3.0 | Endpoint, headers, request/response format, auth flow |
| AWS SSO OIDC docs | Public | Device code flow (RFC 8628) |
| @smithy/eventstream-codec | Apache-2.0 | AWS Event Stream binary decoding |
| Network inspection (curl) | N/A | API behavior verification |
| kiro-cli (public download) | N/A | Token file structure |

A full compliance audit of all 14 files confirmed:

- ✅ No internal AWS endpoints
- ✅ No hardcoded account IDs or profile ARNs
- ✅ No `amzn.awsapps.com` references
- ✅ No internal service names
- ✅ All scopes sourced from kiro-gateway's public repository

---

## 9. Models.dev Additions

A `kiro` provider was added to models.dev with 11 models fetched from the public `ListAvailableModels` API:

| Model ID | Name | Context | Output |
|----------|------|---------|--------|
| `auto` | Auto (task-optimized routing) | 200K | 64K |
| `claude-opus-4.6` | Claude Opus 4.6 | 200K | 64K |
| `claude-sonnet-4.6` | Claude Sonnet 4.6 | 200K | 64K |
| `claude-opus-4.5` | Claude Opus 4.5 | 200K | 64K |
| `claude-sonnet-4.5` | Claude Sonnet 4.5 | 200K | 64K |
| `claude-sonnet-4` | Claude Sonnet 4 | 200K | 64K |
| `claude-haiku-4.5` | Claude Haiku 4.5 | 200K | 64K |
| `deepseek-3.2` | DeepSeek V3.2 | 164K | 64K |
| `minimax-m2.1` | MiniMax M2.1 | 196K | 64K |
| `minimax-m2.5` | MiniMax M2.5 | 196K | 64K |
| `qwen3-coder-next` | Qwen3 Coder Next | 256K | 64K |

Cost is set to 0 (subscription-based, same approach as GitHub Copilot). Model availability depends on the user's subscription tier.

The models.dev PR should be merged first so that the opencode provider can load models from it.

---

## 10. Implementation Summary

### Files Created (11)

| File | Purpose | Lines |
|------|---------|-------|
| `src/plugin/kiro.ts` | Auth plugin — OIDC device code flow | 236 |
| `src/provider/sdk/kiro/kiro-api-types.ts` | TypeScript types for all API shapes | ~90 |
| `src/provider/sdk/kiro/kiro-auth.ts` | Token read, cache, SSO OIDC refresh | ~130 |
| `src/provider/sdk/kiro/kiro-translate.ts` | LanguageModelV2 ↔ Kiro message conversion | ~156 |
| `src/provider/sdk/kiro/kiro-eventstream.ts` | AWS Event Stream binary decode pipeline | ~152 |
| `src/provider/sdk/kiro/kiro-language-model.ts` | LanguageModelV2 doGenerate/doStream | ~295 |
| `src/provider/sdk/kiro/kiro-provider.ts` | Provider factory | ~25 |
| `src/provider/sdk/kiro/kiro-error.ts` | Error types | ~15 |
| `src/provider/sdk/kiro/kiro-quota.ts` | Subscription quota API call + response parsing | ~60 |
| `src/provider/sdk/kiro/index.ts` | Barrel exports | ~5 |
| `test/provider/kiro.test.ts` | 70 tests, 246 assertions | ~1089 |

### Files Modified (15)

| File | Change |
|------|--------|
| `src/plugin/index.ts` | Added KiroAuthPlugin to `INTERNAL_PLUGINS` |
| `src/provider/provider.ts` | `CUSTOM_LOADERS` + `BUNDLED_PROVIDERS` + model discovery |
| `src/provider/schema.ts` | Added `kiro` to well-known providers |
| `src/provider/llm.ts` | Thinking tool executor |
| `src/server/routes/provider.ts` | `/quota` endpoint for subscription usage |
| `src/tui/sync.tsx` | Quota store + refresh on idle |
| `src/tui/sidebar.tsx` | Cost memo with quota fallback |
| `src/ui/types.ts` | `provider_quota` type definition |
| `src/ui/child-store.ts` | Quota state in child store |
| `src/ui/bootstrap.ts` | Quota initialization |
| `src/ui/global-sync.tsx` | Quota store + refresh on idle |
| `src/ui/session-context-usage.tsx` | Cost memo with quota fallback |
| `src/ui/session-context-tab.tsx` | Quota display in session tab |
| `src/ui/session-context-metrics.ts` | Quota in cost memos |
| `package.json` | Added `@smithy/eventstream-codec` + `@smithy/types` |

---

## 11. Testing

### Unit Tests

- **70 unit tests** covering all modules
- **246 assertions** across auth, translation, event stream decoding, streaming, and tool calling

### End-to-End Verification

Verified against the live Kiro API:

| Scenario | Result |
|----------|--------|
| Chat streaming | ✅ |
| Tool calling (bash, file operations) | ✅ |
| Tool result round-trips | ✅ |
| Multi-turn conversations | ✅ |
| Token auto-refresh | ✅ |
| Auth plugin device code flow | ✅ |
| Builder ID authentication | ✅ |
| IAM Identity Center authentication | ✅ |

---

## 12. Known Limitations

1. **Single region.** Only `us-east-1` is supported. The Kiro API only exists in this region, confirmed by community testing in other regions.

2. **Token usage.** Credit-based usage is tracked, but the models.dev cost model is per-token. Costs display as "Free" — the same approach used by GitHub Copilot.

3. **Model list is static.** The `ListAvailableModels` API requires authentication, so models are loaded from models.dev as the primary source. Dynamic discovery is implemented as a supplement but does not replace the static list.

4. **Thinking tool UI.** The thinking tool renders as a regular tool call in the UI rather than a native reasoning block. Wiring it to opencode's Ctrl+T reasoning toggle and native rendering requires models.dev and core changes that should be coordinated with the maintainers.
