# Decision: Continue Sessions After Managed-Service Restart

| Field          | Value                                                        |
| -------------- | ------------------------------------------------------------ |
| Status         | Accepted and implemented                                     |
| Author         | Kit Langton                                                  |
| Date           | 2026-07-08                                                   |
| Tracking issue | [#35646](https://github.com/anomalyco/opencode/issues/35646) |

## Summary

When the managed OpenCode server shuts down gracefully, active Sessions continue automatically the next time the managed server starts.

The implementation uses one private nullable timestamp on the existing Session row: `time_suspended`. The managed server suspends its active Sessions on graceful shutdown and resumes suspended Sessions on startup. Both are explicit actions the managed server invokes.

The field is not Session status. Live activity remains process-local. Hard-crash recovery and exactly-once provider or tool execution remain out of scope.

## Decision

Add this private Session field and partial index:

```sql
ALTER TABLE session
ADD COLUMN time_suspended INTEGER;

CREATE INDEX session_time_suspended_idx
ON session(time_suspended)
WHERE time_suspended IS NOT NULL;
```

A non-null `time_suspended` means:

> A managed server suspended this Session during graceful shutdown, at this time. The next managed server may make one attempt to resume it.

The name records the fact rather than one consumer's policy, and it follows the Session table's existing nullable-timestamp idiom (`time_compacting`, `time_archived`). The timestamp also gives operators suspension age for free, which later policy may use without a schema change.

The field does not appear in public `Session.Info` and does not drive UI activity.

## Status and Suspension Are Separate

| Concept           | Values              | Source of truth                       |
| ----------------- | ------------------- | ------------------------------------- |
| Live activity     | `inactive / active` | Process-local `SessionRunCoordinator` |
| Execution history | `started / settled` | Durable lifecycle events              |
| Suspension        | `null / timestamp`  | Private Session-row `time_suspended`  |

A persisted status such as `idle / running / resumable` answers three different questions. `running` becomes stale after a crash, while `resumable` is pending work rather than current status.

## The Managed Server Owns Restart Continuity

Restart continuity is not layer configuration. `SessionRestart` is an inert core service exposing two actions, and only the managed server (`opencode serve --service`) calls them:

```typescript
// ServerProcess, service mode only
yield * Effect.forkScoped(restart.resumeSuspendedSessions)
yield * Effect.addFinalizer(() => restart.suspendActiveSessions)
```

Default, embedded, and stdio servers build the same execution layer but never invoke the actions, so they never suspend or auto-resume.

### Graceful shutdown suspends

Teardown ordering makes suspension observe exactly the work a restart interrupts:

1. The HTTP server closes all connections; no new work can arrive.
2. `suspendActiveSessions` snapshots `SessionExecution.active` and sets `time_suspended` for each.
3. Session execution teardown interrupts the still-running drains.

A SIGKILL runs none of this: nothing is suspended, and the user resumes manually. That is deliberate — automatic post-crash continuation would retry ambiguous provider and tool work.

### Ordinary lifecycle clears stale suspension

The Session execution layer clears the field through EventV2 live `commit` hooks, with no knowledge of server mode:

| Lifecycle event             | `time_suspended`                      |
| --------------------------- | ------------------------------------- |
| Execution started           | `NULL`                                |
| Execution succeeded         | `NULL`                                |
| Execution failed            | `NULL`                                |
| Execution interrupted (any) | unchanged — interruption preserves it |

Interruption must preserve suspension because managed teardown interrupts drains immediately after suspending them. Every other transition clearing the field closes the races: a drain that finishes on its own between suspension and teardown clears its suspension, and an embedded server that completes a suspended Session during the gap clears it on start.

Because the clears are `commit` hooks rather than projections, event replay preserves lifecycle history without recreating or destroying suspension.

## Startup Consumes Each Suspension Atomically

`resumeSuspendedSessions` reads pending Session IDs through the partial index. Immediately before resuming each Session, it performs a conditional clear:

```sql
UPDATE session
SET time_suspended = NULL
WHERE id = ? AND time_suspended IS NOT NULL
RETURNING id;
```

Only the process receiving the returned row resumes that Session. A second consumer receives no row. Each suspension is consumed right before its own drain starts, and at most four resumed drains run at once.

The resume goes through the existing process-local coordinator, which joins duplicate same-process resumes and starts a forced drain while idle.

## Failure Semantics

The design provides at-most-once automatic scheduling, not guaranteed continuation.

| Failure                                                | Result                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Old server is killed before graceful closeout          | Nothing is suspended; user resumes manually                                   |
| Old server dies between suspension and teardown        | Session stays suspended; next server resumes it                               |
| New server crashes before conditional clear            | Session stays suspended                                                       |
| New server crashes after clear but before drain starts | Automatic continuation is lost                                                |
| New server crashes after drain starts                  | No automatic hard-crash retry                                                 |
| Interrupted tool has uncertain side effects            | Orphan reconciliation records interruption rather than replaying the old call |

Losing one automatic continuation is safer than repeatedly restarting ambiguous provider or tool work.

## Migration Does Not Infer Historical Intent

The migration adds the nullable column with no backfill. It does not scan historical shutdown events.

An old shutdown event records what happened; it does not prove that a future process is authorized to start new work. The first upgrade may therefore require manual continuation for Sessions interrupted by the old binary.

## Ranked Alternatives

| Rank | Option                                  | Verdict   | Reason                                                                          |
| ---: | --------------------------------------- | --------- | ------------------------------------------------------------------------------- |
|    1 | Daemon-invoked suspend/resume actions   | Preferred | The restart authority acts explicitly; execution layer stays generic            |
|    2 | Execution-layer configuration flag      | Rejected  | Threads a mode bit through server, routes, and layer construction               |
|    3 | Dedicated continuation table            | Reserve   | Useful if continuation later needs metadata, leases, retries, or multiple rows  |
|    4 | Leased continuation queue               | Defer     | Solves claimant failure but adds acknowledgement, expiry, and fencing semantics |
|    5 | Persisted general Session status        | Reject    | Conflates activity, history, and pending work                                   |
|    6 | Scan lifecycle history on every startup | Reject    | Repeats unbounded historical work and lacks direct atomic consumption           |

## Coverage

Regression coverage verifies:

- A suspension can be consumed only once per Session.
- Generic lifecycle publication and replay do not infer suspension.
- Historical shutdown events remain unsuspended after migration.
- Concurrent managed-service candidates elect one process and produce one continued execution.
- Teardown interruption preserves suspension; a drain finishing on its own clears it.

## Non-Goals

- Recovering unmatched execution after a hard process or machine crash.
- Persisting authoritative live Session status.
- Coordinating Session execution across independent processes or a cluster.
- Guaranteeing exactly-once provider requests or tool side effects.
- Retrying a continuation after its suspension has been consumed.

## Prior Work

- [Issue #35646: auto-resume active Sessions after server restart](https://github.com/anomalyco/opencode/issues/35646)
- [Draft PR #35778: resume Sessions after restart](https://github.com/anomalyco/opencode/pull/35778)
- [Draft PR #35820: resume Sessions after restart](https://github.com/anomalyco/opencode/pull/35820)
- [Issue #35642: interrupted work remains spinning after machine restart](https://github.com/anomalyco/opencode/issues/35642)
