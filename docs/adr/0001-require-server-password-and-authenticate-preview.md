# ADR-0001: Refuse to start without `OPENCODE_SERVER_PASSWORD`; authenticate `/preview/*`

- Status: Accepted (Phase 3: per-collab-session internal token for executor self-fetches)
- Date: 2026-05-21
- Implemented: 2026-05-22 (password enforcement in commit `ed22169b0`;
  preview proxy auth + cookie-or-basic auth gate in commit
  `97637896b` on branch `deploy/auth-fix`)
- Phase 2 amended: 2026-05-24 — `OPENCODE_AUTH_MODE=collab` makes the
  OAuth cookie the sole gate.  Basic auth is OFF in the utils deployment;
  preserved in the codebase for `opencode serve` localhost users.
- Phase 3 amended: 2026-05-25 — collab executor's self-fetches to the
  native HttpApi authenticate with a per-collab-session internal token
  instead of the shared server password.

## Phase 3 — per-collab-session internal token (utils deployment)

Phase 2 removed `OPENCODE_SERVER_PASSWORD` from the utils task definition.
That exposed a regression: the collab executor's self-fetches into the
native HttpApi (via `nativeFetch` → `localhost:4096/session/*`) had been
relying on `ServerAuth.headers()` returning a basic-auth header sourced
from that password.  With the password gone, the header was `undefined`,
the middleware's cookie-only branch fell through to `"fallthrough"`,
collab mode mapped that to `deny`, and the executor's `POST /session?…`
calls returned 401:

```
[collab] failed to create native session: 401
```

The fix replaces the shared-secret basic-auth header with a **per-collab-
session internal token**:

- `packages/opencode/src/collab/internal-token.ts` owns an in-memory
  `Map<collabSessionId, token>` that mints lazily and revokes on session
  delete.  Tokens are 32-byte random hex strings; comparisons go through
  `timingSafeEqual`.  The map is process-local and never persisted.
- `nativeFetch` accepts an optional `collabSessionId` field on its init
  object.  When present, it attaches `x-opencode-internal-token: <token>`
  and `x-opencode-collab-session: <id>` headers.
- Both auth middlewares (`validateCredential` for HttpApi handlers and
  `authorizationRouterMiddleware` for the router layer) short-circuit on
  a valid internal-token header pair, ahead of cookie + basic-auth.
- The token never crosses a network boundary — it travels exclusively
  between `nativeFetch` and `fetch(localhost:4096/…)` inside the same
  container.  Loss on process restart is fine: the next call re-mints.

Scoping the token per collab session (rather than one process-wide
internal token) bounds the blast radius if a token ever leaked: it grants
access only to the workspace and native session owned by that one collab
session.  `revokeInternalToken(collabSessionId)` runs in the
`DELETE /collab/session/:id` handler so deleted sessions can't be
impersonated either.

Legacy basic-auth still works when `OPENCODE_SERVER_PASSWORD` is set —
`nativeFetch` attaches both headers when both apply.  This keeps the
non-collab `opencode serve` deployments untouched.

## Phase 2 — collab-cookie universal auth (utils deployment)

The cookie-or-basic gate (commit `97637896b`) closed the leak but left
basic auth as the universal mechanism, which means:

- The browser's native basic-auth dialog fires on any HttpApi 401, fighting
  the OAuth flow.
- The server password is the actual security boundary; OAuth + org check
  is a convenience layer on top.

`OPENCODE_AUTH_MODE=collab` flips both:

- `cookieAuthorizesRequest`'s `"fallthrough"` decision is treated as
  `"deny"` by middlewares — no basic-auth fallback.
- The deny response **never** includes `www-authenticate: Basic`, so the
  browser doesn't pop its native dialog.
- HTML navigations (`Accept: text/html` or `Sec-Fetch-Mode: navigate`) get
  `302 → /collab/auth/github?next=<encoded path>`; everything else gets
  `401 application/json {"error":"Unauthorised"}`.
- `serve.ts` fail-fast requires either `OPENCODE_SERVER_PASSWORD` OR
  `OPENCODE_AUTH_MODE=collab` in production.

The cookie scope rules from Phase 1 still apply (workspace-addressed and
native-session-addressed requests must come from a participant of the
collab session that owns the workspace), with one addition for the
"iframe only after repository selection" requirement:

