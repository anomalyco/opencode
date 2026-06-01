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

## Custom Changes to Preserve

When merging upstream, these custom changes may conflict and need re-applying:

| Area | Files | Description |
|------|-------|-------------|
| Token cache_write | `packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts` | Parse `cache_creation_tokens` from SSE `usage` |
| Token cache_write | `packages/llm/src/protocols/openai-chat.ts` | `OpenAIChatUsage` schema includes `cache_creation_tokens` |
| SSE usage injection | `llama-swap/proxy/metrics_monitor.go` | Buffer SSE and inject `usage` from timings |
| HTTP/1.1 upstream | `llama-swap/proxy/process.go` | `ForceAttemptHTTP2: false` for HTTP/1.1 llama.cpp |
| Local mDNS discovery | `packages/opencode/src/local/mdns.ts` | mDNS-based `_llamaswap._tcp.local.` discovery for `/connect` |
| Local LAN scan | `packages/opencode/src/server/routes/instance/httpapi/handlers/local.ts` | Probe llama-swap + Ollama + LM Studio ports on LAN |
| Local LAN scan | `packages/opencode/src/server/routes/instance/httpapi/groups/local.ts` | Fleet provider probing (configured skein backends) |
| Local provider dialog | `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx` | Multi-select discovered providers; graceful mDNS failure |
| Context window display | `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx` | Show context window size for local llama-swap models |
| Context window display | `packages/opencode/src/cli/cmd/tui/component/dialog-model-ctx.tsx` | Sidebar-only context window, reactive to model switches |
| Provider metadata | `packages/opencode/src/provider/provider.ts` | `mergeDiscoveredModel`: server-reported ctx/output wins over cached values |
| Provider metadata | `packages/opencode/src/local/mdns.ts` | Refresh discovered local model metadata on reconnect |
| TUI home | `packages/opencode/src/cli/cmd/tui/routes/` | Vault-tec TUI home customizations |

## Skein Port Chain

Keep the dependency chain one-way:

1. `upstream/dev`
2. your fork `dev`
3. a tagged fork snapshot
4. skein port work based on that tag

Do not port directly from a moving branch into skein. Port from tagged snapshots so you can answer exactly which opencode fork state skein is based on.

Suggested tagging pattern:

```bash
git tag fork/2026-05-23.1
git push origin fork/2026-05-23.1
```

Then record that tag in the skein change or port notes before starting the Go-side work.