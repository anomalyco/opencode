# Fork Workflow — `opencode-skein`

This is a permanent fork of opencode. It tracks upstream on the `dev` branch and
adds local features (loop/auto-reply/pattern-detection, llama-skein local
provider discovery, context sidebar, etc.) on top.

Two rules keep syncs from being a mess:

1. **The fork's custom surface is inventoried in [`fork/manifest.json`](fork/manifest.json).**
   Nothing custom is "remembered" — it's listed, and `bun run fork:verify` proves
   it survived every sync.
2. **Custom code lives in its own files; shared upstream files get the smallest
   possible patch.** New CLI commands are registered through one array
   (`src/fork/commands.ts` → a single `.command(ForkCommands)` in `index.ts`), so
   upstream can reshuffle its command list without ever conflicting with ours.

## The inventory: `fork/manifest.json`

| Section | Meaning | Verified by |
|---------|---------|-------------|
| `owned` | Fork-only files (don't exist upstream). Can't content-conflict, but *can* be dropped during conflict resolution. | must exist |
| `patched` | Upstream files we edit. Each has a `marker` string — the fingerprint of our change. | must exist **and** contain marker |
| `baseline` | The upstream commit our `dev` currently contains. | drives `sync:check` |

`bun run fork:verify` checks all of the above. A `patched` entry with
`"status": "REGRESSED"` is a patch already known to be lost — reported as a
non-blocking warning so you can re-apply it deliberately. Pass `--strict` to fail
on those too.

> **Outstanding regressions** (lost in earlier syncs, need re-applying):
> - `packages/tui/src/context/theme.tsx` — `ThemeState.set(store.active)` createEffect
> - `packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts` — `cache_creation_tokens` parsing
> - `packages/llm/src/protocols/openai-chat.ts` — `cache_creation_tokens` in `OpenAIChatUsage`

When you add a new custom file or patch a new upstream file, **add it to the
manifest in the same commit.** That is the single source of truth; the table that
used to live in this doc was stale (wrong paths after upstream moved the TUI into
`packages/tui/`), which is how features got lost.

## Distribution & the updater (`src/fork/distribution.ts`)

The in-app updater used to resolve "latest version" + "where to install from"
against upstream, so saying "yes" to an update prompt would overwrite the fork
binary with upstream's. All distribution targets now point at the fork:

| Target | Value | Env override |
|--------|-------|--------------|
| install script | `raw.githubusercontent.com/androidand/opencode/dev/install` | `OPENCODE_INSTALL_URL` |
| GitHub releases | `androidand/opencode` | `OPENCODE_RELEASE_REPO` |
| brew tap/formula | `androidand/tap` / `opencode-skein` | `OPENCODE_BREW_TAP` / `OPENCODE_BREW_FORMULA` |
| npm / scoop / choco | `opencode-skein` | `OPENCODE_NPM_PACKAGE` etc. |

`installation/index.ts` is otherwise a near-verbatim copy of upstream — it just
imports `ForkDistribution`. The on-disk binary is still named `opencode` (renaming
the `bin` would break existing installs); collision is avoided by the updater only
ever pulling fork artifacts.

> **Publishing not wired yet.** Upstream's `publish.yml` is gated to
> `github.repository == 'anomalyco/opencode'`, so it does not run on the fork. Until
> a fork release pipeline exists, `opencode upgrade` will find no newer fork release
> and simply no-op — which is the safe outcome (it will not pull upstream).

## "New upstream version" = sync trigger, not an upgrade

The updater's "new version available" signal now refers to **our** releases. The
*upstream* signal is handled separately, on purpose:

```bash
bun run sync:check          # fetch upstream, compare to manifest baseline, report
bun run sync:check --apply  # ...and scaffold the sync worktree if upstream is ahead
```

`sync:check` reads `baseline.upstreamRef` from the manifest, fetches `upstream/dev`,
and tells you exactly how many commits you're behind (with the changelog). It never
merges into `dev` or pushes — it stops at a prepared worktree.

## Sync procedure

1. **Check / scaffold:**
   ```bash
   bun run sync:check            # is a sync due?
   bun run sync-upstream:apply   # or: bun run sync:check --apply
   ```
   Creates a sibling worktree `../opencode-sync-YYYYMMDD` on branch
   `sync/upstream-YYYYMMDD` based on `origin/dev`, and merges `upstream/dev` in.

2. **Resolve conflicts** in the sync worktree. Thanks to the modular layout, most
   conflicts are confined to the `patched` files in the manifest.

3. **Verify nothing was lost:**
   ```bash
   cd ../opencode-sync-YYYYMMDD
   bun install
   (cd packages/opencode && bun typecheck)
   bun run fork:verify          # ← every owned file present + every marker intact
   ```
   If `fork:verify` reports a dropped file or lost marker, re-apply it before
   continuing.

4. **Merge back** into `dev`:
   ```bash
   git fetch origin && git checkout dev
   git merge --no-ff sync/upstream-YYYYMMDD --no-edit
   ```

5. **Update the baseline + tag:**
   ```bash
   # set fork/manifest.json baseline.upstreamRef to the new upstream/dev sha,
   # baseline.forkTag to the tag below, baseline.syncedAt to today
   git commit -am "fork: sync upstream <sha>, bump baseline"
   git tag fork/YYYY-MM-DD.N
   git push origin dev fork/YYYY-MM-DD.N
   ```

6. **Clean up:**
   ```bash
   git worktree remove ../opencode-sync-YYYYMMDD
   ```

## Skein port chain

Keep the dependency chain one-way: `upstream/dev` → fork `dev` → a tagged fork
snapshot (`fork/YYYY-MM-DD.N`) → skein port work based on that tag. Port from
tagged snapshots, not a moving branch, so you can always say exactly which fork
state skein is based on. Record the tag in the skein change notes before starting
Go-side work.

## OpenAPI specs — two separate concerns

- **llama-skein spec** (`~/dev/llama-skein/contracts/llama-skein.openapi.json`) —
  the backend LLM proxy API. Unrelated to opencode's HTTP API; do not align them.
- **opencode spec** (`packages/sdk/openapi.json`) — taken from upstream unchanged;
  we extend it at runtime with `/local/*` routes but never edit the spec file.
