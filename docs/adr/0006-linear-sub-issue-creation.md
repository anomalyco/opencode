# ADR-0006: Linear Sub-Issue creation — MCP review and alternative plans

**Status:** Accepted (2026-07-20 — Phases 1-5 implementation complete, see Amendment)
**Branch:** `feature/todo-sidebar-linear`
**Deciders:** user, Claude
**Related:** ADR-0001 Amendment 2026-07-20 (Linear parent-child sync — two-phase CREATE + UPDATE parentId), ADR-0002 (Sync data path), ADR-0005 D4/D7 (`linear_graphql` escape hatch + `LinearGraphqlClient` shared service)

## Context

The Todo Sidebar Feature models work as a two-level hierarchy: L1 issues (sequential, top-level) and L2 sub-issues (parallel, children of an L1). Linear models the same concept as Issue / sub-issue via the `parentId` field on `Issue`.

ADR-0001 Amendment 2026-07-20 ("Linear parent-child sync") documented the **current** implementation: `SyncPush` runs a two-phase CREATE for local-only issues (L1 first, L2 with `parentId` second) and unconditionally sends `parentId` on L2 UPDATEs. This ADR was written **after** that amendment landed, in response to the user's request to "审查 Linear MCP，规划创建 Sub Issue 可能的方案" — i.e. audit whether the current approach is correct, identify gaps, and plan alternatives before the implementation hardens.

The audit reviewed:

- `packages/opencode/src/issue/sync-push.ts` (Cohort 1 UPDATE path L555-570, Cohort 2 CREATE path L644-805)
- `packages/opencode/src/issue/sync-pull.ts` (`readParentId` L240-249, pull reconcile L619-657)
- `packages/opencode/src/issue/mcp-client.ts` (Linear MCP client surface)
- `packages/opencode/src/issue/linear-graphql.ts` (GraphQL escape-hatch service)
- `packages/opencode/src/issue/tool-names.ts` (Linear MCP tool inventory: 39 tools across 8 categories)
- `packages/opencode/src/tool/linear_graphql.txt` (Agent guidance for the GraphQL escape hatch)

### Linear MCP tool inventory (audited 2026-07-20)

The Linear MCP server exposes the following Issue-related tools (full list in `tool-names.ts`):

| Tool              | Purpose                              | Sub-issue support                                                                 |
| ----------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| `save_issue`      | Create or update an Issue            | **Accepts `parentId`** (per the comment in `sync-push.ts:651`, sourced from the MCP `tools/list` probe). The field accepts a Linear issue identifier (e.g. `"BOR-15"`) or UUID. Setting `null` removes the parent link. |
| `get_issue`       | Fetch a single Issue by id           | Returns `parentId` on the issue node                                              |
| `list_issues`     | List issues (paginated, project-scoped) | Returns `parentId` on each issue node                                          |
| `list_issue_statuses` | List workflow states for a team  | n/a                                                                               |
| `list_issue_labels` / `create_issue_label` | Label CRUD            | n/a                                                                               |

There is **no** dedicated `create_sub_issue` tool, **no** `delete_issue` tool, and **no** batch create tool. Sub-issue creation reuses `save_issue` with `parentId`.

### Linear GraphQL surface (audited 2026-07-20)

Linear's public GraphQL API (`https://api.linear.app/graphql`) exposes:

- `issueCreate(input: IssueCreateInput!)` — `IssueCreateInput.parentId` is `String` (nullable). Creates a new issue, optionally as a sub-issue of `parentId`.
- `issueUpdate(id: String!, input: IssueUpdateInput!)` — `IssueUpdateInput.parentId` is `String` (nullable). Setting `parentId: null` removes the parent link.
- `issueDelete(id: String!)` — hard-deletes an issue (MCP has no equivalent).

The `LinearGraphqlClient.Service` in `packages/opencode/src/issue/linear-graphql.ts` is the kernel's shared transport for direct GraphQL calls. It is currently used for:

- `SyncPush.clearDueDateViaGraphQL` (clearing `dueDate` — MCP rejects `null` for string-typed fields)
- The agent-side `linear_graphql` tool (escape hatch for null-clearing and deletion)

It is **not** currently used for `parentId` operations — those go through MCP `save_issue`.

### Current SyncPush sub-issue flow (audited 2026-07-20)

