# SYN-001: Technical Design

## Architecture

The integration has two components:

1. **MCP Server Config** — Synapse Coder staging facade configured as a remote MCP server in `opencode.json`, exposing the `coder_report_correction` tool to opencode's LLM and plugin layer.
2. **Plugin (`synapse-coder-reporter`)** — A v1 opencode plugin that hooks `tool.execute.after` and `event` to detect corrections and call `coder_report_correction` via the MCP client.

```
┌─────────────────────────────────────────────────────────┐
│ opencode session                                        │
│                                                         │
│  LLM ──► Edit/Write tool ──► LSP diagnostics            │
│              │                       │                   │
│              ▼                       ▼                   │
│     tool.execute.after      metadata.diagnostics        │
│              │                       │                   │
│              ▼                       ▼                   │
│     ┌─────────────────────────────────────────┐         │
│     │ synapse-coder-reporter plugin           │         │
│     │                                         │         │
│     │  1. Detect correction (diagnostics≠∅)    │         │
│     │  2. Build report payload                │         │
│     │  3. Check user opt-in                   │         │
│     │  4. Call coder_report_correction (MCP)  │         │
│     └────────────────┬────────────────────────┘         │
│                      │                                  │
│                      ▼                                  │
│              ┌───────────────┐                           │
│              │ MCP client    │                           │
│              │ (synapse-     │                           │
│              │  coder)       │                           │
│              └───────┬───────┘                           │
└──────────────────────┼──────────────────────────────────┘
                       │
                       ▼ (HTTPS)
              ┌───────────────────────┐
              │ Synapse Coder         │
              │ staging facade        │
              │ (Azure Container Apps)│
              └───────────────────────┘
```

## Component 1: MCP Server Config

### Config location

`opencode.json` at the project root (or `~/.config/opencode/opencode.json` for global).

**Note:** opencode does NOT use `.mcp.json` (the Claude Code / Cursor convention). MCP servers are configured under a top-level `mcp` key in `opencode.json`. Evidence: `packages/core/src/v1/config/config.ts:113-115`, `packages/opencode/src/cli/cmd/mcp.ts:394-410`.

### Config shape

```jsonc
{
  "mcp": {
    "synapse-coder": {
      "type": "remote",
      "url": "https://synapse-coder-mcp-staging.greenbay-703e5a45.australiaeast.azurecontainerapps.io/mcp",
      "headers": {
        "Authorization": "Bearer {env:SYNAPSE_CODER_STAGING_BEARER_TOKEN}"
      }
    }
  }
}
```

The bearer token resolves from vault secret `synapse-coder-mcp-staging-bearer-token` (per `C:\GitHub\AGENTS.md`). The `{env:VAR}` syntax is opencode's config substitution format — verified at `packages/opencode/src/config/variable.ts:36` (regex `/\{env:([^}]+)\}/g`) and applied to all config text at `packages/opencode/src/config/config.ts:219-225`. **Note:** opencode does NOT use `${VAR}` (shell) or `{VAR}` — only `{env:VAR}`.

Evidence for remote MCP + headers: `packages/core/src/v1/config/mcp.ts:1` (`ConfigMCPV1.Info` has `type: "local" | "remote"`, `url`, `headers`), `packages/opencode/src/mcp/index.ts:236-338` (`connectRemote` uses `StreamableHTTPClientTransport`).

## Component 2: Plugin (`synapse-coder-reporter`)

### Plugin shape

A v1 plugin is a function `(input: PluginInput, options?) => Promise<Hooks>`. Evidence: `packages/plugin/src/index.ts:74`.

The plugin is loaded from `cfg.plugin_origins` in `opencode.json`:

```jsonc
{
  "plugin_origins": ["./.opencode/plugin/synapse-coder-reporter.ts"]
}
```

**Primary location: `.opencode/plugin/synapse-coder-reporter.ts`** — completely outside `packages/`, zero merge risk with upstream. Auto-discovered via `packages/opencode/src/config/plugin.ts:18-30` (scans `{plugin,plugins}/*.{ts,js}`) and `packages/opencode/src/config/config.ts:462-465`. Evidence: `packages/opencode/src/plugin/loader.ts` (`PluginLoader.loadExternal`).

### Hooks to register

| Hook | Line | Purpose |
|------|------|---------|
| `tool.execute.after` | `packages/plugin/src/index.ts:274-281` | Detect LSP diagnostics after `edit`/`write`/`apply_patch` tool calls |
| `chat.message` | `packages/plugin/src/index.ts:234-243` | Track current model ID per session (for `reporterModel`) |

