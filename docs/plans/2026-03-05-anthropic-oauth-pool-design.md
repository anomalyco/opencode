# Anthropic OAuth Account Pool — Design

Multi-account OAuth rotation for the `opencode-anthropic-auth` plugin. Spreads Claude Code subscription usage across multiple Pro/Max accounts to avoid overage charges.

## Problem

A single Claude Pro/Max subscription has 5-hour and 7-day usage windows. Heavy usage pushes you into overage (billed at API rates). Multiple subscriptions have independent windows, but opencode only supports one account at a time.

## Approach

Extend the existing `opencode-anthropic-auth` plugin to manage a pool of OAuth accounts. The plugin already wraps `fetch()` with Bearer token injection, tool prefixing, and body sanitization — we add account selection and rotation on top.

This is a plugin-only change. No opencode core modifications needed.

### Why plugin, not core

Multiple community PRs (#8536, #8590, #11832, #13378, #15608) attempted core multi-account support. None have been merged after 1-2 months. The community consensus is converging on a plugin approach. A plugin survives opencode updates and ships today.

## Account Pool Storage

File: `~/.opencode/data/anthropic-pool.json`

```json
{
  "accounts": [
    {
      "label": "personal",
      "refresh": "rt_..."
    },
    {
      "label": "work",
      "refresh": "rt_..."
    }
  ],
  "config": {
    "cooldownMs": 300000,
    "threshold": 0.8
  }
}
```

### Fields

- `label` — user-provided name for display/identification
- `refresh` — OAuth refresh token for this account

Runtime state (in memory, persisted only on account switch or exit):

- `access` — current access token
- `expires` — access token expiration timestamp
- `util5h` — last observed `anthropic-ratelimit-unified-5h-utilization` (0.0–1.0)
- `util7d` — last observed `anthropic-ratelimit-unified-7d-utilization` (0.0–1.0)
- `cooloffUntil` — timestamp until which this account is resting

### Config

- `cooldownMs` (default 300000 / 5 min) — how long to rest an account after a 429
- `threshold` (default 0.80) — utilization above this triggers proactive switch

### Adding accounts

Two options, both external to opencode:

1. **Manual edit** — run `opencode auth login`, copy the refresh token from `~/.opencode/data/auth.json`, paste into the pool file with a label
2. **Standalone script** — `add-account.mjs` runs the same PKCE OAuth flow the plugin uses, prompts for a label, appends to the pool file

## Account Selection

Sticky account with reactive switching. No per-request selection logic.

### Lifecycle

1. **Init:** Load pool file. Set current = first account. Refresh access token if needed.
2. **Normal operation:** Use current account for all requests. No selection on each request.
3. **Response handling:** Read `anthropic-ratelimit-unified-5h-utilization` and `anthropic-ratelimit-unified-7d-utilization` headers. Update in-memory state. Free — headers are on the response object, not in the stream.
4. **Switch triggers:**
   - **429 response** — cooloff current account, switch to next, retry same request
   - **Threshold breach** — `util5h > threshold` or `util7d > threshold` — switch to next (takes effect on next request, no retry)
   - **Auth failure** — 401/403 after token refresh fails — cooloff current, switch to next
5. **Persist:** Write pool file to disk only on account switch or process exit.

### "Next available" selection

When switching, pick the first account (in pool order) that:

1. Is not in cooloff (`Date.now() >= cooloffUntil`)
2. Has `max(util5h, util7d) < threshold`

If none qualify, pick the account with the lowest `max(util5h, util7d)` regardless of threshold. If all are in cooloff, pick the one whose cooloff expires soonest.

## Fetch Wrapper Changes

The existing plugin `fetch()` wrapper does: token refresh, Bearer injection, beta headers, tool name prefixing (`mcp_`), body sanitization (OpenCode → Claude Code), streaming tool name de-prefixing.

Changes are additive:

### What changes

- **Token source:** Bearer token comes from pool state instead of opencode's `auth.json`
- **Response header read:** After each response, read utilization headers into memory
- **Switch + retry:** On 429, switch account and retry the request
- **Proactive switch:** On threshold breach, switch account for subsequent requests

### What stays the same

- Beta header merging (`oauth-2025-04-20`, `interleaved-thinking-2025-05-14`)
- Tool name prefixing/de-prefixing (`mcp_`)
- Body sanitization (OpenCode → Claude Code)
- Streaming `ReadableStream` wrapper
- `?beta=true` query parameter injection

### Streaming

Utilization headers are on the `Response` object, not in the stream body. We read them before returning the wrapped stream. No change to streaming logic.

### Disk I/O

- **Startup:** 1 read
- **Normal operation:** 0 reads, 0 writes
- **Account switch:** 1 write (rare — few times per day)
- **Process exit:** 1 write

## Fallback behavior

If the pool file doesn't exist or is empty, the plugin falls back to its current single-account behavior using opencode's `auth.json`. Existing users are unaffected.

## Related community work

Patterns borrowed from:

- Issue #8591 (OAuth Marathon) — rotating-fetch, cooldown, health tracking
- PR #8536 (andrejvysny) — usage header parsing, per-account utilization
- PR #11832 (mguttmann) — rotating-fetch.ts, credential-manager, event-driven failover
- Issue #29721 (anthropics/claude-code) — unified utilization header documentation
