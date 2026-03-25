# OpenCode fork — architecture decisions (Phase 2.5 gate)

Record irreversible choices before persistence and context work on the fork. **Provisional defaults** below align with [OPENCODE_FORK_PLAN.md](OPENCODE_FORK_PLAN.md); update this file when decisions are ratified.

| Decision | Provisional choice | Notes |
|----------|-------------------|--------|
| Fork root directory | [`weave_opencode`](../../weave_opencode/) at monorepo root | OpenCode now runs directly at this repository root; planning docs should reference real `packages/opencode/src/*` paths. |
| Shared DB vs dedicated Weave store | **Dual store** | Keep OpenCode storage for app/session metadata; add a **Weave memory store** for message lineage, summaries, episodes, DAG (per plan §Phase 3). |
| Weave message ID ownership | **Weave-owned IDs** in the Weave store | Map/adapt to OpenCode UI message IDs where required for compatibility. |
| Mirror vs replace for prompt assembly | **Weave-built context** | OpenCode messages are not the sole source of truth for long-context assembly; Weave `context.ts` (or equivalent) builds the prompt payload. |
| Canonical tool IDs | Files: `weave-grep.ts`, `dispatch-thread.ts`; tool names: `weave_grep`, `dispatch_thread` | Match Anthropic/Claude Code naming rules in [CLAUDE.md](CLAUDE.md). |
| Anthropic OAuth / Claude Code identity | **Required for parity** with current `weave_ex` | Follow [CLAUDE.md](CLAUDE.md) for headers, betas, tool block formatting, streaming sync. |

**Sign-off:** Unset — complete before first Weave persistence migration in the fork.
