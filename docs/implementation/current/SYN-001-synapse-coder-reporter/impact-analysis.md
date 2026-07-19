# SYN-001: Impact Analysis

## Files Affected

### New files (added)

| File | Purpose | Churn risk |
|------|---------|-----------|
| `opencode.json` (project root) or `~/.config/opencode/opencode.json` | MCP server config + plugin config + opt-in setting | Low — new file or additive to existing |
| `.opencode/plugin/synapse-coder-reporter.ts` | Plugin implementation (primary location — outside `packages/`, zero merge risk) | Low — new file outside packages/ |
| `packages/opencode/test/plugin/synapse-coder-reporter/*.test.ts` | Unit and integration tests | Low — new files |
| `docs/implementation/current/SYN-001-synapse-coder-reporter/*` | Plan documents (this directory) | Low — new files |

### Existing files modified

| File | Change | Churn risk | Justification |
|------|--------|-----------|---------------|
| None | — | — | Plugin-only approach: no core files touched |

**This is the key fork-local compliance point.** The plugin-only approach means zero changes to high-churn core files (`edit.ts`, `write.ts`, `llm.ts`, `processor.ts`, `tools.ts`). All integration logic lives in a new plugin file. `git diff dev..synapse-coder-reporter -- packages/opencode/src/tool/ packages/opencode/src/session/ packages/opencode/src/lsp/` must return empty.

## Risk Assessment

| Risk | Category | Severity | Likelihood | Mitigation |
|------|----------|----------|------------|-----------|
| Synapse Coder staging facade down or rejects auth | Technical | Medium | Low | Health check on plugin load; graceful degradation; offline queue |
| User sends sensitive client code to Synapse without realizing | Privacy/Security | High | Medium | Opt-in gate (default off); first-use TUI toast; structured logging; disable at any time |
| Plugin hook overhead slows tool execution | Performance | Medium | Low | Async fire-and-forget; no `await` in hook path; benchmark < 5ms |
| v2 plugin system lands and deprecates v1 hooks | Technical/Fork-local | Medium | Low (no timeline for v2) | v1 hooks are live and stable; v2 is not wired into session loop yet; plugin can be migrated when v2 lands |
| One-sided corrections rejected by Synapse | Signal quality | Low | Medium | Verify accepted parameters in Phase 1; document Synapse's response; iterate |
| Plugin loader path changes in upstream merge | Fork-local | Low | Low | Plugin loaded from `plugin_origins` config; loader API is stable (`packages/opencode/src/plugin/loader.ts`) |
| MCP client config schema changes | Fork-local | Low | Low | `ConfigMCPV1.Info` schema is stable; `type: "remote"` + `url` + `headers` is a core feature |

## Dependency Map

| Dependency | Type | Status |
|------------|------|--------|
| Synapse Coder MCP staging facade | External service | Available (per `C:\GitHub\AGENTS.md`) |
| Vault secret `synapse-coder-mcp-staging-bearer-token` | Secret | Available via `vault-local` MCP or `az keyvault secret show` |
| opencode v1 plugin system (`Hooks` interface) | Internal API | Stable (`packages/plugin/src/index.ts:222-335`) |
| opencode MCP client (`MCP.Service`) | Internal API | Stable (`packages/opencode/src/mcp/index.ts`) |
| opencode `tool.execute.after` hook | Internal API | Stable (`packages/plugin/src/index.ts:274-281`) |
| opencode `event` hook | Internal API | Stable (`packages/plugin/src/index.ts:224`) |
| opencode `chat.message` hook | Internal API | Stable (`packages/plugin/src/index.ts:234-243`) |

## Validation Strategy

| Validation Type | Method | Gate |
|-----------------|--------|------|
| Static checks | `bun typecheck` from `packages/opencode` | 0 errors |
| Linting | `bun run lint` (if configured) | 0 errors/warnings |
| Unit tests | `bun test` from `packages/opencode` for plugin tests | All pass |
| Integration tests | Mock MCP + mock LSP; verify report payload | All pass |
| E2E | Real opencode session with a deliberate type error; verify Synapse staging receives report | Report logged on Synapse side |
| Fork-local compliance | `git diff dev..synapse-coder-reporter -- packages/opencode/src/tool/ packages/opencode/src/session/ packages/opencode/src/lsp/` | Empty |
| Security | `grep -r "Bearer" opencode.json` returns only env var ref | No plaintext secrets |
| Performance | Benchmark hook overhead with/without plugin | < 5ms per tool call |
