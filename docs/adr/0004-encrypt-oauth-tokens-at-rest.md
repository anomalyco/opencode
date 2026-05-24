# ADR-0004: Encrypt OAuth access tokens at rest using `SESSION_SECRET`

- Status: Accepted
- Date: 2026-05-21
- Implemented: 2026-05-22 in commit `87e675e74` on branch
  `deploy/auth-fix`.  Decrypt-failure policy = "treat as session not
  found, delete row, WARN-log" — see CONTEXT.md → Cookie
  Authorization Scope.

## Context

The audit found two intersecting facts:

1. **`SESSION_SECRET` is read but never used.**  The only reference in the
   codebase is the config loader:

   ```ts
   // packages/opencode/src/collab/router.ts:355
   sessionSecret: process.env["SESSION_SECRET"] ?? "dev-secret-change-me",
   ```

   A repo-wide grep for `sessionSecret` / `\.sessionSecret` returns only this
   one definition site.  Cookies are opaque random tokens (router.ts:404) and
   nothing in the codebase signs, HMACs, or encrypts anything with the secret.
   `.env.example` and `DEPLOYMENT.md` Step 4 both instruct deployers to
   generate a fresh secret per environment; that ceremony is currently
   theatrical.

2. **GitHub OAuth access tokens are stored plaintext** in
   `collab_auth_session.github_access_token`
   (`packages/opencode/src/collab/schema.sql.ts:127-135`).  Anyone with read
   access to the SQLite file — either via the iframe terminal (ADR-0003) or
   via an EFS snapshot exfiltration — gets every active user's GitHub token
   with the granted `read:org`, `read:user`, `user:email` scopes.

## Decision

Use `SESSION_SECRET` as the master key for a symmetric envelope encryption of
sensitive tokens at rest:

- Derive a per-row data key with HKDF-SHA-256 from `SESSION_SECRET` + a
  row-bound salt (e.g. the session id).
- Encrypt `github_access_token` (and any future at-rest secret — invite
  tokens stay opaque random, no need) with AES-256-GCM; store
  `nonce || ciphertext || tag` in the column.
- Refuse to start when `SESSION_SECRET` is empty or matches the
  `"dev-secret-change-me"` placeholder.
- Add a one-shot migration that rewrites existing plaintext rows on first
  boot after deploy; the migration is idempotent (skips rows already
  ciphertext-shaped) and runs inside the normal startup migration flow at
  `runCollabMigrations()`.

Token plaintext continues to be passed to GitHub API callers in memory; only
at-rest representation changes.

## Consequences

**Positive**

- An EFS snapshot, a SQLite file copy, or read-only access to the data dir is
  no longer sufficient to impersonate users on GitHub.
- `SESSION_SECRET` becomes load-bearing — rotating it (with a documented
  re-encrypt step) actually invalidates the at-rest copy.
- Sets the precedent that any future at-rest secret in the collab tables
  uses the same envelope.

**Negative**

- Adds CPU overhead per cookie lookup (one HKDF + one AES-GCM decrypt).  At
  expected request rates this is sub-millisecond and not on any hot path.
- Backups taken before this lands and restored later need either the previous
  `SESSION_SECRET` or a migration to re-encrypt under the new key.

## Alternatives considered

- **Rely on EFS-at-rest encryption.**  EFS provides AES-256 at rest by default,
  but it protects against AWS-level disk theft, not against an attacker who
  can read the SQLite file through the running container (which is the
  primary threat here).  Rejected as insufficient.
- **Store only short-lived tokens; force re-OAuth more often.**  GitHub OAuth
  user-to-server tokens do not expire by default; forcing re-OAuth every N
  hours hurts UX without removing the underlying weakness.
- **Use AWS KMS as the master key.**  Cleaner key management story but adds a
  cross-service dependency on the hot path; reconsider once the deployment is
  multi-replica.  Until then, keying off `SESSION_SECRET` keeps the
  deployment self-contained.
