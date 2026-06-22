---
name: remove-ai-slops
description: "Remove AI-generated code smells (slop) from branch changes or an explicit file list. Locks behavior with regression tests FIRST, then runs categorized cleanup via parallel `deep` agents in batches of 5, then verifies with quality gates. Covers 10 slop categories including performance equivalences, excessive complexity (object annotations, if/elif variant chains), and oversized modules (250+ pure LOC with mandatory modular refactoring). MUST USE when the user asks to \"remove slop\", \"clean AI code\", \"deslop\", \"clean up AI-generated code\", \"remove AI slop\", or wants to clean up AI-generated patterns from recent changes. Triggers - \"remove ai slops\", \"clean ai code\", \"deslop\", \"cleanup AI generated\", \"remove AI slop\", \"clean up AI-generated code\", \"strip slop\", \"ai-slop cleanup\"."
---

# Remove AI Slops Skill

## Inputs

- **Default scope**: branch diff vs `merge-base main` (no arguments needed)
- **Optional scope**: explicit file list passed by the caller (e.g., a Ralph workflow's changed-files set)

## What this skill does

Cleans AI-generated slop from a bounded set of changed files while strictly preserving behavior. Locks behavior with regression tests first, then runs a categorized multi-pass cleanup, then verifies with quality gates and a critical review. Reverts and direct-edits when verification fails.

The core safety invariant: **behavior is locked by green tests before a single line is removed**. A checklist alone is not safety; a passing regression test is.

---

## Categories (what counts as slop)

The agent looks for these nine categories. The first three are stylistic, the next three are structural, the next two are about hidden cost, and the last is about behavior coverage.

### Stylistic
1. **Obvious comments** — comments restating code, trivial docstrings, section dividers, commented-out code, vague TODOs/Notes.
   - KEEP: comments explaining WHY (business logic, edge cases, workarounds), ticket links, regex/algorithm explanations.
   - KEEP: BDD markers (`# given`, `# when`, `# then`, `# when/then`).

2. **Over-defensive code** — null checks for guaranteed values, try/except around code that cannot raise, isinstance checks for statically typed params, default values for required params, backward-compat shims, redundant validation duplicated at multiple layers, **broad exception catching** (`except Exception`/`except BaseException` in Python, empty `catch {}` or `catch (e) { console.error(e) }` without narrowing in TypeScript/JavaScript).
   - KEEP: validation at system boundaries (user input, external APIs), I/O error handling, nullable DB fields. Top-level boundary catch-all (CLI `main()`, HTTP handler) with explicit logging + re-raise is acceptable.
   - REFACTOR: `except Exception` → catch the specific exception you expect. Empty `catch {}` → add `instanceof` narrowing or re-throw. `catch (e) { log(e) }` → narrow with `instanceof`, handle known cases, re-throw unknown.

3. **Excessive complexity** — deep nesting (>3 levels), nested ternaries, complex boolean expressions (combine 4+ predicates), long parameter lists (>5 args without a struct/dataclass/object), god functions (>50 lines doing many things), overly clever one-liners that sacrifice readability, `if/elif/else` chains for type/enum/literal discrimination (must be `match/case` + `assert_never`), `object` used as a type annotation (must be `Protocol`, `TypeVar`, or explicit union).
   - KEEP: established complexity patterns in this codebase, performance-critical hot paths that intentionally use a complex idiom. `if/else` for boolean conditions and range checks (not variant discrimination).
   - REFACTOR: nested if-chains → guard clauses / early returns. Complex ternaries → explicit if/else. isinstance/enum if/elif chains → `match/case` with `assert_never` on the wildcard. `object` annotations → `Protocol` (structural), `TypeVar` (generic), or union (known variants).

### Structural
4. **Needless abstraction** — pass-through wrappers, single-use helpers, speculative indirection ("we might need this later"), interfaces with one implementer where the interface adds no testability win, factory functions that just call a constructor.
   - KEEP: abstractions that provide a real seam (testability, multiple implementers, framework-required boundaries).

5. **Boundary violations** — wrong-layer imports (UI importing DB driver), leaky responsibilities (handler doing business logic that belongs in a service), hidden coupling (module A reads module B's private state), side effects in pure-named functions.
   - KEEP: pragmatic short-circuits already established as a pattern in this codebase. Flag for human judgment if unsure.

6. **Dead code** — unused imports, unused private functions/methods, unreachable branches, stale feature flags, debug leftovers (`console.log`, `print(...)`, `dbg!`), removed-but-still-referenced code.
   - KEEP: code referenced via reflection, dynamic dispatch, or string lookup. Code intentionally kept as a feature flag rollback path (verify with the user).

### Hidden cost
7. **Duplication** — copy-pasted branches with trivial differences, redundant helpers that do the same thing in two places, repeated literal/magic-number sequences.
   - KEEP: incidental duplication (two pieces of code that look similar but serve different intents that could diverge). Prefer leaving them separate over forcing a premature shared abstraction.

8. **Performance equivalences (behavior-preserving optimizations)** — changes that are provably equivalent in semantics but cheaper in time/space:
   - O(n²) → O(n) when correctness preserved (e.g., set lookup vs list scan)
   - Repeated computation inside a loop → hoist outside
   - Unnecessary intermediate collections (eager `list(...)` when only iterated once → generator)
   - String concatenation in loop → `join`
   - Redundant DB/API calls in a loop → batch
   - Redundant deep copies / clones
   - `.length` / `len()` recomputed inside loop → cache

   **Hard rule**: only apply when behavior equivalence is obvious. Do NOT change algorithms with subtle correctness implications. Do NOT micro-optimize hot paths without a benchmark. If in doubt, SKIP.

### Behavior coverage
9. **Missing tests** — behavior present in changed files that is not locked by any regression test. The fix is not to remove code but to ADD the narrowest test that pins the behavior.

### Structural
10. **Oversized modules** — any source file exceeding **250 pure LOC** (non-blank, non-comment lines). This is an architectural defect, not a style preference. Measure: `awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(#|\/\/)/' <file> | wc -l`.

   **When found, do NOT just flag it. Execute a full modular refactoring:**
   1. Run `check-no-excuse-rules.py` recursively on scope to list all violations.
   2. For each oversized file, identify distinct responsibilities (single-responsibility principle).
   3. Plan the split: name each new file after the concept it owns (never `utils.py`, `helpers.py`, `common.py`, `part_1.py`).
   4. Present the split plan to the user before executing.
   5. Extract into clean modules with explicit `__init__.py` re-exports (re-exports ONLY, no logic in `__init__.py`).
   6. Verify: run `check-no-excuse-rules.py` again — every file must be ≤250 pure LOC. Run tests, typecheck, lint.

   **Forbidden escapes**:
   - Counting blanks/comments toward budget.
   - Splitting by token count (`foo_1.py`, `foo_2.py`) — split by what each file DOES.
   - Catch-all dump files (`utils.py`, `helpers.py`, `service.py`).
   - "It's generated" — only valid if the file lives in a build output directory.
   - "230 LOC, close enough" — a 230-LOC file about to grow is already over. Split now.

   KEEP: genuinely self-contained single-responsibility scripts (e.g., a standalone CLI checker). Opt out with `# noqa: SIZE_OK` in first 5 lines and a comment explaining why.

---

## Quality Gates

A pass is complete only when all applicable gates are green. Skip gates that are genuinely N/A for the project (e.g., no security scanner configured), and report `N/A` explicitly — do not silently skip.

| Gate | Tool | Pass condition |
|---|---|---|
| Regression tests | project's test runner | all green |
| Lint | project's linter | zero errors (warnings OK if pre-existing) |
| Typecheck | `lsp_diagnostics` on changed files + project type-checker | zero new errors |
| Unit/integration tests | project's test runner | all green (pre-existing failures noted, not introduced) |
| Static/security scan | project's scanner | zero new findings, or `N/A` if not configured |

---

## Process

### Phase 0: Plan with TodoWrite

Create todos for all phases below. Mark `in_progress` one at a time.

### Phase 1: Determine scope

If file paths were passed as arguments, that is the scope. Otherwise:

```bash
git diff $(git merge-base main HEAD)..HEAD --name-only
```

Filter out: deleted files, binary files, generated/vendored files (`node_modules/`, `dist/`, `target/`, lockfiles). List the final scope.

### Phase 2: Lock behavior with regression tests (NEW — non-negotiable)

For each in-scope source file:

1. Identify the public/observable behavior the file exposes (exported functions, HTTP handlers, CLI commands, classes used elsewhere).
2. Check whether existing tests cover that behavior. Use `git grep` / project test conventions to find related test files.
3. **If behavior is uncovered or weakly covered, write the narrowest regression test that pins current behavior BEFORE editing the file.** Tests should pin observable outputs, not implementation details.
4. Run the test suite (or at minimum the relevant tests). They must be **green** before any cleanup begins.

If you cannot establish a green baseline (e.g., test runner is broken), STOP and report. Do not proceed with cleanup on unverified ground.

### Phase 3: Cleanup plan

Produce an explicit plan **before** spawning the removal agents:

```
File: src/foo.py
  Categories: dead code, excessive complexity, performance
  Order: dead code → complexity → performance
  Risk: medium (touches caching layer)

File: src/bar.py
  Categories: obvious comments, over-defensive
  Order: comments → defensive
  Risk: low
```

Order rule (safest → riskiest): comments → dead code → defensive → duplication → complexity → abstraction/boundary → performance → tests → oversized-modules. This minimizes blast radius of any one change.

### Phase 4: Parallel slop removal via `deep` agents in batches of 5

Files are processed by `deep` category agents with the `$omo:remove-ai-slops` skill loaded, **batched 5 at a time in parallel**. The executable skill name is `remove-ai-slops`. The `deep` category gives the agent enough thoroughness to correctly evaluate the 9 categories and respect the KEEP rules without slipping into surface fixes; the 5-wide batch is the sweet spot — more than 5 creates result-merging noise and context contention, fewer wastes parallelism.

**Batching protocol** (strict):

1. Slice the in-scope file list into chunks of up to 5 files.
2. For each chunk, launch all `task` calls **in a single message**, every one with `run_in_background=true`.
3. End your turn. Wait for the system to send `<system-reminder>` notifications as each task finishes.
4. Once all 5 in the batch complete, collect each result via `background_output(task_id=...)`.
5. Launch the next batch of 5. Repeat until every file is processed.
6. If total files ≤ 5, launch all in one batch.

**Never** launch all files at once when there are more than 5; **never** launch them serially when more than one remains in the current batch.

**Per-file invocation** (one of the 5 in a batch):

```
task(
  category="deep",
  load_skills=["remove-ai-slops"],
  run_in_background=true,
  description="Slop removal: {filename}",
  prompt="""
Remove AI slops from: {file_path}

In addition to your default categories (obvious comments, over-defensive code, spaghetti nesting), also evaluate these categories:
- Excessive complexity: god functions, long parameter lists, complex booleans, nested ternaries
- Needless abstraction: pass-through wrappers, single-use helpers, speculative indirection
- Boundary violations: wrong-layer imports, leaky responsibilities, hidden coupling
- Dead code: unused imports, unreachable branches, stale flags, debug leftovers
- Duplication: copy-paste branches, redundant helpers
- Performance equivalences: O(n²)→O(n) via set lookup, hoist computation out of loops, eager→lazy collections, batch redundant calls, cache repeated len()/length

Apply changes in this order (safest → riskiest): comments → dead code → defensive → duplication → complexity → abstraction/boundary → performance → oversized-modules.

Hard constraints:
- Behavior MUST be preserved. When equivalence is not obvious, SKIP.
- Do NOT change public API signatures.
- Do NOT remove type hints.
- Do NOT introduce new abstractions or dependencies.
- Diff stays minimal and scoped to slop removal.

Report changes grouped by category. For each change, give before/after, why-slop, why-safe.
For each skipped issue, give reason.
"""
)
```

**Batch failure handling**: a `multi_agent_v1.wait_agent` timeout only means no new mailbox update arrived, not that a `deep` agent failed. For long passes, require each child to send `WORKING: <file> - <current phase>` and `BLOCKED: <reason>` only when it cannot progress. Treat a running child as alive. Mark a file for retry only when the child is completed without the deliverable, ack-only after followup, explicitly `BLOCKED:`, or no longer running. Do NOT block the remaining 4 in that batch; collect successful results and retry the failed file once later. If retry also fails, escalate that file under "Issues Found & Fixed" in the final report.

### Phase 5: Verify with quality gates + critical review

Run the five quality gates listed above. Then walk the critical review checklist:

**Safety**:
- [ ] No functional logic accidentally removed
- [ ] All error handling preserved (especially around I/O, network, external APIs)
- [ ] Type hints intact and correct
- [ ] Imports still valid
- [ ] No breaking changes to public APIs

**Behavior**:
- [ ] Return values unchanged (verified by Phase 2 regression tests)
- [ ] Side effects unchanged
- [ ] Exception behavior unchanged
- [ ] Edge case handling preserved

**Quality**:
- [ ] Removed changes are genuinely slop, not intentional patterns
- [ ] Remaining code follows project conventions
- [ ] No orphaned code or dead references
- [ ] Performance changes are obviously equivalent (no subtle algorithm shifts)
- [ ] No new abstractions introduced

### Phase 6: Fix issues

If any gate fails or any checklist item flips:

1. Identify the specific change that caused the failure.
2. Explain why it broke things.
3. `git checkout` the affected file (or use `git diff` + targeted `Edit` to revert just the problematic hunk).
4. If genuine slop remains after revert, edit the file directly yourself — in parallel per file via multiple Edit calls — applying only the changes you can prove are safe.
5. Re-run the failing gate and re-walk the checklist for the affected file.
6. Repeat until all gates green AND checklist clean.

If you fail three times on the same file, STOP and escalate to the user with: the file, what you tried, what failed, your hypothesis. Do not keep editing.

---

## Output Format

```text
AI SLOP REMOVAL REPORT
======================

Scope: [branch diff vs merge-base main / explicit file list]
Files: [N files]
  - path/to/file1.ts
  - path/to/file2.py

Behavior Lock:
  - Existing coverage: [N files already covered]
  - Tests added: [M new regression tests at path/to/test_X.py]
  - Baseline status: GREEN

Cleanup Plan:
  - path/to/file1.ts: [dead code → complexity → performance]
  - path/to/file2.py: [comments → defensive]

Per-File Results:
  path/to/file1.ts
    - Dead code: 3 removed (lines X-Y, A-B, C)
    - Excessive complexity: 1 simplified (nested ternary at L42 → if/else)
    - Performance: 1 (line N: list scan → set lookup, O(n²)→O(n), behavior identical)
    - Skipped (preserved): 2 (defensive null check at boundary; commented WHY at L88)

  path/to/file2.py
    - Obvious comments: 5 removed
    - Over-defensive: 1 simplified (redundant isinstance on typed param)

Quality Gates:
  - Regression tests: PASS (12 tests, 0 failed)
  - Lint: PASS
  - Typecheck (lsp_diagnostics + project): PASS (0 new errors on changed files)
  - Unit/integration tests: PASS (45 tests, 0 failed)
  - Static/security scan: N/A (not configured)

Critical Review:
  - Safety: PASS
  - Behavior: PASS
  - Quality: PASS

Issues Found & Fixed:
  - [None] OR [Issue description → Fix applied]

Remaining Risks / Deferred:
  - [None] OR [e.g., "boundary violation in module X flagged but not refactored — needs human judgment"]

Final Status: CLEAN | ISSUES FIXED | REQUIRES ATTENTION
```

---

## Anti-Patterns (do not do these)

- **Skipping Phase 2.** Removing code on uncovered ground is a behavior-change time bomb regardless of how careful the agent is. The regression test IS the safety mechanism; the checklist is its complement, not its replacement.
- **Bundling unrelated refactors.** A single "cleanup" commit with dead code deletion + abstraction removal + performance change is impossible to review and impossible to bisect. Stay scoped to slop.
- **Algorithm changes disguised as performance optimization.** If equivalence requires a proof, it is not a slop fix — it is a refactor and belongs in a separate change.
- **Silent skips.** If a quality gate is N/A, say `N/A` and why. If a check failed and you could not fix it, say so. Never claim PASS without evidence.
- **Removing comments that explain WHY.** "It is obvious from the code" is rarely true for the next reader. Only remove comments that restate WHAT.
- **Touching files outside scope.** If a file was not in the branch diff or explicit list, do not edit it, even if you notice slop in passing. Report it under "Remaining Risks".

---

## Tool Persistence

- When a tool call fails, retry with adjusted parameters.
- Never silently skip a failed tool call.
- Never claim a gate passed without running it and reading the output.
- If correctness depends on further inspection, keep using `lsp_diagnostics`, the test runner, and direct file reads until the result is grounded.

---

## Quality Assurance

- NEVER remove code that serves a functional purpose.
- ALWAYS verify changes compile/parse and pass type-check.
- ALWAYS preserve test coverage; add tests rather than remove them.
- If uncertain about a change, err on the side of keeping the original code.
- The default action when in doubt is SKIP, not GUESS.
