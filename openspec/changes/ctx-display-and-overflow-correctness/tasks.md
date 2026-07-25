# Tasks: ctx-display-and-overflow-correctness

- [x] 1. Sidebar denominator (`context.tsx`) uses the enforced hard ceiling
       (`limit.contextMax` = configured_ctx), falling back to `context` for
       cloud; discovery now sets `contextMax` from fit's configured_ctx or the
       reported context_length (never the models.dev catalog native).
- [x] 2. `adjustLocalContextOnOverflow`: probes `/api/fit` at the target ctx and
       only grows when `fit_level !== "no"`; otherwise surfaces the overflow
       instead of patching to an unloadable native ceiling.
- [x] 3. `setModelContextLimit` also sets `contextMax` to the new ctx_size, so
       the set persists in the display; the next discovery re-reads it from the
       now-patched backend (no revert to a capacity number).
- [ ] 4. Tests: display/overflow logic is in the large discovery/provider
       module — covered by typecheck + deploy verification for now; a focused
       unit test is a follow-up. (REMAINING)
- [x] 5. `bun run typecheck` green in both `opencode` and `tui` packages
       (0 errors).
