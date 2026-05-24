# ADR-0008: Dedicated `/healthz`; add rate limits and request-body caps

- Status: Accepted
- Date: 2026-05-21
- Implemented: 2026-05-22.  `/healthz` endpoint in PR #2
  (commit `ed22169b0`); rate limits, body caps, expiresInHours cap,
  and github reachability check in commit `7a9949154` on branch
  `deploy/auth-fix`.

## Context

Two operational gaps showed up during the audit.

**Health check piggybacks on the SPA.**  `docker-compose.yml:49` and the ECS
task definition in `DEPLOYMENT.md` (Step 5, line 181) probe `GET /` and accept
anything under 5xx as healthy:

```js
"command": ["CMD-SHELL", "node -e \"require('http').get('http://localhost:4096/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))\""]
```

`GET /` returns the SPA index HTML (`packages/opencode/src/server/shared/ui.ts:84-101`).
The check only fails when Bun is fully dead; it can't detect:

- The SQLite file being unreadable.
- The collab subsystem failing migrations on startup.
- Outbound network to GitHub being broken.
- The native opencode HttpApi (which the collab executor self-calls) being
  down.

**No rate limits or body-size caps anywhere in `/collab/*`.**  A repo-wide
grep for `rateLimit|throttle` shows nothing in the collab path.  Specifically
unbounded today:

- `POST /collab/auth/github` → `…/callback`: unlimited login attempts.
- `POST /collab/session`: unlimited session creation per user.
- `POST /collab/session/:id/invite`: a Driver can mint unlimited invites; the
  `expiresInHours` parameter is caller-controlled with no upper bound
  (router.ts:963-969, invite.ts:8-32).
- `POST /collab/session/:id/prompt` and `/suggest`: unbounded body length.
  The only body cap in the whole collab router is on `/note` at
  router.ts:1129 (`content.length > 2000`).
- SSE connections: `sseClients.get(...).add(send)` (router.ts:438-440) is an
  unbounded `Set` per session.

## Decision

Introduce `GET /healthz` and a single ingress-rate-limit layer for `/collab/*`.

**`/healthz`** serves a small JSON document:

```jsonc
{ "ok": true,
  "checks": { "db": "ok", "github": "ok", "native_api": "ok" },
  "version": "<git sha>",
  "uptime_s": 1234 }
```

Implementation:

- `db`: open a read-only `SELECT 1` on the SQLite handle.
- `github`: cache a 5-minute result of a HEAD to `https://api.github.com/` —
  do not block the health check on a network call.
- `native_api`: the collab executor already self-calls `/session/...`; reuse
  that auth path with a no-op endpoint.

The ECS health check is moved from `GET /` to `GET /healthz` and treats any
non-200 response as unhealthy.  ALB target group health check follows.

**Rate limits**, in-process via a token bucket keyed by IP (anonymous) or
GitHub user id (authenticated):

| Route | Limit |
|---|---|
| `GET /collab/auth/github`, callback | 10 / min / IP |
| `GET /collab/invite/:token` (the confirmation page from ADR-0002) | 30 / min / IP |
| `POST /collab/session` | 10 / hour / user |
| `POST /collab/session/:id/invite` | 30 / hour / user; `expiresInHours` capped at 72 |
| `POST /collab/session/:id/prompt`, `/suggest` | 60 / min / user; body ≤ 32 KB |
| `POST /collab/session/:id/typing` | 30 / 10 s / user |
| SSE connections | ≤ 5 concurrent per `(session, user)` |

Other state-changing POSTs get a default 60 / min / user bucket.  All
responses on rate-limit hit are HTTP 429 with `Retry-After`.

## Consequences

**Positive**

- ALB can detect partial degradation and roll a replacement task before users
  notice.
- Cuts the abuse surface from "an attacker who got past GitHub OAuth" to a
  manageable per-user budget.
- Body cap on prompts prevents accidental megabyte payloads landing in the
  LLM-token spend column.

**Negative**

- A genuine power user (e.g. an automation script run by an org member) may
  hit a limit and need it lifted; the limit constants live in one config
  file for easy tuning.
- A single-process token-bucket loses state on restart; that is fine for
  these thresholds and avoids a Redis dependency.

## Alternatives considered

- **Health check at the ALB layer only** (no `/healthz`) — rejected: the ALB
  can only HTTP-probe the container; it can't see the SQLite handle's state.
- **Rate limit at the ALB / WAF.**  WAF limits are per-IP and per-CIDR, which
  fights NAT.  Application-layer limits keyed by GitHub id are better
  matched to the threat model.
- **Skip request-body caps because GitHub OAuth gates the API.**  Rejected:
  the user pool is large enough that one compromised account or one bug in
  a client can cost real money in LLM tokens; the cap is cheap insurance.
