# Provider Auth V2 (RFC)

## Summary

This RFC proposes and documents a **core** OpenCode refactor that adds:

- An **encrypted credential vault** (AES-256-GCM) with atomic writes + lockfile coordination.
- A **multi-credential store** for OAuth subscriptions (and other credential kinds), enabling multiple accounts per provider.
- **Same-request credential rotation** on `HTTP 429` (rate limiting) and refresh-on-`401/403` where supported.
- A single, composable integration point: **fetch-level middleware** (no proxy/sidecar required).

This enables “subscription pools” (user-context OAuth sessions) and “API key mode” (developer credits) to coexist cleanly.

## Goals

- Support **multiple OAuth subscription credentials per provider** (Anthropic, OpenAI, Google, Copilot, Qwen, Cursor).
- On throttling (`429`): **move the credential to the back** of the provider pool, apply cooldown (Retry-After aware), and retry **within the same user request**.
- Keep architecture **DRY and composable** (one auth store, one rotation engine, provider adapters for differences).
- Preserve the ability to use OpenCode via **API keys** (no subscription required).

## Non-goals

- Mid-stream rotation (if the upstream stream fails after tokens are emitted, we surface error; users retry).
- Universal model discovery across all providers (only where the provider exposes it).

## Design

### Credential Vault

- Vault key:
  - Loaded from `OPENCODE_VAULT_KEY` (base64 32 bytes) **or**
  - Generated and persisted to `Global.Path.data/vault.key` (mode `0600`).
  - **Key is stored in `data/` alongside credentials** for backup/restore locality.
- Encryption:
  - `AES-256-GCM` with random nonce per record.
- IO semantics:
  - Atomic writes: write temp + `fsync` + `rename`.
  - Lockfile: prevents concurrent writers from clobbering pool/order state.

**Backup**: Back up the entire `~/.local/share/opencode` (or `$XDG_DATA_HOME/opencode`) directory.
This includes both encrypted credentials and the vault key. Do not back up the key separately from the credentials.

Code:
- `packages/opencode/src/vault/crypto.ts`
- `packages/opencode/src/vault/fs.ts`
- `packages/opencode/src/vault/lock.ts`
- `packages/opencode/src/vault/key.ts`

### Credential Store (multi-account)

Records are stored as:

- `Global.Path.data/credentials/records/<id>.json`
- Each record contains:
  - `meta` (providerId, namespace, label, kind, timestamps, health)
  - `secret` (encrypted blob)

Kinds:
- `oauth` (subscription tokens)
- `api` (API keys)
- `wellknown` (token + env key)
- `mcp` (MCP OAuth entries)

Code:
- `packages/opencode/src/credentials/types.ts`
- `packages/opencode/src/credentials/store.ts`
- `packages/opencode/src/credentials/migrate.ts`

### Provider Adapters (OAuth + header injection)

Adapters provide a single source of truth for:

- OAuth login flows (PKCE browser redirect, device flow, polling flows)
- Applying credentials to outgoing requests (`applyAuth(headers, secret)`)
- Optional refresh (`refresh(secret)`), when the provider supports it

Code:
- `packages/opencode/src/provider-auth/adapter.ts`
- `packages/opencode/src/provider-auth/registry.ts`
- `packages/opencode/src/provider-auth/providers/*`

### Rotation Engine (fetch middleware)

Rotation is implemented as a **fetch wrapper**:

1. Load eligible OAuth credentials for `providerId` + `namespace`
2. Order via a persistent pool
3. Attempt request with selected credential
4. On `429`:
   - update cooldown based on `Retry-After`
   - move credential to back
   - retry in the same request
5. On `401/403`:
   - refresh if supported and refresh token exists
   - retry once

Code:
- `packages/opencode/src/inference/rotating-fetch.ts`
- `packages/opencode/src/credentials/pool.ts`

### Integration Point: Provider.getSDK fetch

Rotation is injected in one place: the AI SDK `fetch` option, in:

- `packages/opencode/src/provider/provider.ts` (`getSDK()`)

This keeps the system composable and provider-agnostic.

### Config

Per provider config controls the auth mode:

```jsonc
{
  "provider": {
    "anthropic": {
      "auth": {
        "mode": "auto",         // auto | api | subscription
        "namespace": "default", // credential namespace
        "maxAttempts": 3        // optional
      }
    }
  }
}
```

- `auto`: use OAuth rotation if credentials exist; otherwise use API key/env.
- `api`: disable OAuth rotation for this provider.
- `subscription`: require OAuth credentials; error early if missing.

Schema:
- `packages/opencode/src/config/config.ts`

### UX (happy path)

- TUI: `Connect a provider` dialog
  - Choose provider → choose auth method (OAuth or API key)
  - OAuth adds a new encrypted record (multi-account)
- CLI:
  - `opencode auth login`
  - `opencode auth list` shows credential records (provider/kind/namespace/label)
  - `opencode auth logout` removes all records for a provider

## Migration

On first run with an empty v2 store:

- `auth.json` → migrated into v2 records (OAuth records become multi-account entries)
- `mcp-auth.json` → migrated into v2 “mcp:” provider records

Code:
- `packages/opencode/src/credentials/migrate.ts`
- Compatibility wrappers:
  - `packages/opencode/src/auth/index.ts`
  - `packages/opencode/src/mcp/auth.ts`

## Testing

Unit tests cover:
- Vault crypto roundtrip
- Store encryption at rest
- Same-request rotation on `429`

Code:
- `packages/opencode/test/credentials/*`
- `packages/opencode/test/inference/rotating-fetch.test.ts`

## Security Considerations

### Key Rotation

If you need to rotate the vault key (e.g., suspected compromise):

1. Export credentials: `opencode auth vault export -o backup.json`
2. Delete the vault key: `rm ~/.local/share/opencode/vault.key`
3. Restart OpenCode (new key will be auto-generated)
4. Re-import credentials: `opencode auth vault import backup.json`
5. Securely delete the backup: `shred -u backup.json`

### Server Deployments

For server/CI deployments, set `OPENCODE_VAULT_KEY` as an environment variable
rather than relying on file-based key storage. This enables secrets management
integration (e.g., Vault, AWS Secrets Manager).
