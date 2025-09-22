# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common Commands

### Development
```bash
# Install dependencies
bun install

# Start development mode (runs opencode locally)
bun dev

# Run opencode with specific arguments in development
bun run --conditions=development packages/opencode/src/index.ts [args...]

# Type checking across all packages
bun turbo typecheck

# Format code (uses Prettier)
bun run script/format.ts

# Generate API clients
bun run generate
```

### Testing
```bash
# Run specific test
bun test packages/opencode/test/bun.test.ts

# Test specific file or function
cd packages/opencode && bun test --grep "test_name"
```

### Building and Publishing
```bash
# Build all packages
bun turbo build

# Build specific package
cd packages/opencode && bun run build

# Publish (requires proper credentials)
bun run script/publish.ts
```

## Architecture Overview

### Project Structure
This is a monorepo using Bun workspaces with several key packages:

- **`packages/opencode/`** - Core CLI application and AI agent
- **`packages/console/`** - Web console interface (multi-package setup)
- **`packages/app/`** - Desktop application (Solid.js)
- **`packages/web/`** - Web interface
- **`packages/function/`** - Serverless functions
- **`packages/sdk/`** - Client SDKs
- **`infra/`** - SST infrastructure definitions

### Core Components (packages/opencode/src/)

#### CLI Architecture
- **`index.ts`** - Main entry point with yargs command setup
- **`cli/cmd/`** - Individual command implementations (run, generate, auth, etc.)
- **`cli/bootstrap.ts`** - Project initialization and setup
- **`cli/ui.ts`** - Terminal UI utilities and styling

#### Agent System
- **`agent/agent.ts`** - AI agent configuration and management
- Built-in agents: `general`, `build`, `plan`
- Agents have configurable tools, permissions, and prompts
- Support for custom agents via config

#### Session Management
- **`session/`** - Chat session handling and persistence
- **`session/message-v2.ts`** - Message and part management
- **`session/prompt/`** - Provider-specific prompts (Anthropic, Gemini, etc.)
- Sessions support sharing, compaction, and revert functionality

#### Provider Integration
- **`provider/`** - LLM provider abstraction layer
- **`provider/models.ts`** - Model definitions and capabilities
- Supports multiple providers: Anthropic, OpenAI, Google, local models

#### File Operations
- **`file/`** - File system operations and utilities
- **`file/ripgrep.ts`** - Fast text search using ripgrep
- **`file/fzf.ts`** - Fuzzy file finding
- **`file/ignore.ts`** - Git ignore pattern handling

#### Server Architecture
- **`server/server.ts`** - Hono-based API server
- **`server/tui.ts`** - Terminal UI server integration
- RESTful API with OpenAPI documentation
- Server supports project-scoped operations

### Configuration System
- **`config/config.ts`** - Configuration management
- Supports per-project and global configuration
- Handles provider settings, permissions, and agent configuration

### Development Notes from AGENTS.md
- Keep functions cohesive and avoid unnecessary destructuring
- Avoid `else` statements and `try`/`catch` where possible
- Prefer single-word variable names
- Use Bun APIs (e.g., `Bun.file()`) when available
- Use `bun dev` in `packages/opencode` directory for testing

### Tools and Permissions
The system includes a comprehensive tool registry with configurable permissions:
- File operations (read, write, edit, glob, grep)
- Shell execution (bash)
- Todo management
- Web search capabilities

### Infrastructure
- Uses SST for cloud deployment (Cloudflare-based)
- Supports multiple stages (dev, production)
- Includes Stripe integration for billing
- Database integration via PlanetScale

## Project Conventions
- TypeScript throughout with strict type checking
- Bun as the primary runtime and package manager
- Prettier for code formatting (120 character width, no semicolons)
- Zod for runtime type validation and schema definitions
- Event-driven architecture using a custom Bus system