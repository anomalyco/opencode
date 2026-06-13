# OpenCode for Kimi K2.6 - Setup Guide

## Overview

This fork of OpenCode is optimized for Kimi K2.6, providing maximum utilization of its capabilities:
- **256K context window** - Analyze entire large codebases
- **Advanced reasoning** - Thinking mode for complex problems
- **Multimodal support** - Vision model for UI analysis
- **Enhanced tools** - Computer control, web browser, markdown viewer
- **Swarm capabilities** - Multi-agent collaboration

## Quick Start

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/opencode-kimi.git
cd opencode-kimi

# Install dependencies
bun install

# Set your Kimi API key
export MOONSHOT_API_KEY="your-api-key-here"

# Start the desktop app
bun dev:desktop
```

### 2. Configure Kimi as Default Provider

Create or edit `~/.config/opencode/config.json`:

```json
{
  "provider": "moonshot",
  "model": "kimi-k2-6",
  "apiKey": "your-api-key-here"
}
```

Or use environment variables:
```bash
export MOONSHOT_API_KEY="your-api-key"
export OPENCODE_PROVIDER="moonshot"
export OPENCODE_MODEL="kimi-k2-6"
```

### 3. Available Models

| Model | Context | Best For | Reasoning |
|-------|---------|----------|-----------|
| `kimi-k2-6` | 256K | General coding | No |
| `kimi-k2-6-thinking` | 256K | Complex debugging | Yes |
| `kimi-k2-6-vision` | 256K | UI analysis | No |
| `kimi-k2-6-search` | 256K | Research | No |

### 4. Using Different Models

```typescript
import { Moonshot } from "@cedric/llm/providers"

// Standard model
const standard = Moonshot.kimiK26()

// Thinking mode for complex problems
const thinker = Moonshot.kimiK26Thinking()

// Vision for UI analysis
const vision = Moonshot.kimiK26Vision()
```

## Features

### Context Window Optimization

Kimi's 256K context window is automatically optimized:
- **40%** Codebase context (102K tokens)
- **30%** Conversation history (76K tokens)
- **20%** Tool results (51K tokens)
- **10%** Reserved for output (25K tokens)

Files are intelligently selected based on:
- Recent modifications
- Current working directory
- Import/references in conversation
- Config file importance

### Reasoning Mode

Enable thinking mode for complex problems:

```typescript
const model = Moonshot.configure({
  reasoningEffort: "high" // "low" | "medium" | "high"
}).model("kimi-k2-6-thinking")
```

The reasoning chain is displayed in the UI, showing Kimi's thought process.

### Computer Control

Enable Kimi to control your computer (requires permission):

```bash
# Enable computer control
export OPENCODE_COMPUTER_CONTROL=true
```

Available actions:
- **Screenshot** - Capture screen or regions
- **Click** - Simulate mouse clicks
- **Type** - Simulate keyboard input
- **Scroll** - Scroll pages

All actions require user confirmation.

### In-App Web Browser

Access the web browser panel:
- Press `Cmd/Ctrl + Shift + B` or
- Click the browser icon in the sidebar

Features:
- Browse websites within the app
- Annotate pages with highlights and comments
- Share page content with Kimi for analysis
- Capture screenshots of specific elements

### Markdown Viewer

Open markdown files with enhanced viewer:
- Syntax highlighting
- Mermaid diagram support
- Live editing with split view
- Export to PDF

### Multi-Project Workspace

Switch between projects:
- Each project maintains its own context
- Shared libraries are intelligently cached
- Project-specific AGENTS.md files
- Separate conversation histories

## Advanced Configuration

### Custom Context Allocation

```typescript
import { KimiOptimizer } from "@cedric/core/context-optimizer"

const allocation = KimiOptimizer.allocate(256000, {
  codebase: 0.50, // 50% for code
  history: 0.25,  // 25% for chat history
  tools: 0.15     // 15% for tools
})
```

### System Prompt Customization

```typescript
import { KimiOptimizer } from "@cedric/core/context-optimizer"

const prompt = KimiOptimizer.createSystemPrompt({
  projectName: "MyApp",
  language: "TypeScript",
  framework: "SolidJS",
  contextSize: "large"
})
```

### Swarm Mode

Enable multi-agent collaboration:

```bash
export OPENCODE_SWARM=true
export OPENCODE_SWARM_AGENTS=3
```

Agent roles:
- **Orchestrator** - Coordinates tasks
- **Coder** - Writes and modifies code
- **Reviewer** - Reviews and suggests improvements
- **Tester** - Generates and runs tests

## Development

### Running Tests

```bash
bun test
```

### Building

```bash
# Desktop app
bun run build:desktop

# CLI
bun run build:cli
```

### Adding New Features

1. **New Tool:** Add to `packages/core/src/tool/`
2. **New Provider:** Add to `packages/llm/src/providers/`
3. **New UI Component:** Add to `packages/app/src/components/`
4. **New Plugin:** Add to `packages/plugin/src/`

## Troubleshooting

### API Key Issues
```bash
# Verify your API key is set
echo $MOONSHOT_API_KEY

# Test the API
curl https://api.moonshot.cn/v1/models \
  -H "Authorization: Bearer $MOONSHOT_API_KEY"
```

### Context Window Issues
If you hit context limits:
- Reduce `codebase` allocation
- Clear conversation history
- Use smaller files

### Performance Issues
- Enable caching: `export OPENCODE_CACHE=true`
- Reduce `reasoningEffort` to "low"
- Close unused browser tabs

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT - See LICENSE file

## Resources

- [Kimi API Docs](https://platform.moonshot.cn/docs)
- [OpenCode Docs](https://opencode.ai/docs)
- [Discord Community](https://discord.gg/opencode)
