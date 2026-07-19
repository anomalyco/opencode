# SYN-001: Module Register

## Module: synapse-coder-reporter

| Property | Value |
|----------|-------|
| Module ID | `synapse-coder-reporter` |
| Type | opencode v1 plugin |
| Location | `packages/opencode/src/plugin/plugins/synapse-coder-reporter.ts` (or `.opencode/plugin/synapse-coder-reporter.ts`) |
| Dependencies | Synapse Coder MCP staging facade (external), opencode v1 plugin API (`packages/plugin/src/index.ts`) |
| Config | `opencode.json` → `mcp.synapse-coder` + `plugin_origins` + `synapse_coder` (opt-in settings) |
| Hooks | `tool.execute.after`, `event`, `chat.message` |
| Tests | `packages/opencode/test/plugin/synapse-coder-reporter/` |

## Dependency Mapping

```
synapse-coder-reporter (plugin)
├── opencode v1 Hooks API (packages/plugin/src/index.ts:222-335)
│   ├── tool.execute.after (line 274-281)
│   ├── event (line 224)
│   └── chat.message (line 234-243)
├── opencode MCP client (packages/opencode/src/mcp/index.ts)
│   └── synapse-coder MCP server (remote, staging facade)
│       └── coder_report_correction tool
├── opencode config (packages/core/src/v1/config/config.ts)
│   └── mcp + plugin_origins + synapse_coder keys
└── opencode tool metadata (read-only consumption)
    ├── edit.ts metadata.diagnostics (line 203-208)
    ├── write.ts metadata.diagnostics (line 92-100)
    └── apply_patch.ts metadata.diagnostics (line 295-302)
```

## End-to-End Acceptance

The module is accepted when:
1. A correction event (LSP diagnostics after edit) is detected by the plugin
2. The plugin builds a valid `coder_report_correction` payload
3. User opt-in is respected (no report if disabled)
4. The report reaches Synapse Coder staging and is visible in its logs
5. opencode continues normally throughout (no crashes, no blocking)
