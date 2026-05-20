# ADR-0007: Background GC for `collab_auth_session`, `collab_invite`, and abandoned workspaces

- Status: Proposed
- Date: 2026-05-21

## Context

The collab feature has **no scheduled background jobs**.  A grep of
`packages/opencode/src/collab` and `packages/collab/src` for
`setInterval|Effect.repeat|Effect.schedule|cron` returns only one hit — a
fire-and-forget `setTimeout(…, 200)` for native-session pre-warm
(`router.ts:234`).

Three concrete consequences:

1. **`collab_auth_session` rows accumulate forever.**  Expiry is 7 days but
   rows are only deleted opportunistically when an expired cookie is
   re-presented (`router.ts:389-393`).  A user who signs in once and never
   returns leaves a row permanently.  Over months these dominate the table.
2. **`collab_invite` rows are never garbage collected.**  Used and expired
   tokens stay in the DB indefinitely.
3. **Abandoned session workspaces never get cleaned up.**  Deletion fires
   only on explicit `DELETE /collab/session/:id` via `cleanupSessionWorkspace`
   (`router.ts:925-926`).  A soft-deleted session (`deleted_at` set per
   CONTEXT.md) keeps its `/var/opencode/workspaces/<id>/` directory; a
   crashed session never gets one written.

The `DEPLOYMENT.md` post-MVP section (line 320) notes EFS becomes a bottleneck
under concurrent writers but doesn't mention the unbounded growth problem.

## Decision

Introduce a single scheduled background loop using opencode's existing
Effect-based scheduler pattern (see `packages/opencode/src/tool/truncate.ts:149`
for an example using `Effect.repeat(Schedule.spaced(Duration.hours(1)))`).  The
loop performs:

- Delete `collab_auth_session` rows where `expires_at < now()`.
- Delete `collab_invite` rows where `used_at IS NOT NULL` OR
  `expires_at < now()` — keep them for 30 days after redemption for audit,
  then delete.
- For each soft-deleted `collab_session` whose `deleted_at < now() - 7d`,
  remove `/var/opencode/workspaces/<id>/` and hard-delete the row plus
  cascades.
- For workspace directories on disk that have **no matching collab_session
  row** (orphans from interrupted creation), delete after 24 h.

The loop is idempotent, batch-bounded (e.g. 1000 rows per pass), and logs a
single summary line per run.  Frequency starts at hourly; back off if a run
ever finds zero work for 24 h in a row.

For the workspace-cleanup half, the loop must hold an advisory lock so two
replicas (post-ADR-0009 future) cannot race; for now the single-replica
guarantee from ADR-0009 makes this trivial.

## Consequences

**Positive**

- Unbounded growth stops.  EFS bill stays roughly proportional to active
  sessions rather than to historical sessions.
- SQLite query plans stay fast (the auth-session lookup is on every collab
  request).
- Makes the deployment safe to leave running for months without operator
  attention.

**Negative**

- One more thing that can crash; the GC must be defensively coded.
- Hard-deleting old `collab_session` rows after the soft-delete window means
  the audit trail loses participants/repos/suggestions for ancient sessions.
  Acceptable for an MVP; revisit if a real audit requirement appears.

## Alternatives considered

- **Run GC manually via a CLI subcommand the operator runs from time to
  time.**  Rejected: the operator will forget.  Background GC is the default
  for any product expected to run for years.
- **TTL via SQLite triggers.**  SQLite has no built-in TTL primitive;
  triggers on every read are too expensive.
- **Externalise to an AWS Lambda + EventBridge schedule.**  Adds another
  thing to wire up.  An in-process loop is simpler and ships with the same
  artifact as the rest of the server.
