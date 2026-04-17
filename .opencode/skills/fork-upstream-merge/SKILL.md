---
name: fork-upstream-merge
description: Merge the latest upstream OpenCode changes into this fork safely
---

# Fork Upstream Merge

Use this skill when the goal is to pull the newest features from the official OpenCode repository into this fork.

## Scope

- Upstream repository: `anomalyco/opencode`
- Default upstream branch: `dev`
- Default fork branch: `dev`
- This fork may contain local patches that must be preserved

## Workflow

1. Confirm remotes.
   - `origin` should point at the fork.
   - `upstream` should point at `https://github.com/anomalyco/opencode.git`.
2. Inspect divergence before changing anything.
   - Compare `origin/dev...upstream/dev`.
   - Read only the files that differ or the files implicated by merge conflicts.
3. Create a sync branch from the fork branch.
   - Example: `sync/upstream-dev-YYYYMMDD`.
4. Merge upstream into the sync branch.
   - Prefer a merge commit over rebasing fork history.
   - Keep fork-only files and workflows unless upstream clearly replaces them.
5. Resolve conflicts with a fork-first mindset.
   - Keep official upstream behavior when it does not break fork-specific workflows.
   - Keep fork-specific automation when it only adds maintenance or release support.
   - If both sides changed the same release/build logic, preserve upstream defaults and re-apply the smallest fork delta needed.
6. Verify the touched areas.
   - Run targeted `bun typecheck` from the affected package directories.
   - Run the smallest relevant tests for changed packages.
   - If only workflow/docs changed, state that code verification was not needed.
7. Summarize for the PR.
   - What upstream feature set was merged.
   - Which fork-specific files needed manual conflict resolution.
   - Any follow-up work still needed.

## Guardrails

- Do not rewrite fork history.
- Do not force-push `dev`.
- Do not remove fork workflows unless the user asks.
- Do not silently switch updater or release endpoints without calling it out.

## Expected Output

- The sync branch name.
- A short list of conflicts resolved.
- Verification commands and results.
- A concise PR summary ready to paste.
