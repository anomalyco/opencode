# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Install dependencies**: `bun install`
- **Run development server**: `bun dev` (runs the main opencode CLI in development mode)
- **Typecheck**: `bun run typecheck` (runs typecheck across all packages)
- **Run tests**: `bun test` (in packages/opencode directory for main tests)
- **Single test file**: `bun test test/tool/tool.test.ts`
- **Pre-push hook**: Automatically runs `bun run typecheck` before pushing (installed via `./script/hooks`)

## Architecture Overview

OpenCode is an AI coding agent built for the terminal with a client/server architecture:

### Core Components

- **TypeScript Server** (`packages/opencode/`): Main backend with tool registry, session management, and API endpoints
- **Go TUI Client** (`packages/tui/`): Terminal UI built with Bubble Tea framework
- **Stainless SDK** (`packages/sdk/`): Auto-generated client libraries for Go and JS
- **Web Interface** (`packages/web/`): Astro-based documentation and sharing interface
- **VSCode Extension** (`sdks/vscode/`): IDE integration

### Key Architecture Patterns

- **Tool System**: Tools implement `Tool.Info` interface with `execute()` method. All tools are registered in `packages/opencode/src/tool/registry.ts`
- **Context & DI**: Use `App.provide()` for dependency injection, pass `sessionID` in tool context
- **Validation**: All inputs validated with Zod schemas, prefer Result patterns over throwing exceptions
- **Namespaced Organization**: Code organized by namespace (e.g., `Tool.define()`, `Session.create()`, `Storage.namespace()`)

## Code Style Guidelines

Based on `AGENTS.md` and codebase patterns:

- **Runtime**: Bun with TypeScript ESM modules
- **Imports**: Relative imports for local modules, named imports preferred
- **Variables**: Single word variable names where possible, avoid unnecessary destructuring
- **Control Flow**: Avoid `else` statements and `try`/`catch` where possible
- **Types**: Use Zod schemas for validation, avoid `any` type, prefer `const` over `let`
- **APIs**: Use Bun APIs like `Bun.file()` when possible

## Important Notes

- **API Client Generation**: When modifying server endpoints in `packages/opencode/src/server/server.ts`, the opencode team needs to generate a new Stainless SDK for client updates
- **Monorepo Structure**: Uses Bun workspaces with packages in `packages/` and `sdks/`
- **SST Deployment**: Infrastructure defined in `sst.config.ts` and `infra/app.ts`
- **Provider Agnostic**: Supports multiple AI providers (Anthropic, OpenAI, Google, local models)