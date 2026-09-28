# oclite — ADR (reuse decisions and records)

Format: `module → strategy → reason`. Strategies:
- **import**: a workspace export.
- **path-import**: `opencode/<path>` for `.ts`, `@/<path>.txt` for text assets.
- **copy**: a forked file in `src/forked/` with a `// forked-from: <path>@ab6c8a6` header.
- **own**: new code in oclite, where nothing upstream fits.
- **not used**.

Timings are from `docs/ARCHITECTURE.md` §0. Extraction into `packages/core` (policy step 3) is blocked this
run, so it's never chosen.

## Model layer
- `@opencode-ai/llm` (LLMClient, LLM.request/stream, LLMEvent, Message, Tool.make, ToolRuntime.dispatch, isContextOverflow) → import → clean exports, 158 modules/0.12 s, and it's the V2 model layer: one `stream` per turn.
- `@opencode-ai/llm/providers/{openai-compatible,anthropic,openai}` → import → `configure({baseURL,apiKey}).model(id)` is all oclite needs.
- `@opencode-ai/llm/route` RequestExecutor.layer + effect `FetchHttpClient.Fetch` → import → oclite supplies its own `Fetch` (the vLLM shim below) without touching packages/llm.
- `@opencode-ai/core/util/token` (Token.estimate) → import → chars/4, the same heuristic as core.
- `opencode/provider/transform` → not used → keyed on AI-SDK `Provider.Model`/`api.npm`. Its unknown-model defaults (maxOutputTokens 32000, no cache key) are what the spec asks oclite to avoid. Request shaping is **own** and driven by the capability record (`llm/client.ts`).

## Tools
- `opencode/tool/tool` (Tool.define, Context, InvalidArgumentsError) → not used → the graph is 3,134 modules including server/tui. `@opencode-ai/llm` `Tool.make` + `ToolRuntime.dispatch` already give schema decode and "Invalid tool input" feedback. oclite's `tools/registry.ts` wrapper adds permission, hooks, timeout and truncation (**own**, ~220 lines).
- `opencode/tool/truncate` → own policy with the constants copied (2000 lines / 50 KB + hint, overflow to a file) → the module needs Truncate.Service + FSUtil (1,362 modules) and forks an hourly cleanup fiber. The policy fits in ~25 lines of the wrapper.
- Built-in tools `opencode/tool/{read,write,edit,glob,grep,shell,webfetch,todo,skill,question}` → own minimal tools on `Tool.make` → they need InstanceState/bus/LSP/Snapshot. Forking them would be about 1,700 lines against a 7,000 budget, and local profiles need rewritten ≤ 300/≤ 150-char descriptions anyway. **Parameter names match opencode exactly** (filePath, oldString, newString, replaceAll, offset, limit, pattern, path, include, command, timeout, workdir, url, format, todos, name), so the default profile can reuse opencode's `.txt` descriptions verbatim.
- `@opencode-ai/core/tool/*` (core v2 tools) → not used → Location-scoped with PermissionV2 (sqlite) and ToolOutputStore, 480–671 modules. Wrong shape for a leaf CLI with its own permission layer.
- Tool descriptions `opencode/src/tool/*.txt` → path-import (`@/tool/<name>.txt`, default profile only) → the text is reused byte-for-byte. `opencode/<x>.txt` can't be used because the exports map appends `.ts`.
- `opencode/tool/shell/prompt` (ShellPrompt.render) → path-import, lazy, default profile only → gives the exact rendered bash description (4,672 chars). Side effect: importing `core/global` mkdirs opencode dirs.
- `@opencode-ai/core/ripgrep` → import, lazy (inside grep/glob execute) → handles the rg binary and .gitignore-aware search. Loading it costs 0.21 s, so it stays off the startup path.
- `opencode/tool/apply_patch` → not used → opencode only offers it to GPT-family models, and no oclite profile lists it. **[LEAD]** it could come back later as an optional tool.
- `opencode/tool/registry` → own → about 25 services. oclite's selection comes from the profile table plus agent permission.
- `opencode/tool/external-directory` → own (~10 lines in the registry wrapper) → it needs InstanceRef + Tool.Context. oclite keeps the same permission key `external_directory` and the same `<dir>/*` glob, so rulesets transfer.

