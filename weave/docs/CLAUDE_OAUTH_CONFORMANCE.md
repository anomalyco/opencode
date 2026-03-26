# Claude OAuth Conformance Matrix

This matrix tracks OAuth parity requirements for Anthropic Claude Code identity behavior.

## Login lifecycle

- [ ] OAuth login flow succeeds end-to-end (blocked in CI-like environment without `SNYK_TOKEN`/interactive OAuth context).
- [ ] Auth status reflects valid/invalid token state accurately.
- [ ] Logout clears stored credentials.
- [ ] Expired token recovery path is validated.

## Request contract (non-streaming)

- [x] Required OAuth headers are injected for Anthropic OAuth mode.
- [x] Full Claude Code beta set is included.
- [x] Claude Code identity string is prepended to system prompt.
- [x] PascalCase tool naming transform is applied before request dispatch.

## Request contract (streaming)

- [x] Streaming uses the same OAuth header contract as non-streaming.
- [x] Streaming uses the same system prompt identity behavior.
- [x] Streaming uses the same tool-name mapping behavior.

## Tool protocol

- [x] Outbound tool names are PascalCase in OAuth mode.
- [ ] Inbound tool naming round-trip is verified with live Anthropic OAuth calls.
- [ ] Tool result message shape verified against live API expectations.

## Mode isolation

- [x] OAuth-only headers are gated to Anthropic OAuth mode.
- [x] Non-OAuth flows continue using existing provider behavior.

## 2026-03-26 verification notes

- Added/ran `test/session/llm-oauth-contract.test.ts` to assert:
  - Claude Code identity prefix contract is present.
  - Required Anthropic beta header set is present.
  - PascalCase tool transform path is present and wired.
- Remaining unchecked items require live Anthropic OAuth credentials/session for runtime validation.
