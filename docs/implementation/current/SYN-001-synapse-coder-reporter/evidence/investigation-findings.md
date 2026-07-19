# Investigation Findings: opencode Codebase Hook Points for Synapse Coder Integration

**Investigation date:** 2026-07-18
**Investigator:** explore agent (task `ses_08af21ebcffej8PIDqksXqeYgs`)
**Repo:** `C:\GitHub\opencode`, branch `dev`, commit `a90c2b8557`
**Method:** Read-only investigation — no files modified

## Architectural Overview

opencode is built on **Effect v4 services** with Layer-based dependency injection. Per-project/per-directory state uses `InstanceState` (a `ScopedCache` keyed by directory).

- Module shape: flat top-level exports + self-reexport (`export * as Foo from "./foo"`), per `packages/opencode/AGENTS.md`
- The codebase has a **v1 path** (live, in `packages/opencode/src/`) and an in-progress **v2 path** (in `packages/core/src/session/`). All findings are about the v1 path.

### Package structure

| Package | Role |
|---------|------|
| `packages/opencode` | Live CLI/TUI/server — session loop, tools, MCP, plugins, LSP, format, snapshot, provider |
| `packages/core` | Shared primitives, v1 schemas, v2 session core (in progress) |
| `packages/plugin` | Plugin SDK — v1 `Hooks` interface + v2 Effect-based plugin system (being built) |
| `packages/schema` | Event manifest catalog |
| `packages/tui` | Terminal UI |
| `packages/llm` | LLM event types |

### Main session loop

- `packages/opencode/src/session/prompt.ts:1081` — `runLoop(sessionID)` drives the conversation
- `packages/opencode/src/session/processor.ts:627` — `process(streamInput)` runs the LLM stream
- `packages/opencode/src/session/llm.ts:86` — `LLM.run` builds the `streamText({...})` call

## Hook Points for Correction Reporting

### Tier 1 — Highest-value, already-collected signals

#### 1. LSP diagnostics after Edit/Write/apply_patch

After every file mutation, opencode calls `lsp.touchFile` + `lsp.diagnostics`, filters to severity 1 (ERROR), and appends to the tool output. The diagnostics are returned in `metadata`.

- `packages/opencode/src/tool/edit.ts:197-201` — LSP touch + diagnostics + block appended to output
- `packages/opencode/src/tool/edit.ts:203-208` — returns `metadata: { diagnostics, diff, filediff }`
- `packages/opencode/src/tool/write.ts:75-90` — same pattern; also surfaces cross-file diagnostics
- `packages/opencode/src/tool/apply_patch.ts:265-293` — same pattern for multi-file patches

**Signal:** `metadata.diagnostics` non-empty → correction detected. `original = args.newString`/`args.content`/`args.patchText`; `category = "lsp-typecheck"`.

#### 2. `tool.execute.after` plugin hook

- `packages/plugin/src/index.ts:274-281` — fires after every tool execution
- Receives `input: { tool, sessionID, callID, args }` and `output: { title, output, metadata }`
- This is the canonical hook for consuming tool results

**Signal:** Check `output.metadata?.diagnostics` when `input.tool` is `edit`/`write`/`apply_patch`.

#### 3. `event` plugin hook

- `packages/plugin/src/index.ts:224` — fires on ANY event published
- Can observe `Session.Event.Error`, `FileSystem.Event.Edited`, `Permission.Event.Replied`

**Signal:** Listen for permission rejection events to capture `CorrectedError.feedback`.

### Tier 2 — User-driven corrections

#### 4. Permission rejection with feedback

- `packages/opencode/src/permission/index.ts:125` — constructs `PermissionV1.CorrectedError({ feedback: input.message })`
- The user's rejection message is a correction signal

**Signal:** `category = "user-rejection"`; `reason = feedback message`.

#### 5. `chat.message` plugin hook

- `packages/plugin/src/index.ts:234-243` — fires on every user message
- Carries `model: { providerID, modelID }` — useful for `reporterModel` tracking

### Tier 3 — Historical/reconstructive (not used in Phase 1)

#### 6. Snapshot diffFull

- `packages/opencode/src/snapshot/index.ts:546-759` — reconstruct before/after for any step historically
- Useful for batch backfill, not real-time feeding

#### 7. Patch parts in transcript

- `packages/opencode/src/session/processor.ts:457-468` — per-step file-change sets

## MCP Client Integration

opencode has a full MCP client. **Critical:** opencode does NOT use `.mcp.json` — it uses `opencode.json` → `mcp` key.

- Config: `packages/core/src/v1/config/config.ts:113-115` — `mcp` schema
- Config shape: `packages/core/src/v1/config/mcp.ts:1` — `ConfigMCPV1.Info` (`type: "local" | "remote"`, `url`, `headers`, `env`, `oauth`, `timeout`, `enabled`)
- MCP service: `packages/opencode/src/mcp/index.ts` — `MCP.Service` (1004 lines)
  - `connectRemote` (line 236-338): `StreamableHTTPClientTransport` with OAuth/headers
  - `tools()` (line 666-688): returns `Record<string, McpTool>`
