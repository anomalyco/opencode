# Weave — Project Instructions

## Anthropic OAuth via Claude Code Identity (Critical)

When using OAuth tokens (`sk-ant-oat-*`) obtained via Claude Code's client ID, the API enforces strict requirements. These were reverse-engineered from pi-coding-agent's `@mariozechner/pi-ai/dist/providers/anthropic.js`.

### Required Headers (OAuth only)
```
authorization: Bearer <token>
anthropic-version: 2023-06-01
content-type: application/json
accept: application/json
anthropic-dangerous-direct-browser-access: true
anthropic-beta: claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14
user-agent: claude-cli/2.1.75
x-app: cli
```

All betas are required. Removing `claude-code-20250219` causes a 400. Removing `oauth-2025-04-20` causes a 400. They must all be present together.

### System Prompt Must Be Content Blocks (OAuth only)
The system prompt MUST be an array of content blocks, NOT a plain string.
The first block MUST be the exact Claude Code identity line.
Custom instructions go in a separate second block.

```json
"system": [
  {"type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude."},
  {"type": "text", "text": "Your actual system prompt here..."}
]
```

**A plain string containing anything beyond the exact CC identity line will be rejected with a generic 400 "Error".** This is the most common failure mode — it produces an unhelpful error message.

### Tool Names Must Be PascalCase (OAuth only)
Claude Code uses PascalCase tool names. The API enforces this for OAuth tokens.

Outbound mapping (Weave → API):
- `bash` → `Bash`, `file_read` → `Read`, `file_write` → `Write`
- `grep` → `Grep`, `glob` → `Glob`
- Custom tools like `llm_map` → `LLMMap` are passed through

Inbound mapping (API → Weave): reverse the above when processing tool calls in responses.

### Tool Results Must Be User Messages
Anthropic's API only allows `role: "user"` or `role: "assistant"` in messages.
Tool results must be wrapped as:
```json
{"role": "user", "content": [
  {"type": "tool_result", "tool_use_id": "toolu_xxx", "content": "result text"}
]}
```

Assistant tool calls must include `tool_use` content blocks:
```json
{"role": "assistant", "content": [
  {"type": "text", "text": "I'll run that command."},
  {"type": "tool_use", "id": "toolu_xxx", "name": "Bash", "input": {"command": "ls"}}
]}
```

Consecutive tool results should be grouped into a single user message.

### API Key Mode (non-OAuth)
When using a regular API key (`sk-ant-api-*` or `ANTHROPIC_API_KEY`):
- No Claude Code betas needed
- System prompt can be a plain string
- Tool names can be lowercase
- Standard `x-api-key` header instead of `authorization: Bearer`

### Reference
- Pi source: `node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js`
- Pi OAuth: `node_modules/@mariozechner/pi-ai/dist/utils/oauth/anthropic.js`
- Client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e` (Claude Code's, base64 encoded in pi)
- OAuth scopes: `org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload`

## Code Paths to Keep in Sync

Both `chat/2` (non-streaming) and `chat_stream/2` (streaming) in `lib/weave/llm.ex` must apply identical OAuth formatting:
1. Content blocks for system prompt
2. Tool name PascalCase mapping
3. CC identity headers

If you add a new LLM call path, apply all three.

## Context Builder — Message Formatting

`lib/weave/context/builder.ex` converts DB messages to API format via `build_message_entries/1`:
- `tool_result` rows → grouped into `role: "user"` messages with `type: "tool_result"` content blocks
- `assistant` rows with `metadata.tool_calls` → `role: "assistant"` with `type: "tool_use"` content blocks
- Regular `user`/`assistant` rows → pass through as `%{role: ..., content: "..."}`