## Sub-agents and agents
- `opencode/tool/task` contract (BACKGROUND_DESCRIPTION/STARTED/UPDATED, renderOutput, parameter descriptions) → copy `src/forked/task-contract.ts` → the constants are module-private, and importing `tool/task` drags Session/DB. The behaviour contract has to stay byte-identical.
- `opencode/agent/subagent-permissions` (deriveSubagentSessionPermission) → path-import → graph of 1 module with a type-only Agent import. oclite's `AgentDef` is structurally assignable to `Agent.Info`.
- `opencode/agent/agent` (Agent.Info) → path-import, **type-only** → the only use is the `subagent` argument type above. oclite's `AgentDef` schema is own.
- `@opencode-ai/core/agent` (AgentV2) → not used → needs the State service. oclite agents come only from markdown files and config.
- `@opencode-ai/core/v1/config/agent` (ConfigAgentV1.Info) → import → same frontmatter as opencode. Unknown keys fall into `options`, and oclite reads its extensions from there.
- `@opencode-ai/core/config/markdown` (ConfigMarkdown.parse) → import → gray-matter plus the unquoted-colon sanitizer, 45 modules.
- `opencode/config/agent` (load) → own (~40 lines in `config/agents.ts`) → it uses `@/` aliases and opencode's ConfigParse. oclite adds `.claude/agents` compat (a `tools:` string or list becomes allow/deny rules) and the extra search roots.

## Prompt, context, compaction
- `opencode/session/system` (provider(model) selection) → copy `src/forked/system-prompt.ts` (~35 lines) → the module graph is 2,471 (Skill/MCP/Location services).
- `opencode/src/session/prompt/*.txt` → path-import (`@/session/prompt/*.txt`) → the default profile uses opencode's per-model prompt unchanged.
- `opencode/session/{instruction,reminders}` → own (`runtime/context.ts`) → heavy services. oclite needs per-profile caps, the AGENTS.md → CLAUDE.md fallback, and reminders only in the last user message.
- `opencode/session/overflow` (usable, isOverflow) → own → `isOverflow` returns false when `limit.context === 0`. oclite always has a context window (pin → probe → 32768), triggers at 75%/60% of `max_context_tokens ?? context_window`, and COMPACTION_BUFFER isn't exported.
- `opencode/session/compaction` (V1) → not used → heavy and tied to MessageV2.
- `@opencode-ai/core/session/compaction` (buildPrompt + templates) → import, lazy → pure helper, 176 modules, no db. The trigger policy stays own because V2 `make()` skips context ≤ 0 and is tied to SessionMessage V2.
- `opencode/src/agent/prompt/compaction.txt` / `title.txt` → path-import (`@/agent/prompt/*.txt`) → the system prompts for the summary and title side calls.

## MCP
- `opencode/mcp/index` (MCP.Service) → not used; own thin client on the SDK (`mcp/client.ts`, ~300 lines) →
  - Import cost is 0.43–0.52 s vs 0.09–0.11 s for the SDK client set. That's over half of the 300 ms status-line budget before any connect.
  - The graph is 1,620 modules including 126 db modules and server/tui files.
  - It needs stubs for Config.Service (8 methods), EventV2Bridge, McpBrowser, InstanceRef and ChildProcessSpawner.
  - Its `tools()` returns raw defs with no permission wrapping anyway.
