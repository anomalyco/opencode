# MCP Tool Null Parameters Fix — PR #33160

## Summary

Fixed MCP tool parameter issue for MiniMax and other OpenAI-compatible providers.

## Issue

MCP tool parameters with only a `description` field (no explicit `type`) caused MiniMax and other `@ai-sdk/openai-compatible` models to receive `null` values instead of actual parameter values.

## Root Cause

`sanitizeOpenAISchema()` in `transform.ts` was only called for:
- `@ai-sdk/openai`
- `@ai-sdk/azure`

But **NOT** for `@ai-sdk/openai-compatible`, which is the provider used by:
- MiniMax (via `proxyllm` or direct MiniMax API)
- DeepSeek
- Groq
- Local OpenAI-compatible proxies

## Changes

### 1. `packages/opencode/src/provider/transform.ts`
- Extended `sanitizeOpenAISchema()` condition to include `@ai-sdk/openai-compatible`
- Improved type inference: adds `type: "string"` when only `description` is present
- Preserves `default`, `examples`, `title` fields (valid OpenAI schema keywords)

### 2. `packages/opencode/src/mcp/catalog.ts`
- Defensive null-stripping before forwarding to MCP server

### 3. `packages/opencode/src/agent/subagent-permissions.ts`
- Inherit MCP tool `allow` permissions in subagent sessions (related to #16491)

### 4. `packages/opencode/src/mcp/index.ts`
- Improved error logging when MCP server is unavailable

## PR Details

- **PR:** https://github.com/anomalyco/opencode/pull/33160
- **Closes:** #21080
- **Related:** #16491
- **Branch:** `renearaos:fix/mcp-null-params` → `anomalyco:dev`
- **Tests:** 453 tests pass (269 transform + 184 mcp/provider)
- **Manual test:** MiniMax-M3 confirmed correct parameter values

## Files Changed

```
packages/opencode/src/provider/transform.ts         | +14 lines
packages/opencode/src/mcp/catalog.ts               | +7 lines
packages/opencode/src/agent/subagent-permissions.ts| +12 lines
packages/opencode/src/mcp/index.ts                 | +1 line
packages/opencode/test/provider/transform.test.ts   | +3 lines
.gitignore                                        | +2 lines
```

## Note on #16491

This PR includes a partial fix for #16491 (MCP tool permissions in subagents). However, PR #30288 (by ollikurki) addresses #16491 with a more targeted approach using pattern-based filtering. The maintainer will determine how to handle both fixes.

## Verification

Tested with MiniMax-M3 via `proxyllm` provider:
- Tool called with `{"url_path":"/api/dashboard"}` instead of `null`
