# ADR-0002: Cookie, CSRF, and OAuth-state hardening

- Status: Proposed (partial: cookie TTL reduced to 24h on 2026-05-24)
- Date: 2026-05-21

## 2026-05-24 — cookie TTL reduced

`collab_sid` cookie Max-Age is now 24 hours (was 7 days).  Same stale-
membership window as before, just narrower — a user removed from the
GitHub org keeps access for at most 24 h instead of a week.  Live
re-check of org membership on every request remains a future option
documented elsewhere in this ADR.  See `COOKIE_TTL_SECONDS` in
`packages/opencode/src/collab/router.ts`.

## Context

The collab auth layer has several small but compounding weaknesses surfaced by
the security audit:

1. **Cookies lack the `Secure` flag.**  `packages/opencode/src/collab/router.ts:418-422`
   writes the session cookie as:

   ```ts
   header: `collab_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
   ```

   No `Secure`.  Same for `collab_oauth_state`, `collab_pending_invite`, and
   `collab_next` (router.ts:487, 755, 761, 715-717).  Any plain-HTTP redirect
   or misconfigured ALB listener leaks the cookie.

2. **No CSRF token on state-changing POST/DELETE/PUT routes** (router.ts:840,
   921, 961, 975, 1001, 1039, 1056, 1069, 1091, 1122, 1158, 1175, 1188, 1201).
   Defence relies entirely on `SameSite=Lax`.

3. **Invite redemption is a GET** (`GET /collab/invite/:token`, router.ts:735).
   `SameSite=Lax` permits top-level cross-site navigation, so any link from an
   external site silently adds the click-throughing user to a session as
   whatever role the invite encodes.  There is no confirmation page.

4. **OAuth `state` comparison is not constant-time.**

   ```ts
   // router.ts:622-629
   if (!cookieState || cookieState !== state) { … return 400 }
   ```

   Invite-token lookup (`packages/opencode/src/collab/invite.ts:34-49`) uses
   Drizzle `eq`, which translates to byte-wise SQL `=`.  SQLite is local so
   timing risk is largely theoretical, but constant-time compare is a cheap
   uniform policy worth adopting now rather than later.

5. **Generic 500 handler dumps full stack traces to stdout → CloudWatch**
   (router.ts:458-463).  Any unexpected error path that includes request bodies
   or env values in its message lands in logs.

## Decision

Apply a single, coherent hardening pass:

- Add `Secure` to every `Set-Cookie` header emitted by collab when
  `OPENCODE_BASE_URL` starts with `https://`.  Strip it (and only it) when the
  base URL is `http://localhost…` to preserve local dev.
- Tighten the session cookie's `SameSite` to `Strict` for the `collab_sid`
  cookie.  The OAuth state and `pending_invite` cookies stay `Lax` because the
  callback redirect from GitHub is the legitimate cross-site context for them.
- Introduce a **double-submit CSRF token** on state-changing routes: server
  sets `collab_csrf=<random>` (non-HttpOnly, `SameSite=Strict`) at session
  establishment; client echoes it in an `X-Collab-CSRF` header on every
  non-GET request; server rejects mismatches with 403.
- **Invite redemption becomes a POST** behind a one-click confirmation page
  served at `GET /collab/invite/:token` (the GET shows the role, expiry, and a
  "Join session" button; the POST mutates state).
- Replace `===` comparisons of OAuth `state` and invite tokens with
  `crypto.timingSafeEqual` after length-checking both sides.
- Wrap the generic 500 handler so it logs an opaque `errorId` to stdout and
  emits stack traces only at DEBUG log level, gated by an env var.

## Consequences

**Positive**

- Defence-in-depth against TLS misconfiguration, cookie leakage, XSS-derived
  CSRF, social-engineering invite redemption, and log-exfil.
- Aligns with OWASP standard practice for cookie attributes.
- Makes future security review (e.g. external pen test) materially shorter.

**Negative**

- Client code in `packages/app/*` must read the CSRF cookie and add the
  header to every fetch.  ~10 LOC at the fetch wrapper.
- The extra confirmation page on invite redemption adds one click for legitimate
  users; this is the same flow GitHub uses for organisation invites.
- A misconfigured ALB that downgrades to HTTP would now log the user out
  (cookie not sent); that is the desired failure mode.

## Alternatives considered

- **Cookie binding to client IP** — rejected: corporate NAT and mobile network
  hand-off break it.
- **Per-request signed nonces in URL** instead of a CSRF cookie — rejected:
  more invasive, requires every link/button rewrite.
- **Encrypted JWT session cookies** instead of opaque tokens — rejected: the
  current opaque-token + DB lookup approach lets us revoke a session
  immediately by deleting a row.  JWTs require either short expiry or a
  revocation list, neither of which is an upgrade here.