- `opencode/mcp/catalog` (defs, prompts, resources, resourceTemplates, paginate, tolerant tools/list) → path-import, lazy → reuses the pagination, the duplicate-cursor guard and the outputSchema-tolerant listing (+~0.05 s over the SDK). `toolName` and `convertTool` are not used.
- `opencode/mcp/auth` (McpAuth) → path-import, lazy (`LayerNode.compile(McpAuth.node)`, verified), remote OAuth only → shares `~/.local/share/opencode/mcp-auth.json` so `opencode mcp auth` tokens work in oclite. **[LEAD]** Importing `core/global` creates opencode's data dirs. The alternative is an own `McpAuth.Interface` over `~/.local/share/oclite/mcp-auth.json` (~40 lines).
- `opencode/mcp/oauth-provider`, `oauth-callback` (McpOAuthProvider, ensureRunning, waitForCallback) → path-import, lazy → 49 + 3 modules, no service coupling beyond `McpAuth.Interface`.
- `@opencode-ai/core/v1/config/mcp` (ConfigMCPV1.Local/Remote/OAuth/Info) → import → an `opencode.json` `mcp` block works unchanged.
- `@modelcontextprotocol/sdk@1.29.0` client + server (`Server`, `StdioServerTransport`, `WebStandardStreamableHTTPServerTransport`, `elicitInput`) → import → the root patch applies automatically, since there's one installed copy. The server uses low-level `Server` with raw JSON Schema, so it needs no zod.

## Permission, config, security
- `opencode/permission/index` evaluate/fromConfig/expand → copy `src/forked/permission-rules.ts` (~45 lines) → importing the module loads InstanceState + EventV2Bridge (434 modules, 126 db, 0.25 s) just to reach 40 pure lines.
- `opencode/permission/index` Service.ask/reply → own (`permission/permission.ts`) → oclite needs pluggable Askers (REPL, headless, MCP elicitation/reply-tool), a timeout, and JSONL permission records. opencode's `ask` has no timeout and needs EventV2Bridge.
- `@opencode-ai/core/util/wildcard` (Wildcard.match) → import → graph of 1 module, and the matching semantics stay identical.
- `@opencode-ai/core/v1/permission` (Rule, Ruleset, DeniedError, RejectedError) → import → shared types, 94 modules, no db.
- `@opencode-ai/core/v1/config/permission` (ConfigPermissionV1.Info) → import → the config `permission` block keeps opencode's shape.
- `opencode/config/variable` (substitute) → copy `src/forked/variable.ts` (~90 lines) → path-import pulls `@/util/filesystem` (185 modules, 0.19 s) onto the startup-critical config path.
- `opencode/cli/cmd/debug/redact` (redactConfig) → path-import → graph of 1 module. `util/redact.ts` wraps it and adds registered secrets (API keys, OAuth tokens, MCP header values) for text, JSONL and stream-json.
- `@opencode-ai/http-recorder` redaction → not used at runtime → test-only dependency. The llm executor already redacts sensitive headers in its errors.

## CLI and output
- `packages/cli` framework (`lildax`) → not used → no `exports`, and it imports Daemon → server/sdk.
- CLI framework → import `effect/unstable/cli` + `@effect/platform-node` → +~0.03 s over effect, which is loaded anyway (0.11 s total with NodeServices/NodeRuntime). No new `package.json` dep, and `packages/cli` is a precedent. yargs 18 would add ~0.04–0.07 s and a new manifest entry. Risk: the API is marked unstable, but it's pinned by the workspace catalog.
- `opencode/cli/cmd/run` (non-TUI output) → not used → it consumes only finished parts. oclite renders deltas (`render/`).

## Tests
- `@opencode-ai/http-recorder` (HttpRecorder.http) → import (devDependency) → replays recorded hosted-model traffic through `appLayer(..., http)`. There are no oclite cassettes yet: recording needs `ANTHROPIC_API_KEY`, otherwise the test is skipped (Deviation).
- `opencode/test/lib/llm-server.ts` → copy-adapt as `test/lib/local-server.ts` (test code, not counted) → AGENTS.md says don't import across packages' tests. oclite needs a `Bun.serve` fake reachable from CLI subprocesses, with a toggle per §10 field.
- `opencode/test/lib/cli-process.ts`, `effect.ts`, `fixture/fixture.ts` → copy-adapt the generic helpers into `test/lib/{cli,tmp}.ts` → same rule.
- `@modelcontextprotocol/server-everything` → not available → **Deviation**: `test/fixture/mcp-everything.ts`, an SDK stdio server (tools/prompt/resource/template/progress/crash/list_changed), is modelled on `opencode/test/fixture/mcp-lifecycle-stdio.ts`.

