# Tasks: agent-worktree-isolation

## Phase 1: Worktree lifecycle module (this session's implementation target)

- [x] 1.1 `packages/opencode/src/git/worktree.ts`: implement `ensure(repoRoot, slug, base?)` —
      compute `../opencode-worktrees/<slug>` relative to `repoRoot`; if it
      exists and is a valid git worktree, return its path; otherwise run
      `git worktree add -b <branch> <path> <base>` (branch name:
      `loop/<slug>`, matching `loop-spec-queue` task 4.4's convention) and
      return the new path. Verify: unit test against a scratch git repo —
      calling twice with the same slug returns the same path and does not
      error the second time.
  - Signature takes `repoRoot` explicitly rather than reading it from
    instance state, so Phase 1 is testable standalone without pulling in the
    Effect service/InstanceState machinery. Phase 2 wires it to the real
    repo root when integrating with `/loop`.
- [x] 1.2 Implement `merge(slug)` — from the main checkout, `git merge --no-ff`
      the worktree's branch. Never runs `git push`. Verify: unit test — after
      a commit in the worktree, `merge` brings that commit into the main
      checkout's current branch; the main checkout's branch is unchanged if
      the worktree has no commits ahead.
- [x] 1.3 Implement `cleanup(slug)` — `git worktree remove` the path. Only
      call after a successful `merge`. Verify: unit test — the worktree
      directory and its git metadata are gone after cleanup; a second
      `cleanup` on an already-removed slug does not throw.
- [x] 1.4 Error handling: `ensure` on a path that exists but is not a valid
      git worktree (e.g. a stray directory) fails with a clear error rather
      than silently reusing it or corrupting it. Verify: unit test.
- [x] 1.5 Full typecheck (`bun run --cwd packages/opencode typecheck`) and the
      new unit test suite green.
  - `packages/opencode/test/git/worktree.test.ts` — 7 tests, all passing,
    against real scratch git repos (init, commit, worktree add/merge/remove).

## Phase 2: Wire into `/loop` (follow-up, not this session)

- [ ] 2.1 Add `experimental.agent_worktree_isolation: Schema.optional(Schema.Boolean)`
      to `packages/core/src/v1/config/config.ts`, default off (only enabled
      when explicitly `true`, opposite polarity from `local_subagent_placement`).
- [ ] 2.2 On loop start with the flag on: resolve the target change's slug,
      call `ensure(slug)`, and run the loop's work rooted at that worktree
      path instead of the main checkout.
- [ ] 2.3 On loop completion (success): call `merge(slug)` then
      `cleanup(slug)`. On halt/failure: leave the worktree in place (matches
      `loop-spec-queue`'s "leave the working tree as-is" halt semantics) and
      report its path so the user can inspect or resume it manually.
- [ ] 2.4 Manual end-to-end: start a loop on change A with the flag on,
      confirm it runs in `../opencode-worktrees/A` and the main checkout is
      untouched; start a second loop on change B concurrently, confirm it
      gets its own worktree and neither loop's git operations affect the
      other's branch.
- [ ] 2.5 Manual: confirm a `skein`-created worktree for the same slug is
      reused rather than duplicated (same path convention).

## Phase 3: Documentation

- [ ] 3.1 Document the `../opencode-worktrees/<slug>` convention and the flag
      in whatever surfaces `/loop`'s other experimental flags today (CLI
      help, `--help` output, or the relevant docs file — match however
      `local_subagent_placement` is documented, if at all).
