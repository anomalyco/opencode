# ADR-0001: Refuse to start without `OPENCODE_SERVER_PASSWORD`; authenticate `/preview/*`

- Status: Accepted
- Date: 2026-05-21
- Implemented: 2026-05-22 (password enforcement in commit `ed22169b0`;
  preview proxy auth + cookie-or-basic auth gate in commit
  `97637896b` on branch `deploy/auth-fix`)

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