**Note:** The `event` hook (`packages/plugin/src/index.ts:224`) is NOT used in Phase 1 — the permission rejection signal (Signal 2) is deferred to Phase 2 because the `permission.v2.replied` event schema doesn't carry feedback text and `tool.execute.after` doesn't fire on errors.

### Correction detection logic

#### Signal 1: LSP diagnostics after edit (primary)

**When:** `tool.execute.after` fires with `input.tool === "edit" | "write" | "apply_patch"`.

**Check:** `output.metadata?.diagnostics` is non-empty (or the `output.output` string contains `"LSP errors detected in this file"`).

**Payload:**
- `original`: `input.args.newString` (edit), `input.args.content` (write), or `input.args.patchText` (apply_patch) — the LLM's proposed code
- `corrected`: `""` (one-sided — the next-turn fix is not available in this hook; Synapse may accept one-sided reports with `reason` containing the diagnostics)
- `category`: `"lsp-typecheck"`
- `language`: derived from file extension (`input.args.filePath` → extension → language map)
- `reason`: `"LSP diagnostics: <formatted errors from metadata.diagnostics>"`
- `reporterModel`: from the per-session model map (populated by `chat.message` hook)

**Evidence:** `packages/opencode/src/tool/edit.ts:197-201` shows diagnostics collected and `:203-208` shows them returned in `metadata`. The `input.args` in `tool.execute.after` (`packages/plugin/src/index.ts:275`) carries the original LLM args including `newString`/`content`/`patchText`.

#### Signal 2: Permission rejection (DEFERRED to Phase 2)

**Status:** Deferred. The `permission.v2.replied` event schema (`packages/schema/src/permission.ts:44-51`) only carries `sessionID`, `requestID`, `reply` — no feedback field. The `tool.execute.after` hook does not fire when the tool throws (`packages/opencode/src/session/tools.ts:111` — `CorrectedError` is thrown before the trigger at line 121 is reached). Without a plugin-hookable path to the feedback text, this signal is not feasible in Phase 1 without core code changes.

**Phase 2 approach (investigate):** Check whether `Session.Event.Error` or `session.tool.failed` events carry the `CorrectedError.feedback` text. If so, the `event` hook can capture it. If not, Signal 2 is limited to rejection-only (no feedback) or requires a core change to expose the feedback via a new event field.

**Phase 1 scope:** Signal 1 only (LSP diagnostics). This is the primary correction signal and is fully feasible.

### Reporting logic

The plugin calls the `coder_report_correction` MCP tool via the opencode client (`input.client`) or via a direct MCP client connection. The opencode client exposes MCP tools through the HTTP API.

**Flow:**
1. Detect correction (Signal 1 only in Phase 1)
2. Build payload (original, corrected, category, language, reason, reporterModel)
3. Check user opt-in setting (stored in opencode config under a `synapse_coder` key)
4. If opt-in: call `coder_report_correction` MCP tool (async, fire-and-forget — no `await` in the hook path)
5. If MCP call fails: queue locally (`.opencode/synapse-coder-queue.json`), retry on next correction or on a 5-minute timer
6. Log structured event: `{ correction detected, reported: true/false, category, language, model }`

### Model ID fallback

The `chat.message` hook's `model` field is optional (`packages/plugin/src/index.ts:238` — `model?: { providerID: string; modelID: string }`). When undefined (user didn't specify a model in their message), the plugin falls back to:
1. Query `input.client.session.get(sessionID)` for the session's current model
2. If that fails, use `"unknown"` as the `reporterModel`

### User opt-in gate

```jsonc
{
  "synapse_coder": {
    "enabled": false,  // opt-in, default off
    "report_lsp_diagnostics": true,
    "report_user_rejections": true,
    "show_indicator": true
  }
}
```

First time a correction is detected and `enabled` is not set, the plugin emits a TUI toast: "Synapse Coder learning loop detected a correction. Enable reporting? (y/n)". This uses the `tui.toast.show` event (`packages/schema/src/tui-event.ts:40-41`) via `client.tui.showToast()`. Dismissal = remain disabled (safe default). In headless/CLI mode (no TUI), the prompt is skipped and reporting stays disabled.

### Error handling and offline queue

- MCP call failures are caught and logged; they never propagate to the tool execution loop
- Failed reports queue in `.opencode/synapse-coder-queue.json` (max 100 entries, FIFO)
- Queue retries on plugin load and on a 5-minute timer
- If queue exceeds 100, oldest entries are dropped with a warning log