## Records
- **Tool naming**: `mcp__<server>__<tool>` (Claude Code style), not opencode's `<server>_<tool>`. Reasons:
  - It's unambiguous when server or tool names contain `_`.
  - It matches the spec's `/mcp__<server>__<prompt>` slash commands.
  - Claude Code `--allowed-tools "mcp__github__*"` globs and `.claude/agents` `tools:` lists work unchanged.
  - Names are sanitized `[^A-Za-z0-9_-]→_`. Over 64 chars, a name becomes 55 chars + `_` + 8-hex sha1.
  - Compat cost: opencode `permission` keys like `github_*` won't match oclite MCP tools and need rewriting as `mcp__github__*`. This is documented in the README.
- **Envelope**: reuse opencode's `<task id="…" state="running|completed|error">[<summary>…</summary>]<task_result>|<task_error>…</task>` via forked `renderOutput`. State `failed`/`cancelled` maps to `error`. Text is truncated at 4000 tokens (16,000 chars). There's no reason to diverge, and models trained on opencode transcripts already know the tags.
- **Test double**: `test/lib/local-server.ts` is the only sanctioned fake. The MCP fixture is a real SDK server, and hosted traffic uses http-recorder.
- **prefix_cache probe**: a TTFT heuristic (second identical ~2k-token prompt ≥ 30% faster). The config pin `servers.<url>.capabilities.prefix_cache` is the reliable path. An unmeasurable probe defaults to `false` (source `default`), with a notice telling the user to pin it.
- **/no_think**: model-specific (Qwen-style templates) and pending verification against a real model. It's used only when `servers.<url>.capabilities.no_think_suffix: true` is pinned. The default path is `chat_template_kwargs.enable_thinking` when accepted, else nothing.
- **vLLM `delta.reasoning` gap** (`@opencode-ai/llm` decodes only `reasoning_content`): handled in oclite without editing packages/llm. When the probe reports `reasoning_field: "reasoning"`, the custom `FetchHttpClient.Fetch` wraps SSE response bodies in a TransformStream that renames `"reasoning":` to `"reasoning_content":` inside `choices[].delta`. That's about 30 lines in `llm/client.ts`, with a notice. If the shim proves fragile, fall back to treating the server as `reasoning_field: none` (reasoning is then dropped) and record a Deviation. An upstream fix in packages/llm needs approval.
- **mcp-auth.json**: shared with opencode, via path-imported McpAuth. **[LEAD]** see the MCP section.
- **Permission replies**: MCP `allow|deny|always` ↔ opencode `once|reject|always` (allow→once, deny→reject, always→always). The REPL uses `y|n|a` with the same mapping, and JSONL stores the opencode vocabulary.
- **MCP default timeout**: 30,000 ms per request and per connect. That's opencode's code default (`DEFAULT_TIMEOUT`, index.ts:38). The 5,000 in the ConfigMCPV1 description is too short for real tools, and `resetTimeoutOnProgress` extends it for long calls.
- **Default-profile budget**: **[LEAD]** the spec table says ≤ 2500, but opencode's per-model prompt + `.txt` descriptions (which the same row requires) come to about 6,900 tokens. Proposed Deviation: default budget ≤ 7,300 (the opencode baseline). local and local-min keep 1200 and 600.
- **Headless denial**: the run continues with the denial fed to the model, and exits 3 at the end if any denial happened. **[LEAD]** Claude Code exits 0 here.
- **Bash patterns under read_only**: commands with shell metacharacters get the pattern `<complex>`, so allow globs like `git status*` can't be chained. opencode's tree-sitter bash parse is too heavy to reuse.
- **Hooks**: accept both `{matcher, command}` and Claude's `{matcher, hooks:[{type:"command",command,timeout}]}`. stdin carries `{hook, hook_event_name, session_id, tool_name, tool_input, cwd}`. Exit 0 continue, 2 block (stderr to the model), other = warn [R], 10 s default timeout.
- **`.txt` imports**: via `@/…` (oclite tsconfig `paths`), only for opencode text assets. `.ts` modules always use `opencode/<path>`.
- **Size budget**: counts all `src/**/*.ts` including the ambient `.d.ts`, target ≤ 45 files. Lines exclude `src/forked/`. The plan is 42 files and about 6,640 lines plus about 230 forked lines.
