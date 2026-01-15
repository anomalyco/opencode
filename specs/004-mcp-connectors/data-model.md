# Data Model: MCP Connectors Management

**Feature**: 004-mcp-connectors
**Date**: 2026-01-15
**Status**: Complete

## Overview

This document defines the data structures, relationships, and state transitions for the MCP Connectors management feature.

---

## Core Entities

### 1. MCP Configuration (Root Entity)

**Description**: Represents the entire `.mcp.json` file structure.

**TypeScript Interface**:
```typescript
interface McpConfig {
  /** Array of input definitions for MCP server configuration */
  inputs?: McpInput[];

  /** Map of server name to server configuration */
  servers: Record<string, McpServer>;
}
```

**Validation Rules**:
- `servers` is required (cannot be null/undefined)
- `servers` must be a valid object (can be empty: `{}`)
- `inputs` is optional, defaults to empty array `[]`
- Must be valid JSON structure

**File Location**: `.mcp.json` in workspace root directory

**Default Value**:
```json
{
  "inputs": [],
  "servers": {}
}
```

---

### 2. MCP Server (Server Configuration)

**Description**: Configuration for a single MCP integration server.

**TypeScript Interface**:
```typescript
interface McpServer {
  /** Command to execute (e.g., "npx", "node", "python") */
  command: string;

  /** Command-line arguments array */
  args?: string[];

  /** Environment variables for the server process */
  env?: Record<string, string>;

  /** Optional: Additional metadata (future extension) */
  [key: string]: any;
}
```

**Field Descriptions**:
- **command** (required): Executable command name or path
  - Examples: `"npx"`, `"node"`, `"/usr/bin/python3"`
  - Validation: Non-empty string

- **args** (optional): Array of command-line arguments
  - Examples: `["-y", "package-name@latest"]`, `["--port", "3000"]`
  - Validation: Array of strings (no empty strings)

- **env** (optional): Environment variables
  - Examples: `{ "API_KEY": "xxx", "DEBUG": "true" }`
  - Validation: Object with string keys and string values

**Validation Rules**:
- `command` is required and must be non-empty string
- `args` must be array of strings (if provided)
- `env` must be object with string values (if provided)
- Server name (key in `servers` object) must be unique
- Server name must match pattern: `^[a-zA-Z0-9_-]+$` (alphanumeric + hyphen + underscore)

**Examples**:
```typescript
// Example 1: NPX package with API key
{
  "command": "npx",
  "args": ["-y", "serper-search-scrape-mcp-server"],
  "env": {
    "SERPER_API_KEY": "54c4877533593aa77844c11e9fab1ac9da18f649"
  }
}

// Example 2: Simple NPX package
{
  "command": "npx",
  "args": ["-y", "@mobilenext/mobile-mcp@latest"]
}

// Example 3: Node script
{
  "command": "node",
  "args": ["./scripts/custom-mcp-server.js"],
  "env": {
    "DEBUG": "true"
  }
}
```

---

### 3. MCP Input (Input Definition)

**Description**: Defines an input requirement for MCP server configuration.

**TypeScript Interface**:
```typescript
interface McpInput {
  /** Type of input (e.g., "promptString") */
  type: string;

  /** Additional properties based on input type */
  [key: string]: any;
}
```

**Field Descriptions**:
- **type** (required): Input type identifier
  - Standard type: `"promptString"` (user prompt for string input)
  - Future types: `"promptNumber"`, `"promptBoolean"`, `"file"`, etc.

**Validation Rules**:
- `type` is required and must be non-empty string
- Additional properties are type-specific

**Examples**:
```typescript
// Example 1: Basic prompt
{
  "type": "promptString"
}

// Example 2: Future - prompt with label
{
  "type": "promptString",
  "label": "Enter API Key",
  "required": true
}
```

**Priority**: P4 (Low) - MVP will support read-only display and raw JSON editing

---

## State Management

### UI State (In-Memory, Reactive)

**Context Store**:
```typescript
interface McpConnectorsState {
  /** Loaded MCP configuration */
  config: McpConfig;

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: string | null;

  /** Currently editing server name (null if not editing) */
  editingServer: string | null;

  /** Unsaved changes flag */
  hasUnsavedChanges: boolean;
}
```

**Layout State** (Persisted):
```typescript
interface ConnectorsLayoutState {
  /** Panel visibility */
  opened: boolean;

  /** Collapsible section state */
  collapsed: boolean;
}
```

### File State (Persistent, on Disk)

**File**: `.mcp.json` in workspace root

