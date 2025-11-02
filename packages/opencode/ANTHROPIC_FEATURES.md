# Anthropic API Features in OpenCode

OpenCode supports all of Anthropic's advanced API features through configuration flags. These features are automatically enabled via API headers when using Anthropic models.

## Configuration

Add the `anthropic` section to your `opencode.json` or `opencode.jsonc`:

```jsonc
{
  "anthropic": {
    // Enable prompt caching to reduce costs and latency (default: true)
    "promptCaching": true,

    // Report cache savings in session usage stats (default: true)
    "reportCacheSavings": true,

    // Enable context editing for compacting/compressing context (default: true)
    "contextEditing": true,

    // Enable extended thinking for complex reasoning tasks (default: true)
    "extendedThinking": true,

    // Enable citations for source attribution (default: true)
    "citations": true,

    // Enable token efficient tool use (default: true)
    "tokenEfficientToolUse": true,

    // Enable fine-grained tool streaming for progress tracking (default: true)
    "fineGrainedToolStreaming": true,

    // Enable Anthropic built-in tools (we use OpenCode equivalents by default)
    "codeExecutionTool": true, // Uses bash tool
    "textEditorTool": true, // Uses edit/write tools
    "webFetchTool": true, // Uses webfetch tool
    "webSearchTool": true, // Can add web search via MCP
    "memoryTool": true, // Uses KB (knowledge base) tools
    "computerUseTool": false, // Desktop automation (requires special setup)

    // Enable pre-fill assistant messages for guidance (default: true)
    "prefillAssistantMessages": true,

    // Enable chaining long prompts for multi-step tasks (default: true)
    "chainLongPrompts": true,
  },
}
```

## Features Explained

### Prompt Caching

Automatically caches parts of your conversation to reduce costs and improve response times. Anthropic's prompt caching can reduce input token costs by up to 90%.

**How it works:**

- System prompts and long context are cached
- Subsequent requests reuse cached content
- Savings are tracked and reported in usage stats

### Context Editing

Allows Anthropic to intelligently compact and compress context when conversations get long.

**How it works:**

- Model can request to edit/compress previous context
- Keeps conversations efficient without losing important information
- Automatic when context limits are approached

### Extended Thinking

Enables the model to show its reasoning process for complex tasks.

**How it works:**

- Model outputs intermediate thinking steps
- Helps with debugging and understanding decisions
- Particularly useful for complex coding tasks

### Citations

Provides source attribution for information in responses.

**How it works:**

- Model can cite specific sources when referencing information
- Helps verify claims and find original context
- Useful for research and fact-checking

### Token Efficient Tool Use

Optimizes how tools are called to reduce token consumption.

**How it works:**

- More compact tool call representations
- Reduces overhead of function calling
- Can significantly reduce costs for tool-heavy workflows

### Fine-grained Tool Streaming

Provides detailed progress updates during tool execution.

**How it works:**

- Real-time streaming of tool execution status
- Better UX for long-running operations
- More responsive feedback loop

### Pre-fill Assistant Messages

Allows pre-filling the assistant's response for guidance or role-playing.

**Use cases:**

- Guide response format
- Continue from specific context
- Role-playing scenarios
- Double-checking work

### Chaining Long Prompts

Breaks complex multi-step tasks into manageable chains.

**How it works:**

- Long prompts are split into logical steps
- Each step builds on previous results
- More reliable for complex workflows

## Built-in Tool Equivalents

OpenCode provides two sets of tools:

### Standard Tools

These are OpenCode's native tools with full feature sets:

| Tool                                 | Description                        |
| ------------------------------------ | ---------------------------------- |
| `bash`                               | Execute shell commands and scripts |
| `edit`, `write`, `patch`             | File manipulation and editing      |
| `read`                               | Read file contents with pagination |
| `list`                               | List directory contents            |
| `glob`                               | Pattern-based file discovery       |
| `grep`                               | Content-based file search          |
| `webfetch`                           | Retrieve web content               |
| `kb-ingest`, `kb-query`, `kb-search` | Persistent knowledge storage       |

### Claude Code Tools (`cc_` prefix)

Anthropic-native wrappers designed specifically for Claude Code integration:

| Claude Code Tool | Maps To    | Description                                  |
| ---------------- | ---------- | -------------------------------------------- |
| `cc_bash`        | `bash`     | Execute shell commands (Anthropic-optimized) |
| `cc_edit`        | `edit`     | File editing (Anthropic-optimized)           |
| `cc_read`        | `read`     | File reading (Anthropic-optimized)           |
| `cc_write`       | `write`    | File writing (Anthropic-optimized)           |
| `cc_list`        | `list`     | Directory listing (Anthropic-optimized)      |
| `cc_glob`        | `glob`     | File pattern matching (Anthropic-optimized)  |
| `cc_grep`        | `grep`     | Content search (Anthropic-optimized)         |
| `cc_webfetch`    | `webfetch` | Web fetching (Anthropic-optimized)           |

**Benefits of Claude Code Tools:**

- Follow Anthropic's tool naming conventions
- Optimized descriptions for Claude's understanding
- Better integration with extended thinking and citations
- Automatically enabled/disabled based on config flags
- Use the same robust implementations as standard tools

### Anthropic Built-in Tool Mapping

| Anthropic Tool | OpenCode Equivalent                                        | Config Flag         |
| -------------- | ---------------------------------------------------------- | ------------------- |
| Code Execution | `cc_bash` / `bash`                                         | `codeExecutionTool` |
| Text Editor    | `cc_edit`, `cc_write`, `cc_read` / `edit`, `write`, `read` | `textEditorTool`    |
| Web Fetch      | `cc_webfetch` / `webfetch`                                 | `webFetchTool`      |
| Web Search     | MCP servers (Exa, Tavily, etc.)                            | `webSearchTool`     |
| Memory         | `kb-ingest`, `kb-query`, `kb-search`                       | `memoryTool`        |
| Computer Use   | N/A (experimental)                                         | `computerUseTool`   |

## Checking Usage and Savings

When `reportCacheSavings` is enabled, cache statistics are included in session metadata:

```typescript
{
  "tokens": {
    "input": 1000,
    "output": 500,
    "cache": {
      "read": 5000,   // Tokens read from cache
      "write": 1000   // Tokens written to cache
    }
  },
  "cost": 0.05,        // Total cost
  "cacheSavings": 0.20 // Amount saved via caching
}
```

## Best Practices

1. **Keep prompt caching enabled** - It almost always reduces costs
2. **Use extended thinking for complex tasks** - Helps model reason better
3. **Enable citations when accuracy matters** - Verify sources easily
4. **Monitor cache statistics** - Optimize your prompts based on hit rates
5. **Use OpenCode's native tools** - They're already optimized for the workflow

## Disabling Features

To disable a feature, set it to `false` in your config:

```jsonc
{
  "anthropic": {
    "extendedThinking": false, // Disable thinking output
    "promptCaching": false, // Disable caching
  },
}
```

## References

- [Anthropic Prompt Caching](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)
- [Context Editing](https://docs.claude.com/en/docs/build-with-claude/context-editing)
- [Extended Thinking](https://docs.claude.com/en/docs/build-with-claude/extended-thinking)
- [Citations](https://docs.claude.com/en/docs/build-with-claude/citations)
- [Tool Use Best Practices](https://docs.claude.com/en/docs/agents-and-tools/tool-use)
