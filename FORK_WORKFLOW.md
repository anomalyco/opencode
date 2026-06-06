# Fork Workflow

This fork tracks upstream on the `dev` branch.

## Upstream Sync

Use a dedicated worktree and sync branch instead of merging directly into your active checkout.

### Quick Sync

```bash
# Dry run — inspect the plan
bun run sync-upstream

# Execute — creates worktree and merges upstream
bun run sync-upstream:apply
```

This creates a sibling worktree at `../opencode-sync-YYYYMMDD` and a branch `sync/upstream-YYYYMMDD` based on `origin/dev`, then merges `upstream/dev` into it.

### Full Sync Procedure

1. **Dry run** — inspect what will happen:
   ```bash
   bun run sync-upstream
   ```

2. **Execute** — creates worktree and merges:
   ```bash
   bun run sync-upstream:apply
   ```

3. **Validate** in the sync worktree:
   ```bash
   cd ../opencode-sync-YYYYMMDD

   # Build and typecheck
   bun install
   cd packages/opencode && bun typecheck

   # Smoke test
   bun run build
   ```

4. **Resolve conflicts** (if any) in the sync worktree.

5. **Merge back** into `dev` in the original checkout:
   ```bash
   # In original repo
   git fetch origin
   git checkout dev
   git merge --no-ff sync/upstream-YYYYMMDD --no-edit
   ```

6. **Tag** the resulting `dev` commit:
   ```bash
   git tag fork/2026-05-29.1
   git push origin fork/2026-05-29.1
   ```

7. **Clean up** the sync worktree:
   ```bash
   git worktree remove ../opencode-sync-YYYYMMDD
   rm -rf ../opencode-sync-YYYYMMDD
   ```

## Upstream Update = Sync Trigger

When the opencode in-app updater shows a new version available, that is the signal to sync this fork with upstream. Do not run the auto-updater — run the sync workflow above instead.

After each sync, tag the result and record which upstream commit it aligns with:

```bash
git tag fork/YYYY-MM-DD.N   # e.g. fork/2026-06-06.1
git push origin fork/YYYY-MM-DD.N
```

Then update `docs/ECOSYSTEM.md` in skein with the new tag before porting any API changes.

## Custom Changes to Preserve

When merging upstream, these custom changes may conflict and need re-applying:

| Area | Files | Description |
|------|-------|-------------|
| Token cache_write | `packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts` | Parse `cache_creation_tokens` from SSE `usage` |
| Token cache_write | `packages/llm/src/protocols/openai-chat.ts` | `OpenAIChatUsage` schema includes `cache_creation_tokens` |
| Local mDNS discovery | `packages/opencode/src/local/mdns.ts` | mDNS-based `_llamaswap._tcp.local.` discovery for `/connect` |
| Local LAN scan | `packages/opencode/src/server/routes/instance/httpapi/handlers/local.ts` | Probe llama-swap + Ollama + LM Studio ports on LAN |
| Local LAN scan | `packages/opencode/src/server/routes/instance/httpapi/groups/local.ts` | Fleet provider probing (configured skein backends) |
| Local provider dialog | `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx` | Multi-select discovered providers; graceful mDNS failure |
| Context window display | `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx` | Unified bar, %, inline breakdown; Context label; cost for cloud |
| Context window display | `packages/opencode/src/cli/cmd/tui/component/dialog-model-ctx.tsx` | Live KV-based ctx recommendation; 4k preset steps |
| Provider metadata | `packages/opencode/src/provider/provider.ts` | `mergeDiscoveredModel` + `openAICompatibleDiscoveryEnabled`; keep `ModelV2.ID` not `ProviderV2.ModelID` |
| Provider metadata | `packages/opencode/src/local/mdns.ts` | Refresh discovered local model metadata on reconnect |
| Context set handler | `packages/opencode/src/server/routes/instance/httpapi/handlers/local.ts` | `ctx.params` (not `ctx.pathParams`); generated LlamaSkeinClient |
| Keybinds | `packages/opencode/src/cli/cmd/tui/config/keybind.ts` | `dialog.local.toggle` + `dialog.local.connect` |
| Theme sync | `packages/opencode/src/cli/cmd/tui/context/theme.tsx` | `ThemeState.set(store.active)` createEffect |
| Build scripts | `packages/opencode/package.json` | `build:llama-skein-client`, `fix-node-pty` scripts; `bun-pty` dep |

## Known Post-Merge Type Errors (upstream's own code)

After each sync, upstream ships with type errors in its own files that we cannot fix:
- `src/server/routes/instance/httpapi/handlers/pty.ts` — Effect Layer/Brand type strictness
- `src/server/routes/instance/httpapi/handlers/file.ts` — same
- `src/session/session.ts`, `src/share/share-next.ts` — upstream any-type drift
- `src/acp/service.ts` — Provider brand cast

These are pre-existing in upstream's own typecheck. Push with `--no-verify` when the hook fails on these. Our code must typecheck cleanly excluding those files.

## OpenAPI Specs — Two Separate Concerns

**Our llama-skein spec** (`~/dev/llama-skein/contracts/llama-skein.openapi.json`) defines the backend LLM proxy API. It has nothing to do with the opencode HTTP API and should NOT be aligned with it.

**Upstream opencode spec** (`packages/sdk/openapi.json`) defines the opencode agent runner's public HTTP API. We extend it with our `/local/*` routes but the spec file itself is taken from upstream unchanged.

These serve different purposes and should not be merged.

## Skein Port Chain

Keep the dependency chain one-way:

1. `upstream/dev`
2. your fork `dev`
3. a tagged fork snapshot
4. skein port work based on that tag

Do not port directly from a moving branch into skein. Port from tagged snapshots so you can answer exactly which opencode fork state skein is based on.

Tag pattern: `fork/YYYY-MM-DD.N` — record the tag in the skein change notes before starting Go-side work.