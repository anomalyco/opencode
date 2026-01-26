# ZFlow

ZFlow is an intelligent AI Agent workstation based on OpenCode, providing visualized task management, conversational interaction, and document processing capabilities.

## Overview

ZFlow extends the OpenCode ecosystem with a visual desktop interface, helping users complete complex tasks such as writing PPTs, organizing documents, researching materials, and writing code.

### Key Features

- **Conversational Interface**: Multi-agent chat with real-time streaming responses
- **Task Visualization**: Visual timeline of agent execution with step-by-step progress tracking
- **Skills Ecosystem**: Browse, invoke, and manage OpenCode Skills through the UI
- **MCP Tools**: Visual dashboard for MCP server connections and tool management
- **Document Workspace**: Built-in markdown editor, PPT builder, and knowledge base
- **Project Management**: Integrated file browser, code editor, and terminal

### Architecture

Built on proven technologies:
- **Tauri 2.x**: Lightweight desktop shell (Rust backend)
- **SolidJS**: Reactive UI framework with fine-grained reactivity
- **OpenCode Core**: Reuses `@opencode-ai/app` and `@opencode-ai/ui` components

### Hybrid Mode

- **Local Mode**: Run standalone with embedded OpenCode instance
- **Remote Mode**: Connect to a remote OpenCode server

## Development

### Prerequisites

- Node.js 18+ and Bun
- Rust toolchain and platform-specific Tauri dependencies

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for complete setup instructions.

### Installation

```bash
# From the repo root
bun install
```

### Development

```bash
# Start the desktop app with native shell
bun run --cwd packages/desktop tauri dev

# Start web dev server only (no native shell)
bun run --cwd packages/desktop dev
```

This starts the Vite dev server on http://localhost:1420 and opens the native window.

### Build

```bash
# Create production build and native app bundle
bun run --cwd packages/desktop tauri build

# Output locations:
# - Windows: packages/desktop/src-tauri/target/release/bundle/nsis/ZFlow_x64-setup.exe
# - macOS: packages/desktop/src-tauri/target/release/bundle/dmg/ZFlow.dmg
# - Linux: packages/desktop/src-tauri/target/release/bundle/deb/zflow_amd64.deb
```

## Project Structure

```
packages/
├── desktop/          # Tauri desktop application (this package)
├── desktop-viz/      # Task visualization components
├── desktop-docs/     # Document workspace components
├── app/              # Shared UI components (reused from OpenCode)
├── ui/               # UI component library (reused from OpenCode)
└── opencode/         # Core logic and server (reused from OpenCode)
```

## Based on OpenCode

ZFlow is built on top of [OpenCode](https://github.com/anomalyco/opencode), an AI-powered terminal for developers. It extends OpenCode's capabilities with a visual interface while maintaining full compatibility with the OpenCode ecosystem, including:

- Skills system (`.claude/skills/` and `.opencode/skill/`)
- MCP (Model Context Protocol) tools and servers
- Agent system (Build, Plan, and custom agents)
- Project and session management

## License

Same as OpenCode (MIT License)
