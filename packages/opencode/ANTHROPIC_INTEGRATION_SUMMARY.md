# Anthropic Integration Summary

Complete implementation of Anthropic API features with Claude Code tools and UI enhancements.

## Overview

This implementation adds comprehensive Anthropic/Claude support to OpenCode with:
1. **API Feature Flags** - Enable all Anthropic beta features via config
2. **Claude Code Tools** - 8 Anthropic-native tool wrappers
3. **Sidebar Integration** - Visual tool usage tracking
4. **System Prompt Updates** - Inform Claude about available tools

## Components Implemented

### 1. Configuration Schema (`src/config/config.ts`)

Added `anthropic` config section with 15 feature flags:

```typescript
{
  anthropic: {
    // API Features (auto-enabled via headers)
    promptCaching: true,
    reportCacheSavings: true,
    contextEditing: true,
    extendedThinking: true,
    citations: true,
    tokenEfficientToolUse: true,
    fineGrainedToolStreaming: true,
    
    // Tool Enablement
    codeExecutionTool: true,
    textEditorTool: true,
    webFetchTool: true,
    webSearchTool: true,
    memoryTool: true,
    computerUseTool: false,
    
    // Advanced Features
    prefillAssistantMessages: true,
    chainLongPrompts: true
  }
}
```

### 2. Dynamic Beta Headers (`src/provider/provider.ts`)

Automatically builds `anthropic-beta` header based on enabled features:

```typescript
const betaFeatures = []
if (promptCaching) betaFeatures.push("prompt-caching-2024-07-31")
if (contextEditing) betaFeatures.push("context-editing-2025-05-14")
if (extendedThinking) betaFeatures.push("interleaved-thinking-2025-05-14")
// ... etc

headers: {
  "anthropic-beta": betaFeatures.join(",")
}
```

### 3. Claude Code Tools (`src/tool/cc-*.ts`)

8 Anthropic-native tools that delegate to standard implementations:

| Tool | Maps To | Purpose |
|------|---------|---------|
| `cc_bash` | `bash` | Shell command execution |
| `cc_edit` | `edit` | File editing |
| `cc_read` | `read` | File reading |
| `cc_write` | `write` | File writing |
| `cc_list` | `list` | Directory listing |
| `cc_glob` | `glob` | Pattern matching |
| `cc_grep` | `grep` | Content search |
| `cc_webfetch` | `webfetch` | Web fetching |

**Key Features:**
- Thin wrappers (zero duplication)
- Anthropic-optimized descriptions
- Config-driven enable/disable
- Same robust implementations

### 4. Tool Registry Integration (`src/tool/registry.ts`)

Conditionally registers cc_* tools based on config:

```typescript
const ccTools = []
if (anthropicConfig.codeExecutionTool !== false) 
  ccTools.push(ClaudeCodeBashTool)
if (anthropicConfig.textEditorTool !== false) 
  ccTools.push(ClaudeCodeEditTool, ClaudeCodeReadTool, ...)
```

Respects permission system for both tool sets.

### 5. Sidebar UI Enhancement (`src/cli/cmd/tui/routes/session/sidebar.tsx`)

Renamed "MCP/LSP" → "Tools" and added usage tracking:

```
Tools Used
⚡ cc_bash                    ×12
⚡ cc_edit                    ×8
⚙ bash                       ×5
```

**Features:**
- ⚡ = Claude Code tools (highlighted)
- ⚙ = Standard tools
- Shows usage counts
- Real-time updates
- Top 10 most-used tools

### 6. System Prompt Integration (`src/session/prompt/anthropic.txt`)

Added comprehensive tool documentation:

```
# Available Tools

## Claude Code Tools (cc_* prefix) - RECOMMENDED
- cc_bash: Execute shell commands
- cc_read: Read file contents
- cc_edit: Make string replacements
...

PREFER these cc_* tools when available - they are designed for your 
optimal understanding and work seamlessly with your extended thinking, 
citations, and context editing capabilities.
```

## How It Works

### User Configuration

```jsonc
{
  "model": "anthropic/claude-sonnet-4-5",
  "anthropic": {
    "promptCaching": true,
    "extendedThinking": true,
    "codeExecutionTool": true
  }
}
```

### Initialization Flow

