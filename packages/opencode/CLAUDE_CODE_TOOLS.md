# Claude Code Tools (`cc_` prefix)

OpenCode provides Anthropic-native tool wrappers with the `cc_` prefix, designed specifically for optimal integration with Claude Code and Anthropic's API features.

## Why Claude Code Tools?

While OpenCode's standard tools (`bash`, `edit`, `read`, etc.) are powerful and feature-complete, the `cc_` prefixed tools offer several advantages when working with Anthropic models:

1. **Naming Convention Alignment**: Follows Anthropic's conventions for tool naming
2. **Optimized Descriptions**: Tool descriptions tailored for Claude's understanding
3. **Better Integration**: Enhanced compatibility with extended thinking, citations, and context editing
4. **Config-Driven**: Automatically enabled/disabled based on `anthropic` config flags
5. **Same Implementation**: Uses the same robust, battle-tested code as standard tools

## Available Tools

### File Operations

#### `cc_read`
Read file contents with pagination support.

```json
{
  "filePath": "/path/to/file.ts",
  "offset": 0,     // Optional: line number to start from
  "limit": 2000    // Optional: number of lines to read
}
```

#### `cc_write`
Write content to a file (overwrites existing files).

```json
{
  "filePath": "/path/to/file.ts",
  "content": "const foo = 'bar';"
}
```

#### `cc_edit`
Perform exact string replacements in files.

```json
{
  "filePath": "/path/to/file.ts",
  "oldString": "const foo = 'bar';",
  "newString": "const foo = 'baz';",
  "replaceAll": false  // Optional: replace all occurrences
}
```

### Directory Operations

#### `cc_list`
List files and directories.

```json
{
  "path": "/path/to/directory",  // Optional: defaults to workspace
  "ignore": ["node_modules", ".git"]  // Optional: patterns to ignore
}
```

### File Discovery

#### `cc_glob`
Pattern-based file matching.

```json
{
  "pattern": "**/*.test.ts",
  "path": "/path/to/search"  // Optional: defaults to workspace
}
```

#### `cc_grep`
Content-based file search using regex.

```json
{
  "pattern": "class \\w+Service",
  "include": "*.ts",  // Optional: file pattern filter
  "path": "/path/to/search"  // Optional: defaults to workspace
}
```

### Code Execution

#### `cc_bash`
Execute shell commands in a persistent session.

```json
{
  "command": "npm test",
  "timeout": 120000,  // Optional: timeout in milliseconds
  "description": "Run test suite"
}
```

### Web Operations

#### `cc_webfetch`
Fetch content from URLs.

```json
{
  "url": "https://example.com/api/data",
  "format": "markdown",  // or "text", "html"
  "timeout": 30  // Optional: timeout in seconds
}
```

## Configuration

Enable/disable Claude Code tools in your `opencode.json`:

```jsonc
{
  "anthropic": {
    "codeExecutionTool": true,    // Enables cc_bash
    "textEditorTool": true,        // Enables cc_edit, cc_read, cc_write, cc_list
    "webFetchTool": true           // Enables cc_webfetch
    // cc_glob and cc_grep are always enabled
  }
}
```

## Tool Mapping

| Claude Code Tool | Standard Tool | Purpose |
|------------------|---------------|---------|
| `cc_bash` | `bash` | Shell command execution |
| `cc_edit` | `edit` | String replacement in files |
| `cc_read` | `read` | File reading with pagination |
| `cc_write` | `write` | File creation/overwriting |
| `cc_list` | `list` | Directory listing |
| `cc_glob` | `glob` | Pattern-based file search |
| `cc_grep` | `grep` | Content-based file search |
| `cc_webfetch` | `webfetch` | HTTP content fetching |

## When to Use Which Tools?

### Use Claude Code Tools (`cc_`) when:
- Working with Anthropic/Claude models
- Want optimal integration with Claude Code features
- Using extended thinking or citations
- Following Anthropic's tool conventions

### Use Standard Tools when:
- Working with non-Anthropic models
- Need specific OpenCode features not exposed in cc_ wrappers
- Prefer OpenCode's naming conventions
- Tool preference is model-agnostic

## Implementation Details

All `cc_` tools are thin wrappers that:
1. Accept Anthropic-style parameters
2. Transform to OpenCode's internal format
3. Delegate to the standard tool implementation
4. Return results in the expected format

This means you get the best of both worlds:
- Anthropic-optimized interface
- OpenCode's robust implementation

## Example Usage

```typescript
// Using cc_read to read a file
const result = await cc_read({
  filePath: "/Users/dev/project/src/index.ts",
  limit: 100
});

// Using cc_edit to modify a file
await cc_edit({
  filePath: "/Users/dev/project/src/index.ts",
  oldString: "const VERSION = '1.0.0';",
  newString: "const VERSION = '2.0.0';"
});

// Using cc_bash to run tests
await cc_bash({
  command: "npm test -- --coverage",
  description: "Run tests with coverage"
});

// Using cc_glob to find TypeScript files
const files = await cc_glob({
  pattern: "src/**/*.ts"
});

// Using cc_grep to find TODO comments
const todos = await cc_grep({
  pattern: "TODO:",
  include: "*.{ts,tsx}"
});
```

## Permissions

Claude Code tools respect the same permission system as standard tools:

```jsonc
{
  "agent": {
    "build": {
      "permission": {
        "bash": "ask",     // Also applies to cc_bash
        "edit": "allow",   // Also applies to cc_edit, cc_write
        "webfetch": "deny" // Also applies to cc_webfetch
      }
    }
  }
}
```

## Best Practices

1. **Read Before Write**: Always use `cc_read` before `cc_write` for existing files
2. **Precise Edits**: Use `cc_edit` for targeted changes instead of `cc_write`
3. **Batch Operations**: Combine multiple `cc_glob`/`cc_grep` calls in parallel
4. **Descriptive Commands**: Provide clear descriptions for `cc_bash` commands
5. **Pattern Optimization**: Use specific patterns in `cc_glob` to reduce result sets

## Troubleshooting

### Tool Not Available
If a `cc_` tool is not available, check your config:
```jsonc
{
  "anthropic": {
    "codeExecutionTool": true,  // Required for cc_bash
    "textEditorTool": true,      // Required for cc_edit, cc_read, cc_write, cc_list
    "webFetchTool": true         // Required for cc_webfetch
  }
}
```

### Permission Denied
If tool execution fails with permission errors, check:
1. Agent permission configuration
2. File/directory access rights
3. Allowed directories configuration

### Tool Execution Errors
All `cc_` tools delegate to standard tools, so:
- Check standard tool documentation for detailed behavior
- Review error messages for specific failure reasons
- Consult OpenCode logs for debugging information
