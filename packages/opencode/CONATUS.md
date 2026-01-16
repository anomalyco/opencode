# Conatus - Sovereign AI Development Environment

> *Named after Spinoza's conatus: the striving to persist in one's being.*

Conatus is your sovereign fork of OpenCode, integrating orchestration, the Ralph Loop, and human-AI dialectic systems.

## Quick Start (Development Mode)

```bash
# Navigate to the conatus directory
cd /home/bryan/projects/opencode-analysis/packages/opencode

# Run conatus in development mode (uses bun to run TypeScript directly)
bun run dev

# Run with a specific model
bun run dev -m anthropic/claude-opus-4-5-20251101

# Run headless server mode
bun run dev serve --port 4198
```

## Features

### Core OpenCode Features
- Multi-model support (Anthropic, OpenAI, Google, local models)
- MCP server integration
- Plugin system
- TUI interface

### Conatus Extensions
- **Orchestration Module**: Coordinates complex multi-agent tasks
- **Ralph Loop**: Continuous refinement cycles for quality assurance
- **Complexity Detection**: Automatically routes tasks based on complexity
- **Background Agents**: Spawn specialized agents for parallel work
- **Human-in-Loop Dialectic**: Integration with the Sisyphean deliberation system

## Configuration

Conatus uses your existing OpenCode configuration at `~/.config/opencode/opencode.json`.

Your current setup includes:
- Local Ollama models
- RunPod self-hosted models
- Vultr inference proxy
- Velocity router
- Anthropic (Claude)
- Google (Gemini via Antigravity)
- OpenAI (GPT 5.x via OAuth)

## Environment Variables

Conatus supports both new and legacy environment variable names:

| Conatus Variable | Legacy Variable | Purpose |
|-----------------|-----------------|---------|
| `CONATUS_BIN_PATH` | `OPENCODE_BIN_PATH` | Override binary path |
| `CONATUS_CONFIG` | `OPENCODE_CONFIG` | Custom config path |
| `CONATUS_SERVER_PASSWORD` | `OPENCODE_SERVER_PASSWORD` | Server auth |

## Directory Structure

```
~/.config/opencode/          # Configuration (shared with opencode)
~/.cache/opencode/           # Cache directory
~/.local/share/opencode/     # Data directory
~/.local/state/opencode/     # State directory
```

## Building for Production

```bash
# Build the binary
bun run build

# The binary will be at dist/conatus-linux-x64 (or appropriate platform)
```

## Plugins Loaded

Your configuration loads these plugins:
1. `oh-my-opencode` - Extended functionality
2. `opencode-antigravity-auth` - Antigravity API authentication
3. `./.opencode/plugin/bryan.ts` - Your custom Bryan plugin
4. `opencode-openai-codex-auth` - OpenAI Codex OAuth

## Integration with Sisyphean Works

Conatus integrates with your dialectic deliberation system:

```bash
# Check for pending continuations
python sisyphean-works/bootstrap/tools/continue.py prompt

# Process dialectic state
python sisyphean-works/bootstrap/tools/dialectic.py check
```

## Orchestration Commands

The orchestration module provides complexity-aware task routing:

- **Trivial**: Direct execution
- **Simple**: Single-agent tasks
- **Complex**: Multi-step workflows
- **Research**: Deep exploration with multiple agents
- **Ultrawork**: Full Ralph Loop engagement

## Troubleshooting

### Plugin Errors
If you see `matcher.hooks is undefined` errors with oh-my-opencode:
```bash
# The plugin at ~/.cache/opencode/node_modules/oh-my-opencode/dist/index.js
# has been patched to handle undefined hooks
```

### Missing Dependencies
```bash
cd /home/bryan/projects/opencode-analysis
bun install
```

### Port Already in Use
```bash
# Use a different port for the headless server
bun run dev serve --port 4199
```

---

*Conatus embodies persistent, joyful work through orchestration and human-AI dialectic integration.*
