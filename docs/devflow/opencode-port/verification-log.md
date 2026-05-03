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
