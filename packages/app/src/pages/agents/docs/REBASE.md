# Agents rebase runbook (flag-gated)

The `/agents` page rides on top of upstream `opencode` and must rebase cleanly.
It is flag-gated (off by default) so upstream never sees it unless enabled.

## Flag gating

- Route `/agents` mounts only when `agents.enabled` (`isEnabled()`) is true.
- All subscriptions are lazy; no polling / sockets when flag off.
- Persist key `agents.enabled` defaults false.

## Anchor order

1. `git fetch upstream && git status --short` (must be clean).
2. Checkout `agents-tab` and note base tag (`git describe --tags`).
3. Rebase onto new upstream tag: `git rebase <new-tag>`.
4. Resolve conflicts in anchor order:
   a. `packages/app/src/pages/routes.*`
   b. `packages/app/src/pages/agents/**` (ours wins unless route contract changed)
   c. shared UI primitives (take upstream, re-apply agents styling on top)
   d. docs (keep both).

## Cherry-pick scope: routes/agents/**

- Allowed: `packages/app/src/pages/routes.*` (route registration only),
  `packages/app/src/pages/agents/**` (page + lib + components + docs).
- Keep cherry-picks small and ordered: lib → components → page → route → docs.

## Forbidden: packages/desktop + router/serverSync/notification cores

- Never touch `packages/desktop/**`.
- Never touch router core, `serverSync`, notification cores.
- Never add events outside the ALLOW list in `CONSTANTS.md`
  (see FORBIDDEN phantom list).
- If upstream renames a core API, adapt inside `agents/**`, do not patch core.

## Drop-to-tag

- If rebase conflicts exceed ~30 min, abort (`git rebase --abort`),
  hard-reset a scratch branch to the new tag, then `git cherry-pick` the
  `agents/**` commits one by one, dropping anything that touches forbidden paths.

## Verify steps

1. `bunx vitest run src/pages/agents/lib` from `packages/app` — all files pass.
2. `bun run typecheck` (or `tsgo -b`) — no new errors in `agents/**`.
3. Manual fixture walk: working-build, gate-question, review-diff-idle,
   permission-blocked, error-retry, idle-quiet, archived, deleted (see `FIXTURES.md`).
4. `git status --short` — only `agents/**` + route registration changed; no core diffs.
5. Do NOT commit from this runbook unless explicitly requested.
