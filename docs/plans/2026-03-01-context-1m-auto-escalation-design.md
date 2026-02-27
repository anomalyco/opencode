# Design: Session-Aware Auto-Escalation for 1M Context

## Problem

The branch adds `context-1m-2025-08-07` to the Anthropic `anthropic-beta` header unconditionally (`provider.ts` line 126). This causes HTTP 400 errors for accounts below Tier 4: `"The long context beta is not yet available for this subscription."` It also enables 2× input / 1.5× output pricing for requests exceeding 200K tokens, even when conversations are small.

## Solution

Session-aware auto-escalation: only send the `context-1m-2025-08-07` beta header when the model supports 1M context AND the session actually needs it.

## Config

Add `context1m` to provider options:

```typescript
context1m: z.union([z.literal("auto"), z.boolean()]).optional()
```

```jsonc
// opencode.json
{ "provider": { "anthropic": { "options": { "context1m": "auto" } } } }
```

- `"auto"` (default): enable header only when model supports 1M AND session input tokens exceed 150K
- `true`: always send header for models that support 1M context
- `false`: never send header

## Decision Logic

Three conditions determine whether the header is sent (in `"auto"` mode, all must be true):

1. **Model supports it**: `model.limit.context > 200_000`
2. **Session needs it**: accumulated input tokens > 150K (75% of 200K threshold)
3. **Config allows it**: `context1m !== false`

For `true` mode: only condition 1 is checked.
For `false` mode: never send.

The model's declared `limit.context` is the capability signal. Users who set `limit.context: 1000000` on a model in their config (e.g., `claude-opus-4-6`) are opting in to 1M support for that model. Models with 200K limits (Haiku, older models) never get the header.

## Implementation

### Touch Points

1. **`provider.ts` — Anthropic loader** (CUSTOM_LOADERS, line 126): Remove `context-1m-2025-08-07` from the static beta header string. Keep `claude-code-20250219`, `interleaved-thinking-2025-05-14`, `fine-grained-tool-streaming-2025-05-14`, and `adaptive-thinking-2026-01-28`.

2. **`provider.ts` — Module-level state**: Add a boolean flag and setter for the session layer to communicate with the fetch wrapper.

   ```typescript
   let _context1m = false
   export function setContext1m(enabled: boolean) {
     _context1m = enabled
   }
   ```

3. **`provider.ts` — Fetch wrapper** (in `getSDK()`, ~line 1073): For Anthropic requests (check `model.providerID === "anthropic"` or `model.api.npm === "@ai-sdk/anthropic"`), if `_context1m` is true, append `,context-1m-2025-08-07` to the `anthropic-beta` request header.

4. **`session/llm.ts`** — Before each LLM call: Read the provider config, check the model's context limit, check accumulated session tokens, and call `Provider.setContext1m()`.

   ```typescript
   const config = provider.options?.context1m ?? "auto"
   const supports1m = model.limit.context > 200_000
   const needs1m = lastUsage.tokens.input > 150_000
   Provider.setContext1m(config === true ? supports1m : config === false ? false : supports1m && needs1m)
   ```

5. **`config.ts`** — Provider options schema: Add `context1m` to the options object with the union type.

### Console (`packages/console`)

The console's `anthropic.ts` already conditionally applies the header based on model name (`supports1m = reqModel.includes("sonnet") || reqModel.includes("opus-4-6")`). This is a separate package and can be updated independently to also respect a config option if desired.

## Edge Cases

| Scenario                           | Behavior                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| New session, any model             | No header — safe for all tiers                                                                          |
| Opus 4.6 at 180K tokens, auto mode | Header enabled — can grow to 1M                                                                         |
| Haiku at any token count           | Never gets header (200K context limit)                                                                  |
| Sub-Tier-4, small conversation     | No header — works fine                                                                                  |
| Sub-Tier-4, Opus 4.6 at 180K       | Header enabled, API returns Tier error. Separate fallback work (see below) handles graceful degradation |
| `context1m: false`, any model      | Never sends header, hard 200K limit                                                                     |
| `context1m: true`, Opus 4.6 at 10K | Header sent. No cost impact — premium pricing only triggers when total input >200K                      |
| `context1m: true`, Haiku           | No header — model doesn't support 1M (context limit ≤200K)                                              |

## Related Work

A separate agent is working on runtime fallback for auth/billing errors (`~/.agent-mail/long-context`). That work makes the error recoverable (fall back to another model). Our work prevents the error from occurring in the first place. Both are complementary.

## Pricing Reference

The `context-1m` header alone doesn't change pricing. Premium rates only apply when total input tokens (including cache) exceed 200K:

- Input: 2× standard rate
- Output: 1.5× standard rate
- Cache read/write: proportional increase

This is why auto-escalation saves money — the header is only present when you'd hit the premium tier anyway.