- Tool conversion: `packages/opencode/src/mcp/catalog.ts:42-83` — wraps MCP tool as AI SDK `dynamicTool`
- MCP auth: `packages/opencode/src/mcp/auth.ts`, `oauth-provider.ts`, `oauth-callback.ts`

## Plugin Architecture (v1 — live and stable)

- `packages/plugin/src/index.ts:222-335` — the `Hooks` interface
- Plugin loader: `packages/opencode/src/plugin/loader.ts` — `PluginLoader.loadExternal` from `cfg.plugin_origins`
- Plugin service: `packages/opencode/src/plugin/index.ts:123-306` — loads internal + external plugins
- Plugin input: `packages/plugin/src/index.ts:56-66` — `client`, `project`, `directory`, `worktree`, `$` (BunShell)
- Plugin-supplied tools: `packages/opencode/src/tool/registry.ts:194-199` — via `tool` hook
- Custom tools from project files: `packages/opencode/src/tool/registry.ts:178-192` — `{tool,tools}/*.{js,ts}` in config dirs

### Full hook catalogue

| Hook | Line | Synapse Coder relevance |
|------|------|-------------------------|
| `tool.execute.before` | 266-269 | Capture the LLM's intended args (the `original`) |
| `tool.execute.after` | 274-281 | **Capture result + metadata (diff, diagnostics)** |
| `event` | 224 | Observe permission rejections, errors |
| `chat.message` | 234-243 | Track model ID per session (for `reporterModel`) |
| `experimental.text.complete` | 327-330 | LLM text rewrites (if plugin rewrites) |

## Provider/Model Configuration

The `reporterModel` parameter needs the current model ID. opencode tracks this at:

- `packages/opencode/src/session/llm.ts:40` — `LLM.StreamInput.model: Provider.Model`
- `packages/opencode/src/provider/provider.ts:1031-1046` — `Provider.Model` schema with `id`, `providerID`
- `packages/opencode/src/session/prompt.ts:1186-1200` — assistant message stores `modelID`/`providerID`
- `packages/plugin/src/index.ts:234-243` — `chat.message` hook carries `model: { providerID, modelID }`

**Format:** `${input.model.providerID}/${input.model.id}` (e.g. `anthropic/claude-sonnet-4-5`, `openrouter/z-ai/glm-5.2`)

## File-Edit Application Logic

Three file-mutation tools, all following the same pattern:

### Edit tool (`packages/opencode/src/tool/edit.ts`)
- Line 86-87: `contentOld`, `contentNew` declared
- Line 126-127: reads current file
- Line 133: `replace(contentOld, old, replacement, params.replaceAll)` — fuzzy matching (9 replacers)
- Line 137-144: `diff = createTwoFilesPatch(...)`
- Line 155: `afs.writeWithDirs(filePath, ...)` — **the file mutation**
- Line 156-158: formatter runs, `contentNew` re-read from disk — **silent correction point**
- Line 197-201: LSP diagnostics collected
- Line 203-208: returns `metadata: { diagnostics, diff, filediff }`

### Write tool (`packages/opencode/src/tool/write.ts`)
- Line 50-53: `contentOld`/`contentNew`/`diff` computed
- Line 64: file mutation
- Line 65-67: formatter runs
- Line 75-90: LSP diagnostics
- Line 92-100: returns `metadata: { diagnostics, filepath, exists }` (no `diff` in metadata)

### apply_patch tool (`packages/opencode/src/tool/apply_patch.ts`)
- Line 58-68: `fileChanges` array
- Line 220-258: applies changes per file, runs formatter per file
- Line 265-293: LSP per file
- Line 295-302: returns `metadata: { diff: totalDiff, files, diagnostics }`

## Key Gaps (documented in plan as Phase 2, deferred)

- **Format-on-write discards pre-format text** — `edit.ts:112-114` re-reads `contentNew` after formatting but the LLM's literal `params.newString` is not retained
- **`experimental_repairToolCall` not plugin-hookable** — `llm.ts:297-313`; would need a code change to expose
- **No existing feedback UI** — no thumbs-up/down or rating mechanism
- **v2 session core in progress** — `packages/core/src/file-mutation.ts:201-207` has explicit TODOs

## Summary: Best Hook Points (ranked)

1. **`tool.execute.after` plugin hook** (Tier 1) — metadata already has diagnostics; `input.args` has the original LLM input
2. **`event` plugin hook** (Tier 2) — for permission rejections with feedback
3. **`chat.message` plugin hook** (Tier 1) — for model ID tracking (reporterModel)

**Integration vehicle:** MCP server config in `opencode.json` + v1 plugin loaded from `plugin_origins`. No core code changes needed.
