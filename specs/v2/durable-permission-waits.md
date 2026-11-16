# Durable Permission preflight milestone

This milestone extends the P2-C2 baseline (`8b7422e`) with durable authorization for the eligible Core-owned `question@1` preparation path. It does not make arbitrary `permission.assert()` continuations resumable.

## Supported boundary

The real Tool registry resolves the original invocation, runs `execute.before`, decodes its post-hook input and evaluates authorization once. `Permission.prepare` returns either allow, a configured denial, or a permission request without publishing a process-local waiter. The original executor and `Form.ask` have not run. Executor identity checks, Code Mode exclusion and the existing `execute.after` restriction still determine eligibility.

After the provider finishes and ordinary tools settle, `Step.Parked` atomically records:

- The original Session, assistant message, call ID and actual `Step.Started` sequence.
- The original model input in the assistant projection and the decoded post-hook Question input in its versioned continuation.
- The permission ID, requester, action, resources, saved scopes, metadata and evaluation message.
- A reserved Question ID, plus the Step's finish, usage, snapshots and logical continuation cursor.

The `session_permission` projection references the exact Session/assistant/generation by a composite foreign key. Before approval there is no public Form. The existing Permission list, get and reply methods merge these rows with legacy process-local requests, applying directory and workspace ownership to database reads. Existing HTTP routes and client reply payloads are unchanged; the experimental Session log includes the new durable fact.

Shutdown leaves committed authorization rows pending. Preparation interrupted before parking publishes no pending permission. Recovery never re-enters the provider request, original tool executor, before/after hooks or permission evaluation for the original explicit decision.

## Decisions and replay

`session.permission.resolved.1` is an internal, transactional first-response-wins fact. A request transitions from pending to `once`, `always` or `reject`; a competing new response fails without advancing the durable sequence. Redelivery of the same stored event is idempotent. Existing HTTP duplicate responses retain their pending-only behavior (404 after settlement).

Approval materializes the prepared Question in the same transaction. Answering it then follows the existing Question resolution and Step settlement paths. It does not settle an approval as a fake tool success or run an executor to reach `Form.ask` again.

An explicit `always` saves only the original request's `save` scopes, atomically with approval. Saved-rule row identities and timestamps are reproducible from the decision. Live command handling reevaluates other pending requests as before: configured denies win and hooks still apply. Derived releases record `save: false`, so releasing a sibling cannot save its broader scopes. Replay applies those admitted decisions without hooks.

Rejection cancels every remaining wait in the original parked Step, including Question siblings, finalizes waiting calls, consumes the parked Step and accounts usage once. Nonempty permission feedback permits continuation at the next logical Step; absent or empty permission feedback interrupts the Session, matching existing Permission semantics. Question cancellation also rejects outstanding permission siblings. Existing Question empty-message semantics are preserved.

The database event and projections commit together. The live `permission.asked`, `permission.replied` and Form events are advisory notifications derived afterward. A disconnected responder cannot undo an already committed decision.

## Qualification and remaining work

Behavioral tests exercise the real registry and Step producer with an ordinary side-effecting tool, fresh Location graphs, database reopening through existing HTTP routes, approval/rejection, saved scopes, configured denies, ownership, simultaneous replies, interruption during response delivery, rollback, and replay/redelivery into a separate database. They do not qualify an actual server subprocess restart.

Still required:

1. A bounded live recovery scheduler that discovers terminal parked work and durable continuation cursors, schedules through SessionExecution ownership, and retries after lost advisory notifications. Approval itself exposes the Question; answering it or rejecting with feedback still requires an explicit resume or the existing startup recovery path. No new scheduler or public-handler plugin waits are added here.
2. Real managed-server SIGTERM and SIGKILL tests on a persistent database, including crashes after parking and response commits but before notification/reattachment, responses before startup attachment, completed ordinary tools beside waits, pending ownership, and exactly one committed settlement/usage update. Unexpected death after commit has a durable representation, but is not process-qualified by the in-process tests.
3. Explicit preflight or resumable contracts for shell, filesystem and other tools. Arbitrary mid-executor assertions, wrapped/overridden Question executors, after-hook fallback, Code Mode and MCP remain on their existing non-replayable paths. Standalone `Permission.ask` remains process-local. They must not be replayed to rediscover a permission check.
4. Release/rollback qualification before enabling this behavior in a released build. Older binaries do not understand the new authorization projection; this internal milestone is not an assertion of rollback compatibility or full issue #36347 coverage.
