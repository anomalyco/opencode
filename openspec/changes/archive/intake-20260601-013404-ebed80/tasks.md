# Tasks: Upstream Sync Analysis & Planning

## Phase 1 — Custom-Change Catalog

- [ ] **Cross-reference** `FORK_WORKFLOW.md` custom-change table against `git log --all --oneline -- packages/core packages/llm packages/opencode` to verify each entry and surface any undocumented modifications; append gaps as new rows to the catalog table.
  Validation: `grep -c '^|' openspec/changes/intake-20260601-013404-ebed80/specs/initial/spec.md` returns ≥ 12 (catalog table rows).

- [ ] **Run** `git diff --name-only upstream/dev...HEAD` to produce a raw divergence list of every file that differs from upstream; write the sorted output to `specs/initial/divergence-files.txt`.
  Validation: `wc -l openspec/changes/intake-20260601-013404-ebed80/specs/initial/divergence-files.txt` returns a positive number.

- [ ] **Classify** each diverged file into one of three categories — `custom-only`, `upstream-modified`, `both` — by running `git log --all --diff-filter=M --follow -- <file>` on each; write the classification table to `specs/initial/divergence-classification.md`.
  Validation: `grep -c '^|' openspec/changes/intake-20260601-013404-ebed80/specs/initial/divergence-classification.md` returns ≥ 10.

- [ ] **For each custom-change file** identified in Phase 1, write a re-application procedure: upstream commit range that changed the file, conflict risk (low/medium/high), and exact re-application steps; append to `specs/initial/reapplication-procedures.md`.
  Validation: `grep -c '^## ' openspec/changes/intake-20260601-013404-ebed80/specs/initial/reapplication-procedures.md` returns ≥ 6.

## Phase 2 — Divergence Analysis Artifact

- [ ] **Write** `script/analyze-divergence.ts` — a Bun script that runs `git diff --name-only upstream/dev...HEAD`, classifies each file (custom-only / upstream-modified / both) by checking `git log` history, and outputs a structured JSON report to `stdout`; includes `--json` and `--markdown` output formats.
  Validation: `bun script/analyze-divergence.ts --help` prints usage and exits 0.

- [ ] **Run** `bun script/analyze-divergence.ts --json` and capture output to `specs/initial/divergence-report.json` to validate the script produces valid JSON with at least 20 entries.
  Validation: `node -e "JSON.parse(require('fs').readFileSync('openspec/changes/intake-20260601-013404-ebed80/specs/initial/divergence-report.json','utf8'))" && echo OK` prints OK.

- [ ] **Write** `script/tag-upstream.sh` — a shell helper that tags the current `dev` commit with `fork/YYYY-MM-DD.N` (auto-incrementing N), pushes the tag to origin, and prints the tag name; includes `--dry-run` mode.
  Validation: `bash script/tag-upstream.sh --dry-run` prints the would-be tag name and exits 0.

## Phase 3 — Sync Procedure & Test Plan

- [ ] **Draft** the step-by-step sync procedure in `specs/initial/sync-procedure.md` covering: pre-checks (fetch, worktree cleanup), merge execution, conflict resolution guidance, merge-back steps, tagging, and worktree cleanup; cross-reference `FORK_WORKFLOW.md` for existing steps.
  Validation: `grep -c '^### ' openspec/changes/intake-20260601-013404-ebed80/specs/initial/sync-procedure.md` returns ≥ 7.

- [ ] **Write** the validation test plan as `specs/initial/test-plan.md` with specific commands and expected outcomes: `bun typecheck`, `bun build`, smoke test (`opencode --version`), and provider discovery checks; include a conflict-resolution decision tree.
  Validation: `grep -c '^-' openspec/changes/intake-20260601-013404-ebed80/specs/initial/test-plan.md` returns ≥ 8.

- [ ] **Document** the Skein port update procedure in `specs/initial/skein-port-update.md`: how to identify the tagged fork snapshot, update Go module references in skein, verify build, and commit the port.
  Validation: `grep -c '^## ' openspec/changes/intake-20260601-013404-ebed80/specs/initial/skein-port-update.md` returns ≥ 4.

## Phase 4 — Consolidated Reference Document

- [ ] **Write** `docs/UPSTREAM_SYNC.md` that consolidates: custom-change catalog (from Phase 1), divergence classification (from Phase 2), sync procedure (from Phase 3), validation test plan, tagging discipline, and Skein port update steps; cross-link to individual spec files.
  Validation: `grep -c '^# ' docs/UPSTREAM_SYNC.md` returns ≥ 7.

- [ ] **Update** `FORK_WORKFLOW.md` to reference `docs/UPSTREAM_SYNC.md` as the authoritative source and remove duplicated catalog content (keep only the quick-sync procedure and worktree commands).
  Validation: `grep -c 'UPSTREAM_SYNC.md' FORK_WORKFLOW.md` returns ≥ 1.

## Phase 5 — Verification

- [ ] **Run** `bun typecheck` from `packages/opencode` to verify the new TypeScript script (`analyze-divergence.ts`) type-checks cleanly.
  Validation: `bun typecheck` exits 0 in `packages/opencode`.

- [ ] **Run** `bun script/analyze-divergence.ts --markdown` and verify the markdown output is well-formed (no broken headings, all sections present).
  Validation: `bun script/analyze-divergence.ts --markdown | grep -c '^## '` returns ≥ 3.

- [ ] **Review** `docs/UPSTREAM_SYNC.md` end-to-end for completeness: every custom change has a file path, every sync step has a command, every test has an expected outcome.
  Validation: `grep -c 'TODO\|FIXME\|PLACEHOLDER' docs/UPSTREAM_SYNC.md` returns 0.
