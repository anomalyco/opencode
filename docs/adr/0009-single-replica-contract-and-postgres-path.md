# ADR-0009: Single-replica deployment is the contract; document the Postgres path to multi-replica

- Status: Proposed
- Date: 2026-05-21

## Context

`DEPLOYMENT.md:225` creates the ECS service with `--desired-count 1`.  Several
properties of the collab implementation assume that count is exactly one:

- **SSE fanout is per-process.**  `sseClients: Map<sessionId, Set<send>>`
  (`packages/opencode/src/collab/router.ts:435`) is in-memory; an event
  broadcast on task A is never seen by a teammate connected to task B.
- **The queue execution lock is in-memory.**  `Queue.locks`
  (`packages/collab/src/queue.ts:17`).  Two tasks would each register their
  own executor and both dispatch the same `approved` suggestion.  ADR-0006
  removes this constraint at the queue layer, but two more remain:
- **SQLite over EFS is unsafe for multiple writers.**  SQLite's own docs warn
  against running over NFS-class filesystems; EFS is NFSv4.  `DEPLOYMENT.md`
  acknowledges this only in the post-MVP section (line 320).
- **Git operations into one workspace from two processes.**  No file-locking
  beyond `.git/index.lock`, which is brittle over EFS.

The deployment is therefore safe **only with `desiredCount = 1`**, which also
means:

- Rolling deploy with `maximumPercent = 200, minimumHealthyPercent = 50`
  spins up a second task transiently → both tasks open SQLite → corruption
  risk.  The ECS deploy strategy must be `maximumPercent = 100,
  minimumHealthyPercent = 0` (downtime during deploy).
- No horizontal scaling.  Vertical only.

## Decision

**Codify the single-replica contract in the deployment** and document the
Postgres-backed path to remove it.

**Now (this ADR's binding decision):**

- ECS service deployment configuration: `maximumPercent = 100`,
  `minimumHealthyPercent = 0` (explicit, with a comment in the task
  definition or IaC pointing to this ADR).
- ECS service: `desiredCount = 1`, scaling policy disabled.
- Document the deploy as **expecting short downtime** during rolling
  updates.  Pair with the `/healthz` check from ADR-0008 so the new task
  serves traffic only after migrations + native-API readiness.
- Add a startup banner that logs *"single-replica mode — do not scale"* if
  the process detects `ECS_TASK_METADATA_*` and a `desiredCount > 1`.

**Later (the path, not yet a binding decision — superseded by a future ADR
when triggered):**

When concurrent sessions or deploy-downtime become unacceptable:

1. Replace SQLite with managed Postgres (RDS or Aurora Serverless v2).  The
   schema in `packages/opencode/src/collab/schema.sql.ts` ports cleanly;
   Drizzle already supports Postgres dialect.
2. Replace in-memory SSE fanout with Redis pub/sub (or Postgres LISTEN/NOTIFY
   to avoid another service).
3. Combine with the dispatch CAS from ADR-0006 so multi-replica execution is
   exactly-once at the prompt level.
4. EFS stays for workspace clones; only the DB moves.

The migration trigger is **either** "rolling-deploy downtime starts hurting
users" **or** "we need to host >1 active concurrent collab session per ECS
task at peak."  Both are observable metrics, not gut feelings.

## Consequences

**Positive**

- Operators stop accidentally setting `desiredCount = 2` from the AWS console
  and triggering subtle data corruption.
- Deploy strategy is unambiguous and matches the implementation's actual
  invariants.
- The Postgres path is sketched, so when the time comes the work item is
  scoped, not invented from scratch.

**Negative**

- Each deploy has a brief window of unavailability.  Mitigations: the actual
  bootstrap is ~5–15 s per `DEPLOYMENT.md:277`; deploys are infrequent;
  participants see EventSource auto-retry, and the SSE state rebuilds on
  reconnect.
- Single point of failure for availability — if the one task dies, the
  service is down until ECS replaces it (~30–60 s).

## Alternatives considered

- **Multi-replica now with sticky sessions at the ALB.**  Sticky on
  `collab_sid` would keep one user on one task, but cross-user events (LLM
  responses, votes, typing) still need to fan out across tasks — sticky
  sessions don't solve the SSE problem.
- **Multi-replica with Bun's clustering / worker threads.**  Same SQLite
  problem inside one process; the moment we cross process boundaries we are
  back to the same fanout/lock issues.
- **Stay quiet about it.**  Rejected because the constraint is invisible to
  the next operator and the cost of someone setting `desiredCount = 2` is
  permanent (SQLite corruption isn't subtle to recover from).
