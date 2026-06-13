# OpenKimi Architecture

## Overview

OpenKimi is a desktop application built on the OpenCode foundation, optimized specifically for Kimi K2.6 AI models. It consists of multiple packages working together to provide a seamless AI coding assistant experience.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Desktop (Electron)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Main        │  │  Renderer    │  │  Preload         │  │
│  │  Process     │◄─┤  Process     │◄─┤  Script          │  │
│  │  (Node.js)   │  │  (Chromium)  │  │  (Bridge)        │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│         └─────────────────┘                                  │
│                   IPC                                        │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    Core Services                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  LLM         │  │  Context     │  │  Tools           │  │
│  │  Provider    │  │  Optimizer   │  │  (Bash, Edit,    │  │
│  │  (Moonshot)  │  │  (256K)      │  │   Computer)      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────┘  │
│         │                 │                                  │
│         └─────────────────┘                                  │
│                   Effect-TS                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                    Kimi API (api.moonshot.cn)
```

## Package Details

### @openkimi/desktop

The Electron desktop application package.

**Responsibilities:**
- Window management
- Native OS integration
- Sidecar server management
- IPC communication
- Auto-updater

**Key Files:**
- `src/main/index.ts` - Main process entry
- `src/main/windows.ts` - Window creation
- `src/main/server.ts` - Sidecar management
- `src/renderer/index.tsx` - Renderer entry
- `src/preload/index.ts` - IPC bridge

### @cedric/llm

LLM provider and protocol implementations.

**Responsibilities:**
- Provider abstraction
- Protocol handling
- Request/response streaming
- Tool call management

**Key Files:**
- `src/providers/moonshot.ts` - Kimi provider
- `src/protocols/openai-chat.ts` - OpenAI protocol
- `src/schema/` - Type definitions
- `src/route/` - Request routing

### @cedric/core

Core business logic and services.

**Responsibilities:**
- Context optimization
- Tool implementations
- File system operations
- Session management

**Key Files:**
- `src/context-optimizer/kimi-optimizer.ts` - Context management
- `src/tool/computer-control.ts` - Automation tools
- `src/swarm/architecture.md` - Swarm design

### @cedric/app

Main UI application logic.

**Responsibilities:**
- Chat interface
- Session management
- Command handling
- State management

### @cedric/ui

Shared UI components and design system.

**Responsibilities:**
- Component library
- Theme management
- Icons and assets
- Layout components

## Data Flow

### 1. User Input
```
User → Renderer → IPC → Main → Sidecar → LLM Provider → Kimi API
```

### 2. AI Response
```
Kimi API → LLM Provider → Sidecar → Main → IPC → Renderer → User
```

### 3. Tool Execution
```
Kimi API → Tool Call → Tool Implementation → File System → Result → Kimi API
```

## Key Technologies

- **Effect-TS** - Functional programming framework for async operations
- **SolidJS** - Reactive UI framework
- **Electron** - Cross-platform desktop framework
- **Bun** - JavaScript runtime and package manager
- **Vite** - Build tool and dev server

## Configuration

### Environment Variables

```bash
# Required
MOONSHOT_API_KEY="your-api-key"

# Optional
OPENKIMI_CHANNEL="dev"          # dev | beta | prod
OPENKIMI_PORT="3000"            # Custom port
OPENKIMI_TEST_ONBOARDING="1"    # Enable test onboarding
```

### Config Files

- `package.json` - Package configuration
- `electron-builder.config.ts` - Build configuration
- `electron.vite.config.ts` - Vite configuration
- `.opencode/presets/kimi.json` - Kimi preset

## Extension Points

### Adding a New Provider

1. Create provider in `packages/llm/src/providers/`
2. Add to `packages/llm/src/providers/index.ts`
3. Update `packages/core/src/provider.ts`

### Adding a New Tool

1. Create tool in `packages/core/src/tool/`
2. Export from `packages/core/src/tool/index.ts`
3. Add to tool registry

### Adding a New UI Component

1. Create component in `packages/ui/src/components/`
2. Export from `packages/ui/src/index.ts`
3. Use in `packages/app/src/components/`

## Performance Considerations

### Context Window
- Maximum: 256K tokens
- Default allocation: 40% code, 30% history, 20% tools
- Optimized for mixed Chinese/English content

### Memory
- Sidecar process isolated from renderer
- Lazy loading of large dependencies
- Efficient streaming for responses

### Startup
- Parallel initialization of services
- Deferred loading of non-critical components
- Cached compilation for faster rebuilds

## Security

- API keys stored in OS keychain (when available)
- Sandboxed renderer process
- CSP headers for renderer
- Input validation on all IPC channels
- Confirmation for destructive operations

## Future Architecture

### Swarm Mode
- Multiple agent instances
- Shared memory for coordination
- Task decomposition and integration

### Plugin System
- Sandboxed plugin execution
- Hot-reload for development
- Plugin marketplace

### Multi-Modal
- Image processing pipeline
- Document parsing
- Audio transcription
