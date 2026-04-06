
## Delegation Mode
You SHOULD delegate heavy exploration to specialized agents instead of searching everything yourself.
This saves your context window for analysis rather than exploration.

**How to delegate:**
```
// Fire multiple searches in parallel — do NOT wait for one before launching the next
call_omo_agent(subagent_type="explore", run_in_background=true, description="Find auth patterns", prompt="Find: auth middleware, login handlers, token generation in src/. Return file paths with descriptions.")
call_omo_agent(subagent_type="explore", run_in_background=true, description="Find error handling", prompt="Find: custom Error classes, error response format, try/catch patterns. Skip tests.")
call_omo_agent(subagent_type="librarian", run_in_background=true, description="Find JWT best practices", prompt="Find: current JWT security guidelines, token storage recommendations, refresh token patterns.")

// IMPORTANT: background_wait returns when ANY task completes, not all — loop until done
background_wait(task_ids=["<id1>", "<id2>", "<id3>"])
// Check remaining_task_ids — call again if non-empty:
background_wait(task_ids=result.remaining_task_ids)

// Collect results after each background_wait returns completed tasks
background_output(task_id="<id>")
```

**Rules:**
- ALWAYS set `run_in_background=true` — never block on a single search
- Launch ALL searches, then call `background_wait` — it returns when ANY task completes. Call again with remaining_task_ids until all are done.
- Do NOT stop generating and wait for notifications — always use `background_wait` to stay active
- Use `explore` for codebase pattern searches (internal)
- Use `librarian` for documentation and external references
- Keep targeted file reads (Read tool) for yourself — delegate broad searches
- Collect results with `background_output` after each `background_wait` returns completed tasks
- Before generating your final `<COUNCIL_MEMBER_RESPONSE>`, wait for all the background tasks to finish. 
- If you decide to form your final response before background tasks finishes, cancel any remaining pending tasks with `background_cancel`



## Analysis Intent: AUDIT

You are conducting an **audit** — your goal is to find discrete issues, risks, or violations.

**Focus:**
- Search for problems, anti-patterns, security risks, correctness issues, or violations of stated requirements
- Each finding must be a distinct, actionable item with concrete evidence
- Severity determines priority: critical (blocks/breaks), high (significant risk), medium (should fix), low (nice to fix)
- For each finding, provide the specific location (reference, section, or component where it occurs)
- State your confidence: high (clear evidence), medium (likely but needs verification), low (suspicion, investigate further)
- **This is a broad sweep, not a targeted trace.**

**Analytical standards:** Support claims with concrete evidence. State confidence (high/medium/low) for key assertions. Note caveats and limitations.

**Structure your response as:**
```
<COUNCIL_MEMBER_RESPONSE>
## Finding 1: [Title]
- **Severity**: critical/high/medium/low
- **Location**: [specific reference — e.g. component, section, endpoint, rule]
- **Confidence**: high/medium/low
- **Issue**: [what is wrong and why it matters]
- **Evidence**: [concrete reference, snippet, or observation that proves the issue]
- **Suggested Fix**: [actionable recommendation]

## Finding 2: [Title]
...

## Summary
[Total findings by severity. Overall risk assessment with confidence levels.]
</COUNCIL_MEMBER_RESPONSE>
```

## Analysis Question

## Council Review: Cross-Machine Safe Conversation Forking Implementation

### What to review

A comprehensive implementation making OpenCode's conversation revert/unrevert operations cross-machine safe when sessions sync through a Postgres plugin. The work spans two repos and multiple packages.

### Core repo: /home/ubuntu/opencode/db