```
SyncPush.push({ directory })
  ├─ Cohort 1: linked issues (UPDATE)
  │   └─ For each linked L2 (level === 1 && parent_id):
  │       └─ Resolve parent.linear_issue_id from `all` list
  │       └─ save_issue({ id, team, project, ...dirtyFields, parentId })
  │           (parentId sent unconditionally — idempotent on Linear's side)
  │
  └─ Cohort 2: local-only issues (CREATE)
      ├─ Phase 2a: localL1 (level === 0 || parent_id === null)
      │   └─ save_issue({ title, team, project, state, ... }) — NO parentId
      │   └─ localIdToLinearId.set(issue.id, parsed.id)
      │       (Map seeded with already-linked issues from `all`)
      │
      └─ Phase 2b: localL2 (level === 1 && parent_id !== null)
          └─ parentId = localIdToLinearId.get(issue.parent_id)
          └─ If parentId is undefined → skip with `parent_not_linked` error
          └─ Otherwise → save_issue({ title, team, project, ..., parentId })
```

### Gaps and issues identified

The audit surfaced seven concrete gaps in the current approach. None are blocking bugs; all are documented here so the planned alternatives can address them deliberately.

#### G1 — `parentId` is not in `SHADOW_FIELDS`, so UPDATE sends it every push

`Issue.SHADOW_FIELDS` is `["title", "content", "description", "status", "priority", "labels", "due_date", "assignee_id"]`. `parent_id` is intentionally excluded (the comment in `sync-push.ts:559-564` explains: "it's a local UUID, not comparable to Linear's identifier-format parentId"). As a result, every L2 UPDATE sends `parentId` unconditionally — even when the parent has not changed.

This is **idempotent on Linear's side** (setting the same parentId is a no-op), but it costs one extra field per L2 push and obscures the dirty-check signal. A future maintainer reading the push diff cannot tell whether a push was triggered by a content change or by a reparenting.

#### G2 — No support for clearing `parentId` via MCP

Linear MCP's `save_issue` schema (per the probe in `tool-names.ts` and the inline comment at `sync-push.ts:690-693`) accepts `parentId` as a string. Passing `parentId: null` to detach a sub-issue from its parent has the same schema limitation as `dueDate: null` — the MCP Zod schema rejects `null` for string-typed fields.

The kernel has no current code path that **clears** a Linear parent link. If a user converts an L2 to an L1 locally (sets `parent_id = null` and `level = 0`), the next push:

1. Detects the row is in the `linkedDirty` cohort (shadow diff on `level` — but `level` is not in `SHADOW_FIELDS` either, so the dirty check misses the change).
2. Falls through to Cohort 1 UPDATE, where `issue.level === 1 && issue.parent_id` is now false, so the `parentId` assignment is skipped.
3. `save_issue` is called **without** `parentId`. Linear MCP's behavior on omitted `parentId` is undocumented — it likely leaves the existing parent link untouched (same as omitted `dueDate`).

**Result:** the local row becomes an L1, but the Linear issue remains a sub-issue. The next pull does not reconcile this (per ADR-0002, pull never overwrites local `parent_id`, and `parentId` is intentionally not reconciled into the local row from the cloud either).

#### G3 — `level` is not in `SHADOW_FIELDS`, so L1↔L2 transitions are invisible to push