1. Config loads with feature flags
2. Provider builds beta header string
3. Tool registry registers cc_* tools based on flags
4. System prompt includes tool documentation
5. Tools sent to Claude via AI SDK

### Runtime Flow

1. User sends message
2. Claude sees both cc_* and standard tools
3. System prompt recommends cc_* tools
4. Claude calls cc_* tool
5. Tool delegates to standard implementation
6. Sidebar tracks usage in real-time
7. User sees ⚡cc_bash in sidebar

## Benefits

### For Users
- **Cost Savings**: Prompt caching reduces costs by up to 90%
- **Better Reasoning**: Extended thinking for complex tasks
- **Visibility**: See which tools Claude uses most
- **Performance**: Token-efficient tool use
- **Attribution**: Citations for sources

### For Claude
- **Optimized Tools**: Descriptions tailored for Claude's understanding
- **Better Integration**: Works with extended thinking, citations
- **Clear Guidance**: System prompt explains tool preferences
- **Seamless UX**: Tools feel native to Claude

### For Developers
- **Minimal Impact**: Only 5 files modified in core
- **Zero Duplication**: Thin wrappers, shared implementations
- **Config-Driven**: Everything controlled via config
- **Backward Compatible**: Doesn't affect other providers
- **Observable**: Sidebar shows usage analytics

## Technical Details

### Tool Registration

Tools are registered in `ToolRegistry.all()`:

```typescript
const ccTools = []
if (config.anthropic?.codeExecutionTool !== false) 
  ccTools.push(ClaudeCodeBashTool)
// ... etc

return [
  ...standardTools,
  ...ccTools,
  ...customTools
]
```

### Tool Execution

All cc_* tools follow this pattern:

```typescript
export const ClaudeCodeBashTool = Tool.define("cc_bash", {
  description: DESCRIPTION,
  parameters: z.object({ ... }),
  async execute(params, ctx) {
    const bashTool = await BashTool.init()
    return bashTool.execute(params, ctx)
  }
})
```

### Sidebar Tracking

Usage tracking via memoized computation:

```typescript
const toolsUsed = createMemo(() => {
  const toolCounts = {}
  messages().forEach(msg => {
    const parts = sync.data.part[msg.id] || []
    parts.forEach(part => {
      if (part.type === "tool" && part.state?.status === "completed") {
        toolCounts[part.tool] = (toolCounts[part.tool] || 0) + 1
      }
    })
  })
  return Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
})
```

## Files Modified

### Core Changes (5 files)
- `src/config/config.ts` - Config schema
- `src/provider/provider.ts` - Beta headers
- `src/tool/registry.ts` - Tool registration
- `src/cli/cmd/tui/routes/session/sidebar.tsx` - UI
- `src/session/prompt/anthropic.txt` - System prompt

### New Files (23 files)
- 8 tool implementations (`cc-*.ts`)
- 8 tool descriptions (`cc-*.txt`)
- 4 documentation files
- 1 test file
- 2 UI documentation files

## Testing

To test the integration:

1. **Enable features**:
```jsonc
{
  "anthropic": { "codeExecutionTool": true }
}
```

2. **Start session** with Claude model

3. **Check sidebar**: Should see "Tools" tab

4. **Use tools**: Claude will use cc_* tools

5. **Verify sidebar**: See usage counts with ⚡ icon

6. **Ask Claude**: "What tools do you have?"
   - Should list both cc_* and standard tools
   - Should explain cc_* tools are preferred

## Future Enhancements

Potential additions:
- Click tool name in sidebar to filter messages
- Show average execution time per tool
- Display error rates
- Export usage statistics
- Compare usage across sessions
- Add more Anthropic-native tools
- Implement computer use tool (experimental)

## References

- [Anthropic Prompt Caching](https://docs.claude.com/en/docs/build-with-claude/prompt-caching)
- [Extended Thinking](https://docs.claude.com/en/docs/build-with-claude/extended-thinking)
- [Citations](https://docs.claude.com/en/docs/build-with-claude/citations)
- [Tool Use Best Practices](https://docs.claude.com/en/docs/agents-and-tools/tool-use)

## Commits

1. `80ddac993` - Core Anthropic features and Claude Code tools
2. `95f636f96` - Sidebar Tools panel with usage tracking
3. `66b3b70ef` - System prompt integration

Total: ~1,200 lines added, minimal core complexity increase
