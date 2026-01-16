# Data Model: MCP Connectors API Alignment

**Feature**: 006-fix-mcp-api-alignment
**Date**: 2026-01-15

## Overview

This is an API alignment fix, not a new feature. The data model from the original 004-mcp-connectors implementation is correct and unchanged. This document captures the entity mappings relevant to the fix work.

## Entities (Unchanged)

### McpConfig
Root configuration object stored in `.mcp.json`.

```typescript
interface McpConfig {
  mcpServers: Record<string, McpServerConfig>
}
```

### McpServerConfig
Individual MCP server connector configuration.

```typescript
interface McpServerConfig {
  command: string           // Executable command (e.g., "npx", "python")
  args?: string[]           // Command arguments
  env?: Record<string, string>  // Environment variables
  disabled?: boolean        // Whether connector is disabled
}
```

### OperationResult<T>
Standard async operation response type.

```typescript
interface OperationResult<T = void> {
  success: boolean
  data?: T
  error?: string
  validationErrors?: ValidationError[]
}
```

### ValidationError
Structured validation error from Zod.

```typescript
interface ValidationError {
  field: string     // Dot-notation path (e.g., "env.API_KEY")
  message: string   // Human-readable error message
}
```

## API Surface Changes

This fix aligns the implementation with these API contracts:

| Entity | Property | Before (Incorrect) | After (Correct) |
|--------|----------|-------------------|-----------------|
| ZodError | Access errors | `.errors` | `.issues` |
| OperationResult | Return type | `<McpConfig>` | `<void>` for save ops |
| File read result | Access content | `result` | `result.data.content` |

## State Management

No changes to state management. The McpConnectorsContext manages:

- `config: McpConfig` - Current configuration
- `isLoading: boolean` - Loading state
- `error: string | null` - Error message
- `hasUnsavedChanges: boolean` - Dirty tracking

## File System Interaction

| Operation | Before | After |
|-----------|--------|-------|
| Read config | `sdk.client.file.read()` | No change |
| Write config | `sdk.client.file.write()` | `writeTextFile()` |

## Relationships

```
.mcp.json
    └── McpConfig
            └── mcpServers: Record<string, McpServerConfig>
                    ├── "server-1": McpServerConfig
                    ├── "server-2": McpServerConfig
                    └── ...
```

## Validation Rules (Unchanged)

From the Zod schema:

1. **Server name**: Required, non-empty string
2. **Command**: Required, non-empty string
3. **Args**: Optional array of strings
4. **Env**: Optional record of string key-value pairs
5. **Disabled**: Optional boolean

## Notes

- This fix does not change the data model
- All entity definitions remain as designed in 004-mcp-connectors
- Only the API usage patterns change, not the underlying data structures
