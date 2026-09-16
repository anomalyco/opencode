# Engineering Memory Branch — Behavior Review

**Branch:** `feat/engineering-memory-v1` @ `b6a571d982`
**Base:** `origin/dev` (`origin/main` does not exist)
**Scope:** `origin/dev..HEAD` — 7 commits, 64 files, +6959/-57
**Method:** read + test only. No rebase, PR, merge, source edits, commits, or pushes.
**Date:** 2026-09-16

## Risk 1 — First-turn retrieval

- **Claim:** Knowledge retrieval on the first turn cannot crash a session, injects nothing when disabled or empty, and adds no serialized latency.
- **Evidence:**
  - Gated by `Flag.OPENCODE_EXPERIMENTAL_KNOWLEDGE` (`guidance.ts:72` returns `SystemContext.empty` before any I/O); flag is falsy unless `OPENCODE_EXPERIMENTAL_KNOWLEDGE`/`OPENCODE_EXPERIMENTAL` is set (`flag.ts:11-13,60-62`).
  - Four nested fail-to-empty layers: `retrieval.ts` init→noop (incl. `catchDefect`), guidance `peekPending`, history load, and `retrieval.search` — all `catch`/`catchDefect` to empty.
  - Budgets: `MIN_QUERY_CHARS=12`, `TOP_K=3`, `MAX_TOTAL_CHARS=2500`, `MAX_PER_DOC_CHARS=1000`; zero docs → `SystemContext.empty` (no injection). Engine-level abstention gate on top.
  - Runs concurrently with 3 other context loads (`llm.ts` `Effect.all`, `concurrency: "unbounded"`).
  - Flag-off test proves zero queries and system `["Initial context"]`; flag-on tests prove pending-steer/queue/history paths.
- **Commands / exits:**
  - `bun test test/knowledge/` (packages/core) → 9 pass / 0 fail, exit 0.
- **Affected files:** `packages/core/src/knowledge/guidance.ts`, `packages/core/src/knowledge/retrieval.ts`, `packages/core/src/session/runner/llm.ts`, `packages/core/src/flag/flag.ts`.
- **Risk:** No test drives a *throwing* retriever through `guidance.load` (failure path is code-evident, not test-covered). `vectorSearch` is a full-table scan O(n) — fine at ~523 rows, unbounded growth unmeasured. No live first-turn latency measured.
- **Verdict:** PASS_WITH_LIMITATION

## Risk 2 — learn.ts write paths

- **Claim:** No automatic admission; staging and knowledge writes are separated; failures leave no partial knowledge behind.
- **Evidence:**
  - `resolveMemoryPaths` refuses `staging === knowledge` (learn.ts:108-118).
  - `propose` writes staging only, all-pending, no approval/admission/knowledge writes (learn.ts:124-147).
  - Review commands are staging-only; `approve`/`reject`/`supersede` go through `decide()` (pending-only/B0 validity). No approve-and-admit path exists (separate yargs commands).
  - `admit` refuses non-approved (`admission.ts` `toChunk` gate + `validateCandidate` problems check), verifies persistence (self-match ≥0.99) and retrievability, compensates by deleting its own chunk on post-write failure and rethrows. Staging is only read (`get`/`list`) during admit.
  - All 7 DB-touching functions open handles explicitly and close in `finally`.
- **Commands / exits:**
  - `bun test test/cli/learn-memory.test.ts` (packages/opencode) → 29 pass / 0 fail, exit 0.
- **Affected files:** `packages/opencode/src/cli/cmd/learn.ts`, `packages/knowledge-engine/src/admission.ts`, `packages/knowledge-engine/src/staging.ts`.
- **Risk:** `propose` stages rows one-by-one with no cross-row transaction — a mid-batch failure leaves partial staging rows (audit store, low severity, unreported count). No test asserts the compensation path against a failing verifier (code-evident only).
- **Verdict:** PASS_WITH_LIMITATION

## Risk 3 — Empty-XDG search (packaged binary)

