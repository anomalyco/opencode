# Limit Pre-Push Typecheck Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit the repository's Husky pre-push typecheck to three parallel Turbo tasks.

**Architecture:** Modify only the pre-push hook to call the existing Turbo `typecheck` task graph with an explicit `--concurrency=3` argument. Keep the root package script and CI behavior unchanged.

**Tech Stack:** POSIX shell, Husky, Bun, Turborepo 2.8.13

## Global Constraints

- The concurrency value is exactly `3`.
- Only `.husky/pre-push` changes during implementation.
- The root `typecheck` package script remains unchanged.
- Validation must not execute the full typecheck workload.

---

### Task 1: Limit the pre-push typecheck

**Files:**
- Modify: `.husky/pre-push:20`
- Test: static shell assertions and Turbo dry-run

**Interfaces:**
- Consumes: the existing Turborepo `typecheck` task graph.
- Produces: a pre-push hook that schedules at most three Turbo tasks concurrently.

- [ ] **Step 1: Run the failing static assertion**

```bash
grep -Fx 'bun turbo typecheck --concurrency=3' .husky/pre-push
```

Expected: exit status `1` because the hook currently contains `bun typecheck`.

- [ ] **Step 2: Apply the minimal implementation**

Replace:

```sh
bun typecheck
```

with:

```sh
bun turbo typecheck --concurrency=3
```

- [ ] **Step 3: Run the passing static assertions**

```bash
grep -Fx 'bun turbo typecheck --concurrency=3' .husky/pre-push
! grep -Fx 'bun typecheck' .husky/pre-push
```

Expected: both assertions exit with status `0`.

- [ ] **Step 4: Validate shell syntax and Turbo argument parsing**

```bash
sh -n .husky/pre-push
bun turbo typecheck --concurrency=3 --dry=json >/tmp/opencode-typecheck-dry-run.json
jq -e '.tasks | type == "array"' /tmp/opencode-typecheck-dry-run.json
rm -f /tmp/opencode-typecheck-dry-run.json
```

Expected: all commands exit with status `0`; no `tsgo` typecheck workers are launched.

- [ ] **Step 5: Commit the hook change**

```bash
git add -- .husky/pre-push
git commit -m "fix: limit pre-push typecheck concurrency" -- .husky/pre-push
```

Expected: one commit containing only `.husky/pre-push`.