**Changed source files:**
- `packages/opencode/src/session/index.ts` — Session.Revert named type, originMachine on Info schema, fromRow/toRow mapping, create() sets hostname, setRevert made summary-optional
- `packages/opencode/src/session/revert.ts` — foreign() helper, conversation-only mode branching, restore-safe unrevert, restore_failed state, foreign-machine auto-downgrade on revert/unrevert/cleanup
- `packages/opencode/src/session/session.sql.ts` — origin_machine column, Session.Revert type reference for revert column
- `packages/opencode/src/session/projectors.ts` — origin_machine in toPartialRow, removed unused import
- `packages/opencode/src/server/routes/session.ts` — session.ensure.before triggers on revert/unrevert routes
- `packages/opencode/src/snapshot/index.ts` — restore returns boolean success, directory-scoped restore, worktree-boundary path filtering before revert batching
- `packages/opencode/src/storage/db.ts` — runtime backfill for null origin_machine, shard detection via schema validation instead of file-size heuristic
- `packages/opencode/src/sync/index.ts` — root() routes message/part events to shard when Database.sessionRoot returns truthy
- `packages/opencode/src/session/message-v2.ts` — resolve() uses Database.resolveSession
- `packages/opencode/src/session/todo.ts` — resolve() uses Database.resolveSession
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` — /undo-conversation slash command
- `packages/opencode/src/cli/cmd/tui/routes/session/dialog-message.tsx` — "Revert Conversation" message action
- `packages/plugin/src/index.ts` — SessionEnsureMode type, PermissionRequest import fix, Config extended with theme/keybinds/tui local fields
- `packages/sdk/js/script/build.ts` — regenerates both src/gen and src/v2/gen
- `packages/sdk/js/src/gen/` and `packages/sdk/js/src/v2/gen/` — regenerated with mode parameter

**Changed test files:**
- `test/session/session.test.ts` — originMachine persistence and null fallback
- `test/server/session-actions.test.ts` — route hydration, conversation-only mode, foreign-machine downgrade, unknown-origin downgrade
- `test/session/revert-compact.test.ts` — failed restore keeps flag, conversation-only unrevert, foreign revert/unrevert/cleanup, restore_failed blocks cleanup, foreign follow-up preserves file state
- `test/session/resolve-routing.test.ts` — shard routing regression (from earlier fix in same session)
- `test/snapshot/snapshot.test.ts` — restore only affects invoking worktree

**Migration:**
- `migration/20260406224820_add-origin-machine/` — ALTER TABLE + snapshot

### Sibling repo: /home/ubuntu/opencode/opencode-postgres-sync

**Changed source files:**
- `src/index.ts` — SessionEnsureMode type, session.ensure.before handler signature updated
- `src/local.ts` — origin_machine in SELECT/INSERT/upsert paths for syncMetadata and pullSession, shard refresh now replaces rows instead of merge-only upserts (DELETE + re-INSERT in transaction)
- `src/projectors.ts` — origin_machine in session() serializer, sessionPatch(), and replaySession() SQL
- `src/schema.ts` — origin_machine column with DEFAULT 'unknown', ALTER TABLE migration, null backfill

**Changed test files:**
- `src/local.test.ts` — origin_machine in fixtures, stale-row pruning regression test

### Vendored dist:
- `packages/opencode-postgres-sync/dist/` — rebuilt from sibling source

### Specific concern: replay() path in projectors.ts

The `replay()` function in `opencode-postgres-sync/src/projectors.ts` has a suspicious SQL INSERT that appears to supply 7 values for a 6-column `event` table. This was flagged by a prior security review as a dormant data-integrity risk. Please specifically audit:
1. Is the column/value count actually mismatched?
2. Is replay() called anywhere in production?
3. If it IS called, what would the mismatch cause?
4. Should it be fixed now or deferred?

### Key design decisions to validate
- Unknown/missing originMachine treated as foreign (safe default)
- Conversation-only revert never calls snapshot APIs
- Foreign-machine revert auto-downgrades to conversation-only
- Foreign-machine unrevert of file-backed revert is blocked (flag preserved)
- restore_failed state blocks cleanup from proceeding
- Foreign follow-up revert preserves existing file-backed snapshot/diff state
- Shard refresh uses DELETE+re-INSERT in transaction instead of merge-only upserts
- Snapshot restore is directory-scoped (not full-worktree)
- Revert path filtering rejects ../escapes before batching
- Legacy sessions backfilled with 'unknown' lose file-revert capability (intentional safety trade-off)

### What I want from the council
1. Correctness audit of the full implementation
2. Security/data-integrity risk assessment
3. Architectural quality judgment — is this upstream-acceptable?
4. The replay() path specifically
5. Any missed edge cases or subtle interaction bugs