- **Claim:** With no corpus and no env override, `search` starts, reports honestly, touches nothing else, and creates storage only on demand.
- **Evidence:** Fresh `XDG_DATA_HOME=/tmp/opencode/empty-xdg`, env unset, rebuilt binary: `search "useEffect cleanup"` → exit 0, honest Arabic no-results message, created only `<xdg>/opencode/knowledge.db(+wal/shm)`. Corpus `packages/knowledge-engine/knowledge.db` untouched (Sep 13 mtime). Earlier same-setup runs: `--version` and `session list` exit 0 with zero knowledge files created.
- **Commands / exits:** binary `search` → exit 0; `find` shows only the on-demand DB; `ls -l` corpus unchanged.
- **Affected files:** `packages/knowledge-engine/src/paths.ts`, `src/vector-db.ts`, `src/staging.ts`, `src/cli.ts` (opencode `search` command path).
- **Risk:** The no-results message does not distinguish "empty database" from "no match" and does not point at `OPENCODE_KNOWLEDGE_DB` — usability gap, not a defect. No synthetic data was created for this proof.
- **Verdict:** PASS_WITH_LIMITATION

## Risk 4 — Barrel default-instance removal

- **Claim:** Removing eager default singletons breaks no declared API consumed in-repo; all public entry points import side-effect free.
- **Evidence:**
  - Repo-wide search: zero default imports of the barrel or of `manager`/`retriever`/`middleware`/`vector-db` outside the engine itself; zero `@opencode-ai/knowledge-engine/<subpath>` imports anywhere (only the pre-existing type-only barrel import in core).
  - `package.json` subpath exports (`.`, `./retriever`, `./integration`, `./manager`) keep every named export; only the instantiating defaults were removed. Remaining defaults are side-effect free (classes, pure embedder/extractor).
  - Source-mode import of all four entry points under a temp `XDG_DATA_HOME` → ok, exit 0, zero files created. Packaged barrel proof → `barrel-import-ok`, exit 0, zero files created.
- **Commands / exits:** entry-point import script → exit 0; `find` empty.
- **Affected files:** `packages/knowledge-engine/src/index.ts`, `src/retriever.ts`, `src/manager.ts`, `src/middleware.ts`, `src/agents.ts`, `src/agent-integration.ts`, `src/vector-db.ts`, `src/cli.ts`.
- **Risk:** Out-of-repo consumers (external plugins/SDKs) are undiscoverable from here; if any relied on the removed defaults, this is a breaking change for them. No deprecation alias was left.
- **Verdict:** PASS_WITH_LIMITATION

## Commit scope classification (content-level)

| Commit | Files | Verdict |
|---|---|---|
| `1d4420a045` feat(knowledge) — 30 files, all in `packages/knowledge-engine/` | ATOMIC_AND_COHERENT |
| `d6b3a8bf54` feat(core) — knowledge/{guidance,retrieval}, flag, session wiring + tests | ATOMIC_AND_COHERENT |
| `efda00b601` feat(cli) — learn/project/search + runtime wiring + learn-memory test (+mechanical bun.lock) | ATOMIC_AND_COHERENT |
| `3ccd908349` chore(git) — `.gitignore` only | ATOMIC_AND_COHERENT |
| `3ab225dc24` feat(opencode) — MCP codemode + skills + report (reviewed in-session) | ATOMIC_AND_COHERENT |
| `70726bd70d` fix(core) — 1-line mergeAll + contract test (reviewed in-session) | ATOMIC_AND_COHERENT |
| `b6a571d982` fix(knowledge) — 12 files, all in `packages/knowledge-engine/` (reviewed in-session) | ATOMIC_AND_COHERENT |

No MIXED_SCOPE, no REQUIRES_SPLIT. Historical note: the packaged-startup defect was introduced in `1d4420a045` (eager defaults) and repaired in-branch by `b6a571d982` — the tip is coherent, but a reviewer reading commits in order should know the middle of the stack does not start packaged-clean on its own.

## Updated checklist (evidence only)

- [x] Working Tree clean; local == fork @ `b6a571d982`
- [x] Correct base is `origin/dev` (`origin/main` does not exist)
- [x] 7-commit log known; titles verified
- [x] No DB/dist/Playwright outputs tracked
- [x] Per-commit scope isolation proven by content (table above)
- [x] First-turn retrieval behavior reviewed → PASS_WITH_LIMITATION
- [x] learn.ts write paths reviewed → PASS_WITH_LIMITATION
- [x] Empty-XDG behavior reviewed → PASS_WITH_LIMITATION
- [x] Public export compatibility reviewed → PASS_WITH_LIMITATION
- [x] Targeted tests completed (9 core knowledge, 29 learn-memory, 80 engine, packaged proofs)
- [ ] Latest origin/dev fetched
- [ ] Rebase impact reviewed
- [ ] CI result available
- [ ] Final PR diff reviewed

```
ENGINEERING_MEMORY_BRANCH_BEHAVIOR_REVIEW_COMPLETE
```