**Format**: JSON (UTF-8 encoded)

**Permissions**: Read/Write by application, readable by user in file system

**Backup Strategy**: None (user responsible for version control)

---

## State Transitions

### 1. Initial Load

```
[App Start]
  → Check if .mcp.json exists
    → YES: Read file → Parse JSON → Load into state
    → NO:  Create default config → Write to file → Load into state
```

**States**:
- `isLoading: true` → `false`
- `config: null` → `McpConfig`
- `error: null` (success) or `string` (failure)

---

### 2. Add Server

```
[User clicks "Add Connector"]
  → Show form dialog (editingServer = null)
  → User fills form
    → SUBMIT: Validate → Add to config.servers → Save to file → Close dialog
    → CANCEL: Close dialog (no changes)
```

**State Changes**:
- `config.servers[newName] = newServer`
- `hasUnsavedChanges: true` → `false` (after save)
- File written to disk

**Validation**:
- Server name must be unique (not in `config.servers` keys)
- Command must be non-empty
- Args must be valid array

---

### 3. Edit Server

```
[User clicks "Edit" on connector]
  → Show form dialog (editingServer = serverName)
  → Pre-fill form with existing values
    → SUBMIT: Validate → Update config.servers[name] → Save to file → Close dialog
    → CANCEL: Close dialog (no changes)
```

**State Changes**:
- `editingServer: null` → `serverName` → `null`
- `config.servers[name] = updatedServer`
- File written to disk

**Special Case - Rename**:
If server name changes:
1. Delete old key: `delete config.servers[oldName]`
2. Add new key: `config.servers[newName] = server`

---

### 4. Remove Server

```
[User clicks "Remove" on connector]
  → Show confirmation dialog
    → CONFIRM: Delete from config.servers → Save to file
    → CANCEL: No changes
```

**State Changes**:
- `delete config.servers[name]`
- File written to disk

---

### 5. External File Change

```
[File watcher detects .mcp.json modification]
  → Check hasUnsavedChanges
    → NO:  Reload config from file (silent)
    → YES: Show dialog "File changed externally. Reload and lose changes?"
      → RELOAD: Discard local changes → Reload from file
      → KEEP:   Keep local changes (ignore external change)
```

**State Changes**:
- `config` updated from file (if reload chosen)
- `hasUnsavedChanges: false` (if reload chosen)

---

### 6. Save Failure

```
[Save operation fails]
  → Set error state
  → Show error notification
  → Keep hasUnsavedChanges = true
  → Offer retry action
```

**Possible Failures**:
- Permission denied (file read-only)
- Disk full
- Invalid JSON structure
- Network file system timeout

---

## Relationships

### Entity Relationship Diagram

```
McpConfig (1)
  │
  ├─── inputs (0..*)
  │      └─── McpInput
  │
  └─── servers (0..*)
         └─── [serverName: string] → McpServer
                ├─── command: string
                ├─── args: string[]
                └─── env: Record<string, string>
```

**Cardinality**:
- One `McpConfig` per workspace
- Zero to many `McpInput` items per config
- Zero to many `McpServer` items per config
- Each server has one unique name (key)

**Referential Integrity**:
- Server names must be unique within `servers` object
- No circular references (flat structure)

---

## Validation Schema (Zod)

```typescript
import { z } from 'zod';

const McpServerSchema = z.object({
  command: z.string().min(1, "Command is required"),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
}).passthrough(); // Allow additional properties

const McpInputSchema = z.object({
  type: z.string().min(1, "Input type is required"),
}).passthrough();

const McpConfigSchema = z.object({
  inputs: z.array(McpInputSchema).optional().default([]),
  servers: z.record(
    z.string().regex(/^[a-zA-Z0-9_-]+$/, "Server name must be alphanumeric"),
    McpServerSchema
  ),
});

// Validation function
export function validateMcpConfig(data: unknown): McpConfig {
  return McpConfigSchema.parse(data);
}

// Safe validation (returns errors instead of throwing)
export function safeParseMcpConfig(data: unknown) {
  return McpConfigSchema.safeParse(data);
}
```

---

## Indexes & Queries

### Primary Access Patterns

1. **Get all servers**: `Object.entries(config.servers)`
   - Used by: List view component
   - Performance: O(n) where n = number of servers

2. **Get server by name**: `config.servers[name]`
   - Used by: Edit form, detail view
   - Performance: O(1) hash lookup

3. **Check server name exists**: `name in config.servers`
   - Used by: Add form validation
   - Performance: O(1)

