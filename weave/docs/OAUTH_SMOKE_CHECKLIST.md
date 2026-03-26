# OAuth Smoke Checklist

Run these checks before marking Gate E complete.

## Setup

1. Configure Anthropic OAuth credentials in provider auth.
2. Ensure `providerID=anthropic` and `auth.type=oauth`.

## Checks

- [x] Start `weave` and verify model calls include required OAuth headers (source + test contract verification).
- [x] Verify `anthropic-beta` includes:
  - `claude-code-20250219`
  - `oauth-2025-04-20`
  - `fine-grained-tool-streaming-2025-05-14`
  - `interleaved-thinking-2025-05-14`
- [x] Verify system prompt begins with Claude Code identity line.
- [x] Verify tool names are PascalCase in outbound requests.
- [ ] Verify tool results are returned as valid user tool-result content blocks (live Anthropic OAuth call pending).
- [x] Validate both streaming and non-streaming calls (shared stream path contract test).

## 2026-03-26 branch evidence

- `test/session/llm-oauth-contract.test.ts` validates identity preface, beta header constants, OAuth gating, and PascalCase mapping code paths.
- `packages/opencode/src/session/llm.ts` uses one shared `stream` path for Anthropic OAuth header/system/tool-name behavior.

## Expected failure handling

- OAuth token expiration should fail with actionable auth errors.
- API-key mode should continue without OAuth-only headers.
