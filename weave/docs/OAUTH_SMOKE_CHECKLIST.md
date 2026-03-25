# OAuth Smoke Checklist

Run these checks before marking Gate E complete.

## Setup

1. Configure Anthropic OAuth credentials in provider auth.
2. Ensure `providerID=anthropic` and `auth.type=oauth`.

## Checks

- [ ] Start `weave` and verify model calls include required OAuth headers.
- [ ] Verify `anthropic-beta` includes:
  - `claude-code-20250219`
  - `oauth-2025-04-20`
  - `fine-grained-tool-streaming-2025-05-14`
  - `interleaved-thinking-2025-05-14`
- [ ] Verify system prompt begins with Claude Code identity line.
- [ ] Verify tool names are PascalCase in outbound requests.
- [ ] Verify tool results are returned as valid user tool-result content blocks.
- [ ] Validate both streaming and non-streaming calls.

## Expected failure handling

- OAuth token expiration should fail with actionable auth errors.
- API-key mode should continue without OAuth-only headers.
