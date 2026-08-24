# opencode fork — Ecosystem Context

> **Canonical:** `/Users/andreas/dev/skein/docs/ECOSYSTEM.md` — full ecosystem map,
> cross-repo dependencies, inspiration repos. This stub covers what agents need locally.

## What this repo is

This is a fork of [anomalyco/opencode](https://github.com/anomalyco/opencode).
It is the agent runner layer in the skein ecosystem — skein supervisor calls
`opencode run --agent <role> "/skein-<cmd> <slug>"` to drive coding agents.

Fork additions over upstream:
- `feat(local)`: mDNS-based local provider discovery for `/connect` dialog
- `feat(local)`: LAN scan probing for llama-swap + Ollama + LM Studio instances
- `feat(local)`: fleet provider probing (configured skein backends surfaced in TUI)
- `fix(local)`: graceful mDNS failure, multi-select provider dialog
- `feat(tui)`: context window size display for local llama-swap models
- `fix(provider)`: server-reported context/output wins over cached values in `mergeDiscoveredModel`
- `fix(provider)`: refresh discovered local model metadata on reconnect
- `feat(tui)`: vault-tec TUI home customizations

**Default branch:** `dev` (not `main`)

## Upstream sync

**Upstream:** `https://github.com/anomalyco/opencode` (remote alias: `upstream`, fetch-only)
**Current gap:** typically 500–700 commits behind. Use the worktree-merge workflow, not rebase.

See **`FORK_WORKFLOW.md`** for the full sync procedure and automated script.

```bash
bun run sync-upstream          # dry run — inspect what will change
bun run sync-upstream:apply    # creates sibling worktree, merges upstream/dev
```

**Custom changes to preserve** are listed in `FORK_WORKFLOW.md` — update that table
whenever a new fork-specific area is added.

**Conflict hotspots:** `packages/opencode/src/local/` (mDNS/LAN discovery) and
`packages/opencode/src/provider/provider.ts` (upstream periodically refactors providers).

**Take from upstream:** provider fixes, TUI correctness (paste, wide chars, session switch),
`--replay` mode, ACP session cancel, queued prompt management, LSP improvements.

**Never take:** anything removing/changing the `--agent` flag or conflicting with `src/local/`.

## Integration with skein

Skein calls this binary as:
```bash
opencode run --dangerously-skip-permissions --agent <role-file> "/skein-<cmd> <slug>"
```

Agent role files live in the skein repo under `.skein/agents/`.
The `--agent` flag is a fork addition — it does not exist in upstream opencode.

## Related repos

| Repo | Role |
|------|------|
| skein | Supervisor that invokes this binary; defines agent roles and pipeline |
| llama-skein | LLM inference proxy discovered by this fork's local provider scanner |
| openclaw | Inspiration: ACP protocol design, extension system, multi-channel delivery |
| odysseus | Inspiration: opencode integration patterns, self-hosted workspace UX |
