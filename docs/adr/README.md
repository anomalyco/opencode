# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) for the
unleashlive/opencode collab fork.  Per `CONTEXT.md`, an ADR belongs here when a
decision is **hard to reverse**, **surprising without context**, and the
**result of a real trade-off**.

The current set was triggered by a security and operational audit of
`DEPLOYMENT.md` (the AWS ECS deployment for `https://collab.unleashlive.com`).
Each ADR cites the evidence that motivated it with `file:line` references into
the codebase as of the audit.

## Status legend

- **Proposed** — drafted, not yet accepted by the team
- **Accepted** — ratified; implementation may or may not be done
- **Superseded** — replaced by a later ADR (link forward)

## Index

### Security

| ID | Title | Status |
|---|---|---|
| [0001](0001-require-server-password-and-authenticate-preview.md) | Refuse to start without `OPENCODE_SERVER_PASSWORD`; authenticate `/preview/*` | Proposed |
| [0002](0002-authentication-transport-hardening.md) | Cookie, CSRF, and OAuth-state hardening | Proposed |
| [0003](0003-non-root-container-and-capability-drop.md) | Run the container as a non-root user with dropped capabilities | Proposed |
| [0004](0004-encrypt-oauth-tokens-at-rest.md) | Encrypt OAuth access tokens at rest using `SESSION_SECRET` | Proposed |
| [0005](0005-github-app-installation-tokens.md) | Replace static PAT-in-clone-URL with GitHub App installation tokens | Proposed |

### Improvements

| ID | Title | Status |
|---|---|---|
| [0006](0006-queue-dispatch-compare-and-swap.md) | Move queue serialization from in-process locks to DB compare-and-swap | Proposed |
| [0007](0007-background-gc-for-collab-tables.md) | Background GC for `collab_auth_session`, `collab_invite`, and abandoned workspaces | Proposed |
| [0008](0008-healthz-rate-limits-and-body-caps.md) | Dedicated `/healthz`; add rate limits and request-body caps | Proposed |
| [0009](0009-single-replica-contract-and-postgres-path.md) | Single-replica deployment is the contract; document the Postgres path to multi-replica | Proposed |

## Format

ADRs in this repo follow a MADR-lite template:

```
# ADR-NNNN: Title
- Status: Proposed | Accepted | Superseded
- Date: YYYY-MM-DD

## Context
What forces the decision; cite file:line evidence.

## Decision
The decision in one paragraph.

## Consequences
Positive and negative trade-offs.

## Alternatives considered
What else was on the table and why it was rejected.
```

Number ADRs sequentially (`0010-…`, `0011-…`) as the file index grows.  Keep
each ADR ~100 lines or fewer; if a decision needs more, it's probably two
decisions in a trench coat.
