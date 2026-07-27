# Tasks: Cron System

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~980 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | WU1 → WU2 → WU3 → WU4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Schema + migration + db layer | PR 1 | Base branch: dev. No deps. |
| 2 | Jobs CRUD + scheduler tick | PR 2 | Depends on PR 1. Core loop. |
| 3 | Executor + server hook | PR 3 | Depends on PR 2. AIAgent run. |
| 4 | CLI commands + index reg | PR 4 | Depends on PR 1. Standalone CLI. |

## Phase 1: Foundation — Drizzle Schema

- [x] 1.1 Create `packages/core/src/cron/cron-job.sql.ts` — `CronJobTable` with all fields, `Timestamps` mixin, snake_case
- [x] 1.2 Generate Drizzle migration at `packages/core/src/database/migration/` for `cron_job` table
- [x] 1.3 Add `cron-parser` to `packages/opencode/package.json` dependencies
- [x] 1.4 Create `packages/opencode/test/cron/jobs.test.ts` — test schema insert, defaults, basic CRUD with in-memory SQLite

## Phase 2: Core — Jobs CRUD + Schedule Math

- [ ] 2.1 Create `packages/opencode/src/cron/jobs.ts` — `CronJobs` service: `create`, `get`, `list`, `update`, `remove` with `Schema.Class` types
- [ ] 2.2 Add `computeNextRun(job)` — cron-parser, interval math, ISO date parsing, returns `Date | null`
- [ ] 2.3 Add `getDueJobs()`, `advanceNextRun(job)` (pre-advance for at-most-once), `markJobRun(job, status, error?)`
- [ ] 2.4 Add `computeGraceMs()` — formula `max(120s, min(period/2, 7200s))`, 120s for once-kind
- [ ] 2.5 Create `packages/opencode/src/cron/scheduler.ts` — `CronScheduler` service: `tick()` with `getDueJobs` → grace filter → `advanceNextRun` → partition by workdir
- [ ] 2.6 Implement serial/parallel dispatch: workdir jobs serialize, non-workdir fork via `Effect.forkIn`, capped by `OPENCODE_CRON_MAX_PARALLEL` (default 5)
- [ ] 2.7 Add tick loop: `Effect.repeat` + `Effect.delay(60000)` + `Effect.forkScoped` for server-scoped lifecycle
- [ ] 2.8 Add graceful shutdown: track in-flight fibers, await (30s timeout), then interrupt
- [ ] 2.9 Create `packages/opencode/test/cron/jobs.test.ts` — test `computeNextRun` (cron/interval/once), `computeGraceMs`, `advanceNextRun`
- [ ] 2.10 Create `packages/opencode/test/cron/scheduler.test.ts` — test partition logic, concurrency cap, grace window edge cases

## Phase 3: Execution — AIAgent Runner

- [ ] 3.1 Create `packages/opencode/src/cron/executor.ts` — `CronExecutor`: fresh AIAgent per run using job's model, skills, workdir
- [ ] 3.2 Implement output persistence: save conversation to `~/.opencode/cron/output/{job_id}/{timestamp}.md`, create dir on first run
- [ ] 3.3 Implement error handling: agent timeout → `markJobRun("error", "timeout")`, agent failure → `markJobRun("error", msg)`
- [ ] 3.4 Add state transitions: `scheduled` → `running` (at dispatch) → `completed`/`error` (via `markJobRun`)
- [ ] 3.5 Modify `packages/opencode/src/server/server.ts` — merge `cronLayer` into `listenerLayer()` scope
- [ ] 3.6 Create `packages/opencode/test/cron/executor.test.ts` — test agent construction, output path, error recording

## Phase 4: CLI — Lifecycle Commands

- [ ] 4.1 Create `packages/opencode/src/cli/cron.ts` — `CronCommand` with subcommands: `add`, `list`, `remove`, `pause`, `resume`, `status`, `trigger`
- [ ] 4.2 Implement `add`: `--name`, `--model`, `--skills`, `--workdir`, `--repeat`, `--schedule-kind`, inserts via `CronJobs.create()`
- [ ] 4.3 Implement `list`: formatted table, sorted by `next_run_at`, "No cron jobs found" for empty
- [ ] 4.4 Implement `remove`: confirm unless `--force`, error on nonexistent id
- [ ] 4.5 Implement `pause`/`resume`: toggle `enabled`, resume recomputes `next_run_at`
- [ ] 4.6 Implement `status`: prints all DB fields readable
- [ ] 4.7 Implement `trigger`: runs job immediately without altering `next_run_at`
- [ ] 4.8 Modify `packages/opencode/src/index.ts` — register `CronCommand` with yargs
- [ ] 4.9 Create `packages/opencode/test/cli/cron.test.ts` — test subcommand parsing, output formatting
