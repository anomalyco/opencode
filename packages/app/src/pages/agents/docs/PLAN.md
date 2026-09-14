# Agents fleet — operational build plan

Owner decisions (2026-09-15): full page only (`/server/:key/agents`), opencode theme
tokens, four core jobs: act on blocked agents, orchestrator→subagent tree, cost &
token burn, dispatch & steer. Pure logic lives in `lib/` with bun tests; UI stays thin.

Verify per slice: `bun run typecheck` + `bun test src/pages/agents` from `packages/app`,
then a live walk of `/agents` against a local server.

## Slices

- [x] **S-fix** Finish WIP row fields, splitPct key, TTFT part lookup, tok/s unit (`c1025bc`).
- [x] **S0 Surface** Remove session side-panel Agents tab + badge (`session-side-panel.tsx`,
  `session/helpers.ts`). Keep route, `/agents` redirect, palette command, rail button.
- [ ] **S1 Theme** Replace inline rgba/hex with theme tokens (Tailwind token classes /
  CSS vars). Wire `SparkBars` + resizable split (`splitPct`). Real SSE state or drop it.
- [ ] **S2 Tree** `lib/tree.ts`: group subagents under parent, rollup tin/tout/cost/live,
  collapse state persisted. Table renders indented children; filters match if any
  descendant matches.
- [ ] **S3 Blocked** Attention strip listing pending permissions/questions across fleet.
  Inline allow once / always / reject and question answering in detail pane via
  `api.permission.reply` / `api.question.reply|reject`. Keyboard: `j/k` move, `a/A/r`.
- [ ] **S4 Cost** `lib/cost.ts`: per provider/model totals and windowed burn ($/h, tok/min)
  from assistant message cost/tokens. Summary bar + breakdown tab.
- [ ] **S5 Dispatch** New-session form (project, agent, model, prompt) via
  `api.session.create` + `api.session.prompt`; follow-up/steer box and interrupt in detail.
- [ ] **S6 Docs** Update CONSTANTS/REBASE/FIXTURES to match the code.