- A workspace- or native-session-scoped request to a collab session with
  **zero linked repos** is denied.  The SPA's `/collab/<id>` page renders
  a recovery panel where a Driver can `PATCH /collab/session/<id>` with
  repos to fix it without re-creating the session.

In the utils deployment this replaces basic auth entirely; the Terraform
task definition drops `OPENCODE_SERVER_PASSWORD` from `secrets` and adds
`OPENCODE_AUTH_MODE=collab` to `environment`.  Cookie TTL was reduced
from 7 days to 24 hours in the same change (ADR-0002 update).

## Context

The deployed configuration described in `DEPLOYMENT.md` (Part B, Step 5) sets no
`OPENCODE_SERVER_PASSWORD` environment variable.  Two consequences follow that
the deployment doc does not call out:

1. **The whole opencode HttpApi is publicly reachable without authentication.**
   `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts:92-108`
   delegates to `ServerAuth.required(config)`; that function returns `false`
   when no password is set (`packages/opencode/src/server/auth.ts:24-26`).  The
   `serve` command prints a warning and continues:

   ```ts
   // packages/opencode/src/cli/cmd/serve.ts:15-17
   "Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured."
   ```

   Anyone who can reach `https://collab.unleashlive.com` can create sessions,
   submit prompts to any directory under `directory=…`, run shell commands via
   the PTY, and read or write any file the container can see.  Collab cookie
   auth only protects the `/collab/*` paths; everything else is open.

2. **`/preview/<port>/*` exists today and is also unauthenticated.**  The
   deployment doc (Part A) states the preview proxy will be added in v2 and
   defers it from v1.  In fact the proxy is already in the codebase:
   `packages/opencode/src/collab/preview-router.ts:34-43, 50-118, 129-183` —
   handled by `collabMiddleware` (`packages/opencode/src/server/server.ts:32-55`)
   **before** any auth check.  The author comment at `preview-router.ts:17-22`
   acknowledges the trust assumption (*"anyone with collab access has
   effectively shell-level trust on the workspace already"*) but the proxy
   itself never validates that the caller has collab access — any internet
   client can hit `/preview/<port>/` and reach any TCP listener bound to
   `127.0.0.1:<port>` inside the container.

Together these mean the ECS service as documented runs an open shell-as-a-service
behind the public ALB.

## Decision

The server **MUST refuse to start in production mode** when
`OPENCODE_SERVER_PASSWORD` is missing or empty.  A new mode flag
(`OPENCODE_ALLOW_UNAUTHENTICATED=1`) becomes the explicit override for local
dev, the existing `serve.ts` warning is upgraded to a hard error otherwise.

The `/preview/<port>/*` proxy **MUST require a valid collab session cookie**
and **MUST verify the caller is a participant of an active collab session that
owns the workspace at `127.0.0.1:<port>`**.  The proxy gate is moved to run
after `getSession()` resolves and rejects with HTTP 403 otherwise.  WebSocket
upgrades validate the same cookie before completing the handshake.

DEPLOYMENT.md is updated to mark the password as required (not optional) and
to remove the "v1 ships without preview" claim.

## Consequences

**Positive**

- Closes the largest attack surface in the deployed configuration.
- Forces deployers to make a conscious choice about who can reach the API.
- Aligns the iframe-terminal trust model (`preview-router.ts:17-22`) with the
  actual reachability of the proxy.

**Negative**

- Local docker-compose users who never set the password will see the container
  fail to start; mitigated by the `OPENCODE_ALLOW_UNAUTHENTICATED=1` flag in
  `docker-compose.yml`.
- The self-fetch from the collab executor (`router.ts:188, 296, 331`) must
  also carry the password header; this is a small code change.
- Preview proxy adds one DB lookup per request (cheap; same lookup the rest
  of `/collab/*` does).

## Alternatives considered

- **Network-level isolation only** (private subnet, VPN, no public ALB).
  Rejected because the project goal is a public collab site reachable by GitHub
  org members; we cannot rely on network position for auth.
- **Path-based ALB allowlist** rejecting `/preview/*` at the ALB.  Rejected:
  preview is a feature, not an accident — we want it gated, not removed.
- **Leave password optional, document the warning.**  Rejected: the warning is
  in stderr only, easy to miss, and the resulting exposure is total.