## Options Analysis

### Option A: Plugin-only (RECOMMENDED)

**What:** MCP config + v1 plugin. No core code changes.

**Pros:**
- Zero churn in high-churn core files (fork-local compliant)
- Reversible (disable plugin or remove MCP config)
- Works with v1 and v2 session paths (plugin hooks are stable)
- Ships fast (1-2 sessions)

**Cons:**
- Can't capture pre-format LLM literal output (discarded in `edit.ts:112-114` before formatting)
- Can't hook `experimental_repairToolCall` (not plugin-hookable)
- One-sided corrections for LSP diagnostics (no next-turn fix pairing)

### Option B: Core code changes + plugin

**What:** Same as A, PLUS small code changes in `edit.ts`/`write.ts`/`apply_patch.ts` to snapshot `params.newString` before `format.file()` runs, and a new plugin hook in `llm.ts` for `experimental_repairToolCall`.

**Pros:**
- Captures the cleanest before/after pairs (format-on-write, malformed tool calls)
- Two-sided corrections (higher signal quality)

**Cons:**
- Touches high-churn core files — conflicts with upstream merges
- Violates the fork-local note: "keep every local change small and in low-churn files"
- Longer review cycle, higher risk

**Decision:** Option A. The fork-local constraint is non-negotiable. Option B's signal gain is marginal vs the merge-conflict risk. Phase 2 can revisit if the v2 `FileMutation.Service` (`packages/core/src/file-mutation.ts:201-207`) lands and provides a stable hook point.

### Option C: Custom tool only (LLM self-reports)

**What:** Drop a `tools/synapse-coder.ts` in `.opencode/` that exposes `coder_report_correction` as an LLM-callable tool. Rely on prompt engineering to make the LLM self-report.

**Pros:** Zero infrastructure beyond the tool file.

**Cons:** LLMs rarely self-report corrections; signal quality is poor; doesn't capture silent corrections (format rewrites, LSP diagnostics).

**Decision:** Rejected. Passive detection (Option A) captures signals the LLM wouldn't self-report.

## Devil's Advocate

- **"Why not just use Synapse Coder directly via its MCP for code generation?"** — opencode is the user's primary tool; they won't switch to Synapse Coder for every edit. Feeding corrections passively captures learnings without changing the user's workflow. The two tools serve different purposes: opencode is the daily driver; Synapse Coder is the learning loop beneficiary.
- **"Why not wait for the v2 plugin system?"** — v2 is "in progress" (`packages/plugin/src/v2/effect/`) with no timeline and not wired into the live session loop. Waiting delays value indefinitely. v1 hooks are stable and documented.
- **"Isn't this just telemetry?"** — No, it's a learning loop: corrections feed back into Synapse Coder's lesson corpus, which improves future code generation for all Alterspective agents. It's dogfooding our own AI. The user opts in and sees what's sent.

## Pre-Mortem (failure modes)

| # | Failure Mode | Impact | Mitigation |
|---|--------------|--------|-----------|
| FM-001 | Synapse Coder MCP staging facade is down or rejects the bearer token | Integration appears broken on first use | Health check on plugin load; graceful degradation; clear error log |
| FM-002 | Plugin hooks don't fire as expected for MCP tools | No corrections detected | Verify hook firing in Phase 1 Task 1.2 before building detection logic; fall back to built-in tools only |
| FM-003 | `coder_report_correction` rejects one-sided corrections | Reports are silently dropped | Verify accepted parameters in Phase 1; design for two-sided where possible; document Synapse's response |
| FM-004 | User accidentally sends sensitive client code to Synapse | Privacy incident | Opt-in gate (default off); per-session first-use confirmation; structured logging of what's sent; user can disable at any time |
| FM-005 | Plugin hook overhead slows down tool execution | UX degradation | All reporting is async (fire-and-forget); no `await` on MCP calls in the hook path |

## Language Map

File extension → `language` parameter for `coder_report_correction`:

| Extension | Language |
|-----------|----------|
| `.ts` / `.tsx` | `typescript` |
| `.js` / `.jsx` / `.mjs` / `.cjs` | `javascript` |
| `.py` | `python` |
| `.go` | `go` |
| `.rs` | `rust` |
| `.java` | `java` |
| `.cs` | `csharp` |
| `.rb` | `ruby` |
| `.php` | `php` |
| `.swift` | `swift` |
| `.kt` / `.kts` | `kotlin` |
| `.dart` | `dart` |
| (other) | `text` |
