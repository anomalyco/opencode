# Glossary

**Last Updated:** 2026-01-15

Quick reference for key terms and concepts used in the OpenWork codebase.

---

## A

### Agent
An AI-powered assistant that can execute tasks using tools. Agents orchestrate tool calls and manage conversation context.

### AppHandle
Tauri's main application handle, providing access to windows, state, and system APIs from Rust code.

---

## B

### Bun
JavaScript runtime and package manager used by OpenWork. Version 1.3.5+.

### Bus/BusEvent
Internal event system for publishing and subscribing to typed events across the application.

---

## C

### Context (Solid.js)
A mechanism for sharing state across component trees without prop drilling. Created using `createSimpleContext`.

### createMemo
Solid.js primitive for creating computed/derived values that automatically update when dependencies change.

### createSignal
Solid.js primitive for creating reactive state. Returns `[getter, setter]` tuple.

### createStore
Solid.js primitive for creating reactive object state with path-based updates.

---

## D

### DTD (Dart Tooling Daemon)
Protocol for communicating with Dart/Flutter development tools.

---

## H

### Hono
Lightweight web framework used for the REST API server in `packages/opencode`.

### Hooks (Plugin)
Extension points in the plugin system where custom code can be injected (e.g., `tool`, `auth`, `chat`, `permission`).

---

## K

### Kobalte
UI component library (`@kobalte/core`) providing accessible primitives for Solid.js.

---

## L

### LSP (Language Server Protocol)
Protocol for IDE features like autocomplete, go-to-definition. Integrated in `packages/opencode/src/lsp`.

---

## M

### MCP (Model Context Protocol)
Protocol for connecting AI models to external tools and resources. Defines tools, resources, and prompts.

### MCP Server
A server implementing MCP that provides tools/resources to AI agents. Can be stdio, SSE, or HTTP-based.

---

## O

### OpenAPI
Specification format for REST APIs. The SDK is auto-generated from `openapi.json`.

### OpenCode
The underlying AI coding assistant that OpenWork is built upon.

---

## P

### Persist/Persisted
Utility for saving state to storage (global, workspace, or session-scoped).

### Plugin
Async function that returns hooks for extending OpenWork functionality.

### Provider
AI model integration (e.g., Anthropic, OpenAI, Google). Supports 18+ providers.

---

## R

### Runtime (Tauri)
Generic type parameter `R: Runtime` in Tauri code, allowing platform abstraction.

---

## S

### Session
A conversation context containing message history, file activity, and permissions.

### Sidecar
External executable bundled with the desktop app (e.g., the OpenCode CLI binary).

### Solid.js
Reactive JavaScript framework used for the frontend. Version 1.9.10.

### SSE (Server-Sent Events)
HTTP-based protocol for server-to-client streaming, used for real-time updates.

### Store (Solid.js)
Reactive object container allowing nested updates via path syntax.

---

## T

### Tauri
Framework for building native desktop apps with web technologies. Uses Rust backend. Version 2.

### Tool
A capability the AI can execute (e.g., BashTool, ReadTool, EditTool).

### Tool Registry
System for discovering and registering tools from built-ins, plugins, and user directories.

### Turborepo
Monorepo build system for managing multiple packages. Handles task dependencies and caching.

---

## V

### Vite
Frontend build tool and dev server. Version 7.1.4.

---

## W

### Workspace
A project directory being worked on. Has its own configuration and state.

### Worktree
Git worktree path, used for managing multiple working directories.

---

## Z

### Zod
TypeScript-first schema validation library used throughout for type-safe validation.

---

## Common Abbreviations

| Abbreviation | Meaning |
|--------------|---------|
| API | Application Programming Interface |
| CLI | Command Line Interface |
| CSS | Cascading Style Sheets |
| DOM | Document Object Model |
| HMR | Hot Module Replacement |
| IPC | Inter-Process Communication |
| JSON | JavaScript Object Notation |
| JWT | JSON Web Token |
| LLM | Large Language Model |
| NPM | Node Package Manager |
| OAuth | Open Authorization |
| ORM | Object-Relational Mapping |
| PKCE | Proof Key for Code Exchange |
| PR | Pull Request |
| REST | Representational State Transfer |
| SDK | Software Development Kit |
| SSH | Secure Shell |
| TCP | Transmission Control Protocol |
| TS | TypeScript |
| UI | User Interface |
| URI | Uniform Resource Identifier |
| URL | Uniform Resource Locator |
| UUID | Universally Unique Identifier |
| WS | WebSocket |

---

## File Extensions

| Extension | Type |
|-----------|------|
| `.tsx` | TypeScript with JSX (Solid.js components) |
| `.ts` | TypeScript |
| `.rs` | Rust source code |
| `.toml` | TOML configuration (Cargo, Bun) |
| `.jsonc` | JSON with comments (configuration) |
| `.css` | Stylesheet |
| `.yml` | YAML (GitHub Actions) |
