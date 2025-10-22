# OpenCode Project Overview

OpenCode is an open-source AI coding agent built for the terminal. It's a 100% open source alternative to Claude Code with provider-agnostic AI support.

## Project Purpose
- AI coding agent designed for terminal usage
- Client/server architecture allowing remote operation
- Built-in LSP support
- Focus on terminal user interface (TUI)
- Provider-agnostic (supports Anthropic, OpenAI, Google, local models)

## Tech Stack
- **Runtime**: Bun 1.3+
- **Language**: TypeScript with strict typing
- **Package Manager**: Bun with workspaces
- **Build System**: Turbo for monorepo management
- **UI**: SolidJS for web components, Go for TUI (being replaced)
- **Testing**: Bun test runner
- **Linting**: Prettier with specific configuration

## Core Architecture
- `packages/opencode`: Core business logic & server (TypeScript)
- `packages/tui`: Terminal UI (Go, will be replaced by opentui)
- `packages/plugin`: Plugin system source
- `packages/sdk`: SDK for client development
- `packages/web`: Web interface and documentation
- `packages/ui`: Shared UI components
- `packages/slack`: Slack integration
- `packages/console`: Console application

## Key Features
- Multi-provider AI support (Anthropic, OpenAI, Google, local models)
- Built-in LSP (Language Server Protocol) support
- Terminal-first design philosophy
- Client/server architecture
- Plugin system for extensibility
- Real-time collaboration and sharing