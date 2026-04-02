### Issue for this PR

Closes #20713

### Type of change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

Adds a Sidekick feature — a parallel, chat-only conversation that runs alongside the main session. Users can monitor task progress, discuss the agent's output, or chat while waiting for long-running tasks.

**How it works:**

The sidekick is a child session with `kind: "sidekick"` and `parentID` pointing to the main session. At each prompt, it snapshots the parent's messages for context awareness, but maintains its own independent message history.

**Key design decisions:**

- **No tools**: All tool permissions denied via `"*": "deny"` + `resolveTools()` returns `{}` early for sidekick sessions. This ensures sidekick cannot execute any actions.
- **Route guards**: 17 mutation routes (prompt, fork, share, summarize, abort, shell, command, revert, etc.) reject sidekick sessions via `rejectSidekick()` middleware.
- **No compaction/summary**: Sidekick sessions skip all compaction, summarization, and pruning paths. When context overflows, the loop breaks gracefully with an error message instead of attempting compaction (which would infinite-loop).
- **DB integrity**: CHECK constraint ensures `kind <> 'sidekick' OR parent_id IS NOT NULL`. Partial unique index ensures one sidekick per parent.
- **TUI integration**: Sidekick appears as a second tab in the existing sidebar panel (plugins | sidekick). No layout changes.
- **Inject**: Users can select a sidekick message and inject it into the parent session's context as a user message.
- **Isolation**: Sidekick sessions are filtered from the global session list in both SSE events and `sync.session.sync()`.
- **Cascade delete**: `Session.remove()` recursively deletes all children including sidekick sessions.

### How did you verify your code works?

- **Unit tests**: 17 test cases in `test/session/sidekick.test.ts` covering ensure idempotency, context snapshot, inject into parent, tool blocking, route guards, fork/share rejection, and more. All pass (27 expect() calls).
- **Type checking**: `bun typecheck` (tsgo --noEmit) — clean, no errors.
- **Build**: `bun run build` — clean (Vite 1854 modules, no errors).
- **Manual testing was limited** because the HTTP server is embedded in the TUI app (`bun run dev` launches the full TUI), making isolated API testing difficult without a running TUI instance.

### Screenshots / recordings

_TUI change only — sidekick appears as a tab in the existing sidebar panel. No external UI changes._

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
