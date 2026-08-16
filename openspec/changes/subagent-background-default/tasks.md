# Tasks

- [x] 1. Identify why a weak local orchestrator delegated an entire large refactor to one foreground subagent and then sat idle
- [x] 2. Flip `runInBackground` in `packages/opencode/src/tool/task.ts` from opt-in (`params.background === true`) to opt-out (`params.background !== false`), gated on `flags.experimentalBackgroundSubagents`
- [x] 3. Preserve the flag-off fallback to foreground (background stripped from schema -> `params.background` always undefined -> must not default-trip the flag-required error)
- [x] 4. Reword `BACKGROUND_DESCRIPTION` and the `background` parameter annotation to state the new default plainly
- [x] 5. Typecheck (`bun run typecheck`)
- [ ] 6. Verify in a real fleet run that a local orchestrator now fans work out across idle hosts instead of blocking on one subagent
