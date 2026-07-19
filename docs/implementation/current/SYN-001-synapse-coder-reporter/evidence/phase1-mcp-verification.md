# Phase 1 Evidence: MCP Wiring Verification (Task 1.2)

**Date:** 2026-07-19
**Verifier:** AI agent (resume session)
**Branch:** `synapse-coder-reporter` (worktree `C:\GitHub\opencode---synapse-coder-reporter`)

## 1. Config validation (Task 1.1)

`.opencode/opencode.jsonc` contains `mcp.synapse-coder`:

```jsonc
"synapse-coder": {
  "type": "remote",
  "url": "https://synapse-coder-mcp-staging.greenbay-703e5a45.australiaeast.azurecontainerapps.io/mcp",
  "headers": {
    "Authorization": "Bearer {env:SYNAPSE_CODER_STAGING_BEARER_TOKEN}",
  },
},
```

No plaintext secret — `{env:VAR}` substitution only (NAC-003).

**Fix applied during verification:** the two `local` MCP entries (`vault-local`, `azure-devops`)
used the wrong shape for this fork (`command` string + `args` + `env`). The schema
(`packages/core/src/v1/config/mcp.ts:6-23`) requires `command: string[]` (command+args combined),
`environment` (not `env`), and `enabled`. Corrected in the same file.

## 2. `opencode mcp list` — server connects (AC-001)

Command (from `packages/opencode`, token resolved from vault
`synapse-coder-mcp-staging-bearer-token` into `SYNAPSE_CODER_STAGING_BEARER_TOKEN`):

```
bun run --conditions=browser ./src/index.ts mcp list
```

Output (trimmed):

```
●  ✓ synapse-coder connected
│      https://synapse-coder-mcp-staging.greenbay-703e5a45.australiaeast.azurecontainerapps.io/mcp
●  ✓ keystone connected
●  ✓ alterspective-rag connected
●  ✓ vault-local connected
```

(Other entries in the list come from user-global config and are unrelated to this change.)

## 3. Direct tool discovery — `coder_report_correction` present

JSON-RPC `tools/list` against the staging facade with the vault bearer token:

```
HTTP 200
tools (12): coder_generate, coder_fix, coder_models, coder_stats, coder_kpi,
coder_benchmark, coder_report_correction, coder_lesson_list, coder_lesson_promote,
coder_lesson_reject, coder_lesson_demote, coder_lesson_reindex
```

`coder_report_correction` is available for the reporter module (Phase 3).

## 4. Plugin hook firing

`tool.execute.after` firing is covered by the plugin unit/integration tests:
`packages/opencode/test/plugin/synapse-coder-reporter/synapse-coder-reporter.test.ts`
invokes the hook with simulated edit/write/apply_patch tool calls + LSP diagnostics
metadata and asserts detection, payload shape, opt-in gating, and fire-and-forget
behaviour. 23/23 pass in isolation; 34/34 across all three new test files
(stability: 6/6 clean consecutive combined runs).