4. **Get all inputs**: `config.inputs`
   - Used by: Inputs editor (P4 feature)
   - Performance: O(1) array access

### Derived Data

**Server Count**:
```typescript
const serverCount = Object.keys(config.servers).length
```

**Has Sensitive Env Vars** (for security warnings):
```typescript
function hasSensitiveEnvVars(server: McpServer): boolean {
  if (!server.env) return false;
  return Object.keys(server.env).some(key =>
    /KEY|TOKEN|SECRET|PASSWORD|API/i.test(key)
  );
}
```

---

## Edge Cases & Constraints

### 1. Empty Configuration
- **Valid**: `{ "inputs": [], "servers": {} }`
- **Display**: "No connectors configured" message

### 2. Malformed JSON
- **Detection**: JSON.parse throws error
- **Handling**: Show error notification, keep previous valid state
- **Recovery**: Offer "Edit raw JSON" option

### 3. Missing Required Fields
- **Detection**: Zod validation fails
- **Handling**: Show specific validation error
- **Recovery**: Prompt user to fix in form or raw JSON editor

### 4. Duplicate Server Names
- **Prevention**: UI validates on add/edit
- **File-level**: Schema allows (object keys are unique by definition)
- **Handling**: Form validation prevents submission

### 5. Very Long Server Names
- **Constraint**: UI truncates display at 30 characters
- **Storage**: No hard limit (JSON supports any string length)
- **UX**: Show tooltip with full name on hover

### 6. Large Number of Servers
- **Tested Up To**: 100 servers
- **Performance**: O(n) rendering, acceptable for n < 1000
- **Future**: Add pagination if needed

### 7. File Size Limits
- **Typical**: 1-10 KB
- **Max Recommended**: 100 KB
- **Hard Limit**: None (JSON.parse memory limit ~512 MB)

---

## Migration & Versioning

### Schema Version

**Current**: Implicit v1 (no version field)

**Future Versioning**:
```json
{
  "version": "1.0",
  "inputs": [...],
  "servers": {...}
}
```

### Breaking Changes

**Handling**:
1. Detect missing or unknown fields
2. Show migration prompt
3. Apply automatic migration if possible
4. Fallback: Manual JSON editing

**Example Migration** (hypothetical):
```typescript
function migrateV0ToV1(config: any): McpConfig {
  // V0 had "connectors" instead of "servers"
  if (config.connectors && !config.servers) {
    return {
      inputs: config.inputs || [],
      servers: config.connectors
    };
  }
  return config;
}
```

---

## Performance Considerations

### File I/O
- **Read Frequency**: Once on mount, then only on external changes
- **Write Frequency**: Debounced (max 1 write per 500ms)
- **File Size**: Small (<100 KB typically)
- **Optimization**: Debounce writes to prevent excessive disk I/O

### Memory Usage
- **Typical**: <1 KB (small config object)
- **Max Expected**: <100 KB (100 servers with env vars)
- **Optimization**: None needed (in-memory state is negligible)

### Rendering Performance
- **List Rendering**: Solid.js `<For>` with keying by server name
- **Re-rendering**: Only changed items re-render (Solid.js granular reactivity)
- **Optimization**: Virtualization not needed for <100 items

---

## Security Considerations

### Sensitive Data in Environment Variables

**Risk**: API keys, tokens, secrets stored in plain text

**Mitigations**:
1. Visual indicator (🔒 icon) for sensitive-looking keys
2. Warning message when adding env vars
3. Documentation: Recommend external env var references

**Not Implemented** (out of scope):
- Encryption (adds key management complexity)
- OS keychain integration (platform-specific)

### File Permissions

**Default**: User read/write, no system-wide access

**Recommendation**: Use `.gitignore` to exclude `.mcp.json` if it contains secrets

---

## Testing Requirements

### Unit Tests (Data Validation)

1. **Schema Validation**:
   - Valid config passes validation
   - Invalid config fails with specific errors
   - Missing required fields detected

2. **State Transitions**:
   - Add server updates state correctly
   - Edit server updates state correctly
   - Remove server deletes from state

3. **Edge Cases**:
   - Empty config handled
   - Duplicate names prevented
   - Invalid JSON detected

### Integration Tests (File Operations)

1. **File Read**:
   - Read existing valid file
   - Read missing file (auto-create)
   - Read corrupted file (error handling)

2. **File Write**:
   - Write valid config
   - Write permission denied (error handling)

3. **File Watch**:
   - External modification detected
   - Reload prompt shown if unsaved changes

---

**Data Model Status**: ✓ Complete
**Next Phase**: Contracts & API Design