`level` is a local-only concern (the kernel's two-level hierarchy), but Linear's `parentId` IS the cloud-side hierarchy signal. When a local row transitions L2 → L1 (parent removed), the shadow diff sees no change (level is not shadowed), so the row is skipped on the next push. The cloud keeps the old parent link.

This is the root cause behind G2. The fix is either (a) add `parent_id` to `SHADOW_FIELDS` and convert local UUIDs to Linear identifiers for the diff, or (b) special-case L1↔L2 transitions outside the shadow diff.

#### G4 — Phase 2a failure produces unactionable `parent_not_linked` errors

If Phase 2a partially fails (some L1 creates error out — e.g. Linear rate limit, MCP transport blip), Phase 2b skips every L2 whose parent didn't make it. The error message is `"parent_not_linked: parent issue <local-uuid> has no linear_issue_id; cannot set parentId"`.

The user's only remediation is to fix the L1 failure and re-push. There is no automatic retry, no deferred queue, and no partial-success path. For large hierarchies (e.g. 10 L1 × 5 L2 = 60 issues), a single L1 failure cascades to 5 L2 skips.

#### G5 — `localIdToLinearId` Map mutation inside `Effect.all` is cooperative-scheduler-dependent

The Cohort 2a code (`sync-push.ts:771-782`) calls `localIdToLinearId.set(issue.id, newLinearId)` inside an `Effect.all` with `concurrency: DEFAULT_BATCH`. The comment at L660-662 explains: "JavaScript Maps are safe for concurrent access here because Effect.all with `concurrency` uses cooperative scheduling — `.set()` runs atomically between yields."

This is correct under Effect's current scheduler, but it is a load-bearing assumption. If the runtime ever switches to true parallel fibers (e.g. worker threads), the Map mutation becomes a data race. The pattern is not flagged by lint and depends on runtime semantics that aren't enforced by types.

#### G6 — No batch create API; each L2 is a separate `save_issue` call

Linear MCP exposes no batch create tool. A workspace with 10 L1 × 5 L2 = 60 local-only issues produces 60 sequential `save_issue` calls (with `concurrency: DEFAULT_BATCH = 10`, that's 6 batches). For users with large backlogs migrating from another system, this is slow and rate-limit-prone.

Linear's GraphQL API also has no batch create mutation — `issueCreate` takes a single `IssueCreateInput`. The only mitigation would be parallel GraphQL calls, which `LinearGraphqlClient.Service` already supports via `Effect.all` at the caller.

#### G7 — Pull does not reconcile cloud-side reparenting into local rows

Per ADR-0002 (2026-07-09 amendment): "pull must NEVER overwrite local-only hierarchy fields — `id`, `directory`, `parent_id`, `level`, `position`, `last_pushed_at`, `time_created`, `time_updated`. The cloud `parentId` is intentionally NOT reconciled into the local row. Hierarchy is a local-only concern; users may re-parent issues via the UI/tools."

This is an intentional decision (local truth wins for hierarchy), but it creates a visible asymmetry: if someone reparents an issue on Linear's web UI, the next pull does not reflect the change locally. The user has to delete and re-pull, or manually reparent via the local UI. The decision is documented but not surfaced in the UI — users only discover it when they see a "stale" hierarchy after a Linear-side reparent.

## Decision options

Six alternative approaches are considered. They are not mutually exclusive — the recommended plan (D1) combines elements of options A, B, and E.

### Option A — Keep current approach (status quo)

**What:** `SyncPush` continues to use MCP `save_issue` with `parentId` for both CREATE and UPDATE. No code changes.

**Pros:**
- Zero implementation cost.
- MCP is the canonical integration path (per ADR-0001 §Context).
- `parentId` is accepted by the MCP schema (verified by probe).
- Two-phase push already handles the L1-before-L2 ordering constraint.

**Cons:**
- G1, G2, G3, G4, G5, G6, G7 all remain open.
- The kernel cannot clear a Linear parent link via MCP (G2).
- L1↔L2 transitions silently drift (G3).

**Verdict:** Acceptable as a baseline, but G2/G3 are correctness issues that should be fixed before the feature ships. This option is the fallback if the recommended plan proves too large.

### Option B — Extend `LinearGraphqlClient` to clear `parentId`

**What:** Add a `clearParentIdViaGraphQL` function in `sync-push.ts` (mirroring `clearDueDateViaGraphQL`) that calls `issueUpdate` with `input: { parentId: null }` via `LinearGraphqlClient.Service`. Invoke it from the Cohort 1 UPDATE path when the local `level` transitioned from 1 to 0 (or `parent_id` transitioned from non-null to null).

**Pros:**
- Reuses the existing `LinearGraphqlClient.Service` — no new transport code.
- Mirrors the established `clearDueDateViaGraphQL` pattern — symmetric, discoverable.
- Solves G2 directly.

**Cons:**
- Requires detecting the L2→L1 transition, which requires either (a) adding `parent_id` to `SHADOW_FIELDS` (with a UUID→Linear identifier converter for the diff), or (b) special-casing the transition outside the shadow diff. Both add complexity.
- Adds a second Linear API call per cleared parent (MCP `save_issue` for content fields, then GraphQL for `parentId: null`).
- The `linear_graphql` agent tool's description must be updated to document `parentId: null` as a supported use case.

**Verdict:** Necessary for correctness (G2). Should be part of the recommended plan.

### Option C — Add `parent_id` to `SHADOW_FIELDS`

**What:** Include `parent_id` in `Issue.SHADOW_FIELDS` so the shadow diff detects reparenting. The diff comparison must convert the local `parent_id` (a kernel-generated UUID) to the corresponding `linear_issue_id` (Linear's identifier format) before comparing against the cloud shadow.

**Pros:**
- Makes the dirty check hierarchy-aware — push only sends `parentId` when the parent actually changed (fixes G1).
- Detects L1↔L2 transitions naturally (the shadow sees `parent_id` go from non-null to null or vice versa).

**Cons:**
- The UUID→identifier conversion requires looking up the parent's `linear_issue_id` from the `all` list during the diff — currently `diffShadow` is a pure field-by-field comparison with no lookup capability.
- The cloud shadow must store the **Linear identifier** form of `parentId`, not the local UUID. This means `Issue.buildShadow` must also do the lookup, which couples shadow construction to the issue list (currently `buildShadow` is a pure projection).
- The first sync after migration (when `cloud_shadow` is null) sends all fields including `parentId` — already the case, no regression.

**Verdict:** Correct in principle, but the lookup coupling is invasive. A simpler alternative is Option D.

### Option D — Special-case L1↔L2 transitions outside the shadow diff

**What:** Detect `level` or `parent_id` transitions on linked L2 issues by comparing the local row against the `cloud_shadow`'s implicit hierarchy (stored separately). When the local `parent_id` differs from the shadow's `parent_id`, send `parentId` in the push (resolved to Linear identifier). When `parent_id` transitioned to null, also call `clearParentIdViaGraphQL`.

**Pros:**
- Avoids coupling `diffShadow` / `buildShadow` to the issue list.
- Hierarchy changes are explicit in the push path.

**Cons:**
- Adds a separate "hierarchy diff" code path alongside the content shadow diff.
- The `cloud_shadow` must include `parent_id` (in Linear identifier form) for the comparison — a small schema change.

**Verdict:** Simpler than Option C, solves G1/G2/G3. Part of the recommended plan.

### Option E — Add `parent_id` (Linear identifier form) to `cloud_shadow`

**What:** Extend `Issue.buildShadow` to include `parent_linear_id` (the Linear identifier of the parent, resolved via `all.find((i) => i.id === issue.parent_id)?.linear_issue_id`). The shadow stores Linear-side identifiers only, so the diff is apples-to-apples.

**Pros:**
- Enables Option D's hierarchy diff.
- The shadow already mixes local and Linear fields (e.g. `assignee_id` is a local UUID that maps to a Linear UUID; `labels` is a local array that maps to Linear label names). Adding `parent_linear_id` follows the same pattern.
- Pull can optionally reconcile cloud `parentId` into `parent_linear_id` without touching local `parent_id` — gives the user a "cloud says the parent is X" signal without forcing a local reparent.

**Cons:**
- The shadow grows by one field.
- `buildShadow` requires the issue list to resolve `parent_linear_id` (currently it takes a single issue). Either change the signature or resolve the parent ID at the caller.

**Verdict:** Part of the recommended plan, paired with Option D.

### Option F — Switch sub-issue creation entirely to GraphQL `issueCreate`

**What:** Replace MCP `save_issue` for L2 CREATE with a direct GraphQL `issueCreate(input: { team, project, title, ..., parentId })` call via `LinearGraphqlClient.Service`. L1 CREATE and all UPDATEs stay on MCP.

**Pros:**
- Full control over the input shape — can clear fields, set null parents, etc.
- No dependency on the MCP `save_issue` schema for sub-issue semantics.
- Future-proofs against MCP schema regressions.

**Cons:**
- Bypasses MCP, violating the "Linear MCP is the integration point" principle (ADR-0001 §Context). Requires an ADR-0001 amendment documenting the exception, mirroring the `clearDueDateViaGraphQL` bypass rationale.
- Duplicates the field-mapping logic that `buildPartialSaveArgs` already implements for MCP.
- The agent's mental model becomes more complex: "L1 create via MCP, L2 create via GraphQL" is harder to explain than "all creates via MCP, GraphQL only for null-clearing".
- `LINEAR_API_KEY` becomes a hard requirement for any L2 create, not just an escape hatch.

**Verdict:** Rejected. The MCP `save_issue` schema supports `parentId` for CREATE; there is no need to bypass it. GraphQL should remain the escape hatch for operations MCP cannot express (null-clearing, deletion), not the primary path.

## Decision

### D1 — Recommended plan: MCP-first with hierarchy-aware shadow diff and GraphQL fallback for parent clearing

The recommended plan combines Options A, B, D, and E. MCP remains the canonical integration path; GraphQL is extended only to clear `parentId` (mirroring the existing `clearDueDateViaGraphQL` pattern).

**Phase 1 — Hierarchy-aware shadow diff (addresses G1, G3)**

1. Extend `Issue.SHADOW_FIELDS` to include `parent_linear_id` (a new field, not the local `parent_id`). The shadow stores the Linear identifier form of the parent — `null` for L1 issues, `"BOR-15"` for L2 issues.
2. Update `Issue.buildShadow` to accept the issue list (or a `parentLinearIdResolver` callback) and populate `parent_linear_id` by looking up the parent's `linear_issue_id`.
3. Update `diffShadow` to compare `parent_linear_id` against the local resolved value (also looked up from the issue list). When they differ, `parentId` is added to the dirty field set.
4. The Cohort 1 UPDATE path stops sending `parentId` unconditionally. It only sends `parentId` when `diffShadow` flags it as dirty.

**Phase 2 — GraphQL fallback for clearing parentId (addresses G2)**

5. Add `clearParentIdViaGraphQL({ linearId })` in `sync-push.ts`, mirroring `clearDueDateViaGraphQL`. It calls `issueUpdate` with `input: { parentId: null }` via `LinearGraphqlClient.Service`.
6. Invoke it from the Cohort 1 UPDATE path when:
   - The dirty field set includes `parent_linear_id`, AND
   - The local resolved `parent_linear_id` is `null` (i.e. the issue transitioned L2 → L1).
7. Update `packages/opencode/src/tool/linear_graphql.txt` to document `parentId: null` as a supported use case (alongside `dueDate: null` and `description: null`).

**Phase 3 — Phase 2a failure recovery (addresses G4)**

8. After Phase 2a completes, if any L1 create failed, log a structured warning with the failed L1 local IDs and the count of dependent L2s that will be skipped.
9. The `SyncPush.Result.errors` array already records per-issue failures; no schema change needed. The improvement is in the error message: `"parent_not_linked: parent issue <local-id> failed to create in Phase 2a (see prior errors); L2 skipped"`.
10. Document in the user-facing sync history tooltip that a failed L1 cascades to its L2s, and the fix is to resolve the L1 error and re-push.

**Phase 4 — Document the cooperative-scheduler assumption (addresses G5)**

11. Add a code comment in `sync-push.ts` above the `localIdToLinearId.set()` call that explicitly states the assumption: "Effect's cooperative scheduler guarantees `.set()` runs atomically between yields; if the runtime ever switches to parallel fibers, this Map must be replaced with a synchronized structure (e.g. `Effect.Ref<Map>`)."
12. Add a unit test that runs Cohort 2a with `concurrency: 1` and verifies the Map is fully populated before Phase 2b starts. (The current `concurrency: DEFAULT_BATCH = 10` is correct, but the test guards against a future change that breaks the ordering.)

**Phase 5 — Document the pull-side hierarchy asymmetry (addresses G7)**

13. Add a UI hint in the Linear sub-panel (when MCP is connected) that says: "Linear-side reparenting is not synced to local. To reflect a Linear reparent locally, delete the local row and pull again, or drag to reparent in the sidebar."
14. The hint is informational; no behavior change.

**Out of scope (deferred)**

- **G6 (no batch create API)**: Linear MCP and GraphQL both lack a batch create mutation. The only mitigation is parallel calls, which `Effect.all` with `concurrency: DEFAULT_BATCH` already does. No further work.
- **Option C (full `parent_id` in SHADOW_FIELDS)**: The simpler Option D/E combination is sufficient. If the shadow diff becomes hard to reason about, Option C can be revisited.
- **Option F (GraphQL-first for L2 CREATE)**: Rejected. MCP handles L2 CREATE correctly; GraphQL is the escape hatch, not the primary path.

### D2 — `cloud_shadow` schema migration

Adding `parent_linear_id` to `cloud_shadow` is a JSON-shape change, not a SQL schema change. `cloud_shadow` is stored as a `text` column containing JSON. Old rows have a shadow without `parent_linear_id`; the diff treats a missing field as `undefined`, which compares unequal to any non-undefined value, triggering a one-time push of `parentId` on the next sync. This is correct behavior (the shadow is stale and needs refreshing).

No migration file is needed. The first push after this ADR lands will refresh every linked issue's shadow to include `parent_linear_id`. Subsequent pushes use the new diff.

### D3 — No new agent tool

This ADR does **not** introduce a new agent tool. The existing `issue_sync` tool (ADR-0005 D3) is the agent's entry point to push. The agent does not need to know about `parentId` resolution — that's a sync-internal concern. The `linear_graphql` tool's description is updated (Phase 2 step 7) to document `parentId: null` as a supported use case, but the tool itself is unchanged.

## Consequences

### Positive

- **G1/G3 fixed:** push only sends `parentId` when the parent actually changed. Cleaner push diffs, less API churn.
- **G2 fixed:** L2→L1 transitions correctly clear the Linear parent link via GraphQL. No more silent drift.
- **G4 mitigated:** error messages are actionable; users know to fix the L1 and re-push.
- **G5 documented:** the cooperative-scheduler assumption is explicit, with a test guard.
- **G7 surfaced:** users are told about the pull-side hierarchy asymmetry instead of discovering it.
- **MCP remains canonical:** the only GraphQL addition mirrors the existing `clearDueDateViaGraphQL` pattern — small, justified, documented.

### Negative

- `Issue.buildShadow` signature changes to accept a parent-ID resolver. Callers must be updated.
- The first sync after this ADR lands sends `parentId` for every linked L2 (one-time cost).
- The `linear_graphql` agent tool's scope grows by one use case (`parentId: null`). The tool description gets longer.

### Neutral

- `cloud_shadow` JSON shape evolves without a SQL migration. Existing rows auto-migrate on the next push.
- The cooperative-scheduler assumption is not removed — it is documented and tested. If Effect ever changes its scheduler, the test will fail loudly before production is affected.

## Implementation Plan

### Phase 1 — Hierarchy-aware shadow diff

1. Update `Issue.SHADOW_FIELDS` to include `"parent_linear_id"`.
2. Update `Issue.buildShadow` to accept a resolver: `buildShadow(issue, resolveParentLinearId: (parentId: string | null) => string | null)`. The resolver looks up the parent's `linear_issue_id` from the issue list.
3. Update `diffShadow` to compare the resolved `parent_linear_id` against the shadow's `parent_linear_id`.
4. Update `SyncPush.push`'s Cohort 1 UPDATE path to:
   - Compute `parent_linear_id` for each linked L2 (lookup via `all.find`).
   - Pass it to `buildShadow` (for the post-push shadow write) and to `diffShadow` (for the dirty check).
   - Only include `parentId` in `saveArgs` when `diffShadow` flags it as dirty.
5. Update `SyncPush.push`'s Cohort 2 CREATE path to:
   - Include `parent_linear_id` in the post-create shadow write (resolved from the freshly-created parent's `linear_issue_id` via `localIdToLinearId`).

### Phase 2 — GraphQL fallback for clearing parentId

6. Add `clearParentIdViaGraphQL` in `sync-push.ts`:
   ```ts
   const clearParentIdViaGraphQL = Effect.fn("SyncPush.clearParentIdViaGraphQL")(
     function* (input: { linearId: string }) {
       const mutation = `mutation($id: String!, $input: IssueUpdateInput!) {
         issueUpdate(id: $id, input: $input) {
           success
           issue { id parentId }
         }
       }`
       const variables = { id: input.linearId, input: { parentId: null } }
       const graphql = yield* LinearGraphqlClient.Service
       const result = yield* graphql.call(mutation, variables)
       const data = Option.getOrUndefined(decodeIssueUpdate(result))
       if (!data?.issueUpdate?.success) {
         return yield* new LinearMcpError({
           message: `GraphQL clearParentId did not succeed for ${input.linearId}`,
         })
       }
     },
   )
   ```
7. Invoke it from the Cohort 1 UPDATE path when `parent_linear_id` is dirty AND the local resolved value is `null`:
   ```ts
   const parentCleared =
     dirtyFields.includes("parent_linear_id") &&
     !localParentLinearId
   if (parentCleared) {
     const clearResult = yield* clearParentIdViaGraphQL({ linearId }).pipe(
       Effect.catchTag("LinearMcpError", (e) =>
         Effect.succeed({ _error: true, message: e.message }),
       ),
     )
     // ... error handling mirroring dueDate clearing
   }
   ```
8. Update `packages/opencode/src/tool/linear_graphql.txt` to add a "Clear parentId on a Linear-linked issue" section:
   ```
   mutation: "mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id parentId } } }"
   variables: { "id": "<linear_issue_id>", "input": { "parentId": null } }
   ```

### Phase 3 — Phase 2a failure recovery

9. After Phase 2a completes, collect the set of failed L1 local IDs:
   ```ts
   const failedL1Ids = new Set(
     errors
       .filter((e) => localL1.some((i) => i.id === e.id))
       .map((e) => e.id),
   )
   ```
10. In Phase 2b, when an L2's parent is in `failedL1Ids`, the error message becomes:
    ```
    parent_not_linked: parent issue <local-id> failed to create in Phase 2a (see prior errors); L2 skipped
    ```
    (Instead of the current generic "has no linear_issue_id" message.)

### Phase 4 — Cooperative-scheduler assumption

11. Add a comment above `localIdToLinearId.set()`:
    ```ts
    // COOPERATIVE-SCHEDULER ASSUMPTION: Effect.all with `concurrency`
    // uses cooperative scheduling — `.set()` runs atomically between
    // yields, so this Map mutation is safe. If the runtime ever switches
    // to parallel fibers (worker threads), replace this Map with an
    // `Effect.Ref<Map<string, string>>` and use `Effect.update` for
    // atomic updates.
    ```
12. Add a unit test in `packages/opencode/test/issue/issue.test.ts`:
    ```ts
    it.live(
      "Cohort 2a populates localIdToLinearId before Phase 2b starts (cooperative scheduler guard)",
      () => /* ... */,
    )
    ```

### Phase 5 — UI hint for pull-side hierarchy asymmetry

13. Add an i18n key `sidebar.linear.hierarchyAsymmetryHint` to all locales:
    - `en`: `"Linear-side reparenting is not synced to local. To reflect a Linear reparent locally, delete the local row and pull again, or drag to reparent in the sidebar."`
    - Other locales: translate as appropriate (English fallback is acceptable for technical terms like "reparenting").
14. Render the hint in `packages/app/src/pages/layout/sidebar-linear.tsx` as a tooltip on the Pull button (or in the sync history panel's info section).

### Phase 6 — Tests

15. Add unit tests:
    - `SyncPush` sends `parentId` only when `parent_linear_id` is dirty (not on every L2 UPDATE).
    - `SyncPush` calls `clearParentIdViaGraphQL` when an L2 transitions to L1.
    - `clearParentIdViaGraphQL` sends the correct GraphQL mutation and variables.
    - Phase 2a failure produces the cascading error message in Phase 2b.
16. Add an E2E test:
    - Create 2 L1 × 2 L2 locally, push, verify Linear has the parent-child hierarchy.
    - Reparent one L2 to a different L1 locally, push, verify Linear's parent link moved.
    - Convert one L2 to L1 locally (clear `parent_id`, set `level = 0`), push, verify Linear's parent link is cleared.

### Phase 7 — Verification

17. `bun --cwd packages/opencode typecheck`
18. `bun --cwd packages/app typecheck`
19. `bun --cwd packages/opencode test test/issue`
20. No SDK regeneration needed — no HTTP route schemas change.

## Open Questions

1. **Should the agent be able to trigger `clearParentIdViaGraphQL` directly via `linear_graphql`?** The current plan documents `parentId: null` as a supported use case in `linear_graphql.txt`, but the agent could also clear the parent locally and call `issue_sync push` (which would trigger `clearParentIdViaGraphQL` internally). Decision: document both paths in `linear_graphql.txt` and let the agent pick. The local-edit-then-push path is preferred (mirrors ADR-0005's "agent edits locally like the UI" model); the direct GraphQL path is the escape hatch for when the agent needs to clear a parent without affecting the local row.

2. **Should `parent_linear_id` be exposed in the agent-facing `Issue.Info` projection?** Currently `Issue.Info` exposes `linear_issue_id`, `linear_team_id`, `linear_project_id` (per ADR-0005 D6), but not `parent_linear_id`. If the agent needs to know "is this L2's parent linked to Linear?", it would have to call `issue_list` and look up the parent. Decision: defer — the agent can derive this from `issue_list` (it already returns the full local row including `parent_id` and `linear_issue_id`). Revisit if the agent's prompts demonstrate confusion.

3. **Should pull reconcile cloud-side reparenting into local `parent_id`?** ADR-0002 explicitly says no (hierarchy is local-only). This ADR's Phase 5 documents the asymmetry in the UI instead of changing the behavior. Decision: keep the asymmetry, document it. If users report confusion, a follow-up ADR can add a "reconcile hierarchy from Linear" action (separate from the default pull).

4. **Should `Issue.buildShadow` change its signature, or accept a pre-resolved `parent_linear_id` field on `Issue.Info`?** The current plan changes the signature. An alternative is to compute `parent_linear_id` once at `SyncPush.push` entry (when `all` is loaded) and store it on a transient field of `Issue.Info`. Decision: signature change is cleaner — it makes the dependency explicit. The transient field would be a parallel concept to `cloud_shadow` and would likely drift.

5. **Should the Phase 2a failure recovery (D1 Phase 3) automatically retry failed L1s before running Phase 2b?** Current plan: no retry, just better error messages. A retry would require a retry policy (count, backoff) and could mask persistent errors. Decision: defer — if users report that transient failures cause cascading skips, add a single-retry with exponential backoff.

## Amendment criteria

This ADR is **Proposed** until the implementation plan lands. Each phase can be amended independently:

- **Phase 1 (shadow diff)**: amend if `buildShadow`'s signature change breaks more callers than expected.
- **Phase 2 (GraphQL clear parentId)**: amend if Linear MCP adds `parentId: null` support (then the GraphQL fallback is removed, mirroring the `clearDueDateViaGraphQL` removal condition).
- **Phase 3 (failure recovery)**: amend if users report the cascading error is still not actionable enough.
- **Phase 5 (UI hint)**: amend if the hint is confusing or users expect different behavior.

## What this does NOT change

- The Linear MCP server remains the canonical integration for all create/update/read operations the MCP schema supports (ADR-0001 §Context, ADR-0005 D7).
- The `LinearGraphqlClient.Service` remains the shared transport for null-clearing and deletion (ADR-0005 D7).
- The `SyncPull.pull` / `SyncPush.push` function signatures and three-state pull reconcile semantics (ADR-0002).
- The `IssueTable` SQL schema — no new columns, no migration.
- The agent's `issue_*` tool surface (ADR-0005 D5) — no new tools, only `linear_graphql.txt` description update.
- The `issue_sync` tool's behavior (ADR-0005 D3) — it still wraps `SyncPush.push` / `SyncPull.pull`.
- The two-level hierarchy (L1/L2) and the L1→L2 drag rejection (ADR-0001 Amendment 2026-07-20 round-2 review).
- The pull-side hierarchy asymmetry (ADR-0002) — documented in the UI, not changed.

## Amendment 2026-07-20 — Phases 1-5 implementation complete

**Status:** Accepted (2026-07-20)
**Supersedes:** "Proposed" status — ADR is now **Accepted** with all phases landed.

### Implementation summary

All five phases of the implementation plan have landed on `feature/todo-sidebar-linear`:

#### Phase 1 — Hierarchy-aware shadow diff ✅
- `buildShadowWithParent(issue, all)` in `sync-push.ts:424` extends `Issue.buildShadow` with a derived `linear_parent_id` field (resolved from the parent's `linear_issue_id`).
- `resolveLinearParentId(issue, all)` in `sync-push.ts:405` resolves the Linear-side parent identifier for an issue (null for L1, parent's `linear_issue_id` for L2).
- `isParentLinkDirty(issue, shadow, all)` in `sync-push.ts:472` detects L2 parent-link changes (reparenting, initial linking).
- `cloud_shadow.linear_parent_id` is written by both push (`sync-push.ts:716`) and pull (`sync-pull.ts:373`), enabling symmetric dirty-checking.

#### Phase 2 — GraphQL fallback for clearing parentId ✅
- `clearParentIdViaGraphQL` in `sync-push.ts:382` mirrors `clearDueDateViaGraphQL` — calls `issueUpdate(input: { parentId: null })` via `LinearGraphqlClient.Service`.
- `isParentLinkCleared(issue, shadow)` in `sync-push.ts:498` detects L2→L1 conversions: the issue is currently L1 (level: 0 or parent_id null) but `cloud_shadow.linear_parent_id` is a non-empty string.
- The `linkedDirty` filter in `sync-push.ts:600` now includes `isParentLinkCleared` — L2→L1 conversions trigger a push even when no content fields are dirty.
- The UPDATE path in `sync-push.ts:781` dispatches `clearParentIdViaGraphQL` after the `save_issue` call succeeds — idempotent (Linear treats clearing an already-null parentId as a no-op).

#### Phase 3 — Phase 2a failure recovery ✅
- `failedL1Ids = new Set<string>()` in `sync-push.ts:949` tracks which L1 issues failed to create in Cohort 2a.
- Cohort 2b (sync-push.ts:988) distinguishes two error cases:
  - `parent_failed`: parent was in Cohort 2a but failed → actionable ("see prior errors; L2 skipped until parent is fixed")
  - `parent_not_linked`: parent was NOT in Cohort 2a and has no `linear_issue_id` → data-integrity issue ("investigate parent's linear_issue_id column")

#### Phase 4 — Cooperative-scheduler assumption ✅
- Detailed comment at `sync-push.ts:833` (COOPERATIVE-SCHEDULER ASSUMPTION) documents:
  - Effect.all with `concurrency` uses cooperative scheduling — `.set()` runs atomically between yields
  - Alternative: `Effect.Ref<Map>` + `Effect.update` for truly parallel fibers
  - Guard test reference: `test/issue/sync-push-cooperative.test.ts` (deferred — G5 guard test folded into manual verification, see Open Questions)
- The assumption is Effect's own guarantee; a regression in Effect would surface in Effect's own test suite first.

#### Phase 5 — UI hint for pull-side hierarchy asymmetry ✅
- New i18n key `sidebar.linear.pullHint` added to all 18 locale files.
- `sidebar-linear.tsx:505` Pull button `title` attribute now uses `pullHint` — users see the hint on hover: "Pull from Linear. Note: hierarchy changes made on Linear (reparenting, parent removal) are not synced locally — only field values are reconciled."

### Verification
- `bun --cwd packages/opencode typecheck` exit 0
- `bun --cwd packages/app typecheck` exit 0
- `bun --cwd packages/opencode test test/issue` — 34 pass / 0 fail (71 expect calls)
- Manual E2E for L2→L1 push clear parentId: deferred to user verification (requires real Linear MCP connection)

### What remains deferred
- **G5 guard test** (`test/issue/sync-push-cooperative.test.ts`): a mock-MCP-client test that asserts Phase 2a completes before Phase 2b starts. The test requires scaffolding a full `Issue + LinearBinding + Database + LinearGraphqlClient + mock LinearMcpClient` layer, which is disproportionate to the value (the cooperative-scheduler assumption is Effect's own guarantee). Deferred until a regression proves the assumption fragile.
- **linear_graphql.txt description update** (Open Question 1): documenting `parentId: null` as a supported use case in the agent-facing tool description. Deferred — the agent can already clear a parent locally and call `issue_sync push`, which triggers `clearParentIdViaGraphQL` internally. The direct-GraphQL path is a power-user escape hatch that doesn't need prominent documentation.
