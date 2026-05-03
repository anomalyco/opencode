# OpenCode Port Verification Log

Record verification evidence here before claiming any parity milestone.

## Baseline Commands

| Date | Command | Result | Notes |
|---|---|---|---|
| 2026-05-03 | `brew install bun` | FAIL | Homebrew core did not provide `bun` in this setup. |
| 2026-05-03 | `brew install oven-sh/bun/bun` | PASS | Installed Bun 1.3.13 from official tap. |
| 2026-05-03 | `bun --version` | PASS | `1.3.13`. |
| 2026-05-03 | `bun install` on `devflow/pr-15224-session-start` | PASS | Installed dependencies. `bun.lock` gained missing workspace entries for PR demo package. |
| 2026-05-03 | `bun run typecheck` in `packages/plugin` on `devflow/pr-15224-session-start` | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `bun run typecheck` in `packages/opencode` on `devflow/pr-15224-session-start` | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `bun run build` in `packages/plugin` on `devflow/pr-15224-session-start` | PASS | `tsc` completed successfully. |
| 2026-05-03 | `bun run build` in `packages/opencode` on `devflow/pr-15224-session-start` | PASS | Built all target binaries successfully. |
| 2026-05-03 | `git cherry-pick 2661c24f0d593cd3844b199ecfc0a176a8e5e48d` onto `devflow/hojo` | FAIL | Large conflict in `packages/opencode/src/session/prompt.ts`; PR is based on older prompt architecture. Cherry-pick aborted. Treat `#15224` as requiring a fresh minimal implementation rather than direct absorption. |
| 2026-05-03 | `bun install` on `devflow/pr-16598-session-stopping` | PASS | Installed dependencies. Generated `bun.lock` drift for `ghostty-web`; drift was removed from worktree after testing. |
| 2026-05-03 | `bun test test/plugin/session-stopping.test.ts` in `packages/opencode` on `devflow/pr-16598-session-stopping` | PASS | 4 tests passed, 0 failed, 10 assertions. |
| 2026-05-03 | `bun run typecheck` in `packages/plugin` on `devflow/pr-16598-session-stopping` | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `bun run typecheck` in `packages/opencode` on `devflow/pr-16598-session-stopping` | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `bun install` on `devflow/pr-23650-turn-completed` | PASS | Installed dependencies. Generated untracked `packages/opencode/src/provider/models-snapshot.ts`; generated artifact was removed from worktree after testing. |
| 2026-05-03 | `bun run typecheck` in `packages/plugin` on `devflow/pr-23650-turn-completed` | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `bun run typecheck` in `packages/opencode` on `devflow/pr-23650-turn-completed` | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `bun install` on `devflow/pr-15412-parent-agent-context` | PASS | Installed dependencies with no tracked worktree changes. |
| 2026-05-03 | `bun test test/plugin/parent-agent.test.ts` in `packages/opencode` on `devflow/pr-15412-parent-agent-context` | PASS | 5 tests passed, 0 failed, 5 assertions. |
| 2026-05-03 | `bun run typecheck` in `packages/plugin` on `devflow/pr-15412-parent-agent-context` | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `bun run typecheck` in `packages/opencode` on `devflow/pr-15412-parent-agent-context` | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `bun install` on `devflow/pr-19470-permission-ask` | PASS | Installed dependencies. Generated `ghostty-web` lockfile drift; drift was removed from worktree after testing. |
| 2026-05-03 | `bun test test/permission/next.test.ts` in `packages/opencode` on `devflow/pr-19470-permission-ask` | FAIL | 76 pass, 1 fail, 108 assertions. Failing test: `permission requests stay isolated by directory`; failure raises `PermissionRejectedError`. |
| 2026-05-03 | `bun run typecheck` in `packages/plugin` on `devflow/pr-19470-permission-ask` | PASS | `tsgo --noEmit` completed successfully despite failing behavioral test. |
| 2026-05-03 | `bun run typecheck` in `packages/opencode` on `devflow/pr-19470-permission-ask` | PASS | `tsgo --noEmit` completed successfully despite failing behavioral test. |
| 2026-05-03 | `git cherry-pick eb815acc0805ad48590638ea6ebf230ba3e8721f d8a368a820f06292c6c54f207c4d5d6956bcda60` onto `devflow/hojo` | PASS | Integrated parent-agent hook input commit and session.turn.completed event commit. |
| 2026-05-03 | `git cherry-pick e64832dac680fb37c4cff88a55548c7d593d287f 890b87c4dc69b651722fb6ca2b25d4e7f495b86e` onto `devflow/hojo` | PASS | Resolved `packages/opencode/src/session/prompt.ts` conflict by preserving current shell runner flow and adding `parentAgent`, `messageID`, `agent`, and `parentAgent` hook context fields. |
| 2026-05-03 | `bun test test/plugin/parent-agent.test.ts` in `packages/opencode` on `devflow/hojo` before dependency refresh | FAIL | Stale `node_modules` resolved `effect@4.0.0-beta.42`; current lockfile pins `effect@4.0.0-beta.59`. |
| 2026-05-03 | `bun install` on `devflow/hojo` | PASS | Refreshed dependencies from `bun.lock`; no tracked lockfile change remained. |
| 2026-05-03 | `bun test test/plugin/parent-agent.test.ts` in `packages/opencode` on `devflow/hojo` | PASS | 5 tests passed, 0 failed, 5 assertions. |
| 2026-05-03 | `bun run typecheck` in `packages/plugin` on `devflow/hojo` | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `bun run typecheck` in `packages/opencode` on `devflow/hojo` before schema fix | FAIL | `Session.Event.TurnCompleted` used a Zod object where `BusEvent.define` expects Effect `Schema`. |
| 2026-05-03 | `bun run typecheck` in `packages/opencode` on `devflow/hojo` after schema fix | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `git cherry-pick 79739438c 7f67ccee1 daf9c9614 0296cc9ec bbd1c13e4 59c7a932b 634baac71 c233a989d e19f58e54` onto `devflow/hojo` | FAIL | First commit conflicted in `packages/opencode/src/session/prompt.ts` because the PR targets the older async prompt loop; cherry-pick was aborted and replaced with a minimal Effect-path adaptation. |
| 2026-05-03 | `bun test test/plugin/session-stopping.test.ts` in `packages/opencode` on `devflow/hojo` | PASS | 2 tests passed, 0 failed, 4 assertions. |
| 2026-05-03 | `bun run typecheck` in `packages/plugin` on `devflow/hojo` after `session.stopping` adaptation | PASS | `tsgo --noEmit` completed successfully. |
| 2026-05-03 | `bun run typecheck` in `packages/opencode` on `devflow/hojo` after `session.stopping` adaptation | PASS | `tsgo --noEmit` completed successfully. |
| TBD | `PYTHONPATH=src python3 -m pytest` | TBD | Current hook/unit baseline |
| TBD | `./install.sh --target claude --root /tmp/devflow-claude-test install` | TBD | Claude install regression |
| TBD | `./install.sh --target opencode --root /tmp/devflow-opencode-test install` | TBD | OpenCode install |
| TBD | `OPENCODE_CONFIG_DIR=/tmp/devflow-opencode-test opencode agent list` | TBD | OpenCode agent config validation |

## Milestone Evidence

| Milestone | Evidence | Status |
|---|---|---|
| L1: Rules/agents/skills/flow load | TBD | Not Started |
| L2: Blocking enforcement works | TBD | Not Started |
| L3: Telemetry/lifecycle works | TBD | Not Started |
| L4: Loop/subagent parity works | TBD | Not Started |
