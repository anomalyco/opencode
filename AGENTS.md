## IMPORTANT

- Try to keep things in one function unless composable or reusable
- DO NOT do unnecessary destructuring of variables
- DO NOT use `else` statements unless necessary
- DO NOT use `try`/`catch` if it can be avoided
- AVOID `try`/`catch` where possible
- AVOID `else` statements
- AVOID using `any` type
- AVOID `let` statements
- PREFER single word variable names where possible
- Use as many bun apis as possible like Bun.file()

## Debugging

- To test opencode in the `packages/opencode` directory you can run `bun dev`

## Context Control for Subagents

Subagents can be configured with context filters to control what parent session context they receive. This enables better performance for lightweight local models.

### Configuration

Add a `context` field to your agent configuration:

```yaml
context:
  mode: filtered
  maxTokens: 2000
  includeToolResults: ["read", "edit"]
  includeMessageTypes: ["user"]
```

### Modes

- `none` (default) - No parent context
- `summary` - Compact summary with message counts and tool usage
- `filtered` - Selective inclusion by message type and tool results
- `full` - All context with token/message limits

### Example

```yaml
---
mode: subagent
model: ollama/llama3.2:1b
context:
  mode: filtered
  includeToolResults: ["read"]
  maxTokens: 2000
---
```

See `.opencode/agent/` for example configurations.

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE. Here is an example illustrating how to execute 3 parallel file reads in this chat environment:

json
{
"recipient_name": "multi_tool_use.parallel",
"parameters": {
"tool_uses": [
{
"recipient_name": "functions.read",
"parameters": {
"filePath": "path/to/file.tsx"
}
},
{
"recipient_name": "functions.read",
"parameters": {
"filePath": "path/to/file.ts"
}
},
{
"recipient_name": "functions.read",
"parameters": {
"filePath": "path/to/file.md"
}
}
]
}
}
