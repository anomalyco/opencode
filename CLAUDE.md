# openwork Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-01-14

## Active Technologies
- TypeScript 5.8.2 / Rust 2024 Edition (Tauri backend) + Solid.js 1.9.10, Tailwind CSS 4.1.11, @kobalte/core 0.13.11, Vite 7.1.4, Marked (markdown parsing), DOMPurify (HTML sanitization) (002-file-preview-viewer)
- File system via SDK (`sdk.client.file.read()`) (002-file-preview-viewer)
- TypeScript 5.8.2 (frontend), Rust 2024 Edition (Tauri backend) + Solid.js 1.9.10, Tailwind CSS 4.1.11, @kobalte/core 0.13.11, Vite 7.1.4 (003-file-activity-highlight)
- In-memory Solid.js store (session-scoped, no persistence required) (003-file-activity-highlight)
- TypeScript 5.8.2 (frontend), Rust 2024 Edition (Tauri backend) + Solid.js 1.9.10, @kobalte/core 0.13.11, Tailwind CSS 4.1.11, Vite 7.1.4, @tauri-apps/plugin-store (persistence), @solidjs/router (routing) (004-mcp-connectors)
- File system (`.mcp.json` in workspace root), @tauri-apps/plugin-store for UI state persistence (004-mcp-connectors)
- TypeScript 5.8.2 (frontend), Rust 2024 Edition (Tauri backend) + Solid.js 1.9.10, @kobalte/core 0.13.11, Tailwind CSS 4.1.11, Vite 7.1.4, @tauri-apps/api (filesystem), Zod (validation) (006-fix-mcp-api-alignment)

- TypeScript 5.8.2 / Rust 2024 Edition (Tauri backend) + Solid.js 1.9.10, Tailwind CSS 4.1.11, @kobalte/core 0.13.11, Vite 7.1.4 (001-workspace-files-sidebar)

## Project Structure

```text
src/
tests/
```

## Commands

cargo test [ONLY COMMANDS FOR ACTIVE TECHNOLOGIES][ONLY COMMANDS FOR ACTIVE TECHNOLOGIES] cargo clippy

## Code Style

TypeScript 5.8.2 / Rust 2024 Edition (Tauri backend): Follow standard conventions

## Recent Changes
- 006-fix-mcp-api-alignment: Added TypeScript 5.8.2 (frontend), Rust 2024 Edition (Tauri backend) + Solid.js 1.9.10, @kobalte/core 0.13.11, Tailwind CSS 4.1.11, Vite 7.1.4, @tauri-apps/api (filesystem), Zod (validation)
- 004-mcp-connectors: Added TypeScript 5.8.2 (frontend), Rust 2024 Edition (Tauri backend) + Solid.js 1.9.10, @kobalte/core 0.13.11, Tailwind CSS 4.1.11, Vite 7.1.4, @tauri-apps/plugin-store (persistence), @solidjs/router (routing)
- 003-file-activity-highlight: Added TypeScript 5.8.2 (frontend), Rust 2024 Edition (Tauri backend) + Solid.js 1.9.10, Tailwind CSS 4.1.11, @kobalte/core 0.13.11, Vite 7.1.4


<!-- MANUAL ADDITIONS START -->

## Developer Documentation

For comprehensive documentation on the codebase architecture and patterns, see the `/docs` directory:

### Architecture & Structure
- [Architecture Overview](docs/ARCHITECTURE.md) - Project structure, packages, and data flow
- [Code Conventions](docs/CODE_CONVENTIONS.md) - Naming, imports, TypeScript, and styling patterns
- [Component Patterns](docs/COMPONENT_PATTERNS.md) - Solid.js component and context patterns

### Technical Deep-Dives
- [SDK/API Documentation](docs/SDK_API.md) - SDK architecture, endpoints, and integrations
- [Tauri Backend](docs/TAURI_BACKEND.md) - Rust backend and MCP plugin patterns
- [Plugin Development](docs/PLUGIN_DEVELOPMENT.md) - Creating custom plugins and tools

### Getting Started
- [Development Setup](docs/DEVELOPMENT_SETUP.md) - Local development environment setup
- [Testing Guide](docs/TESTING.md) - Testing patterns and strategies
- [CI/CD Pipeline](docs/CI_CD.md) - Continuous integration and deployment

## Tauri MCP Limitations

**Important:** The `tauri-mcp` MCP server has a known bug where most interactive tools timeout and don't work properly. Only `take_screenshot` works reliably. Other tools like `execute_js`, `get_dom`, `manage_local_storage`, `get_element_position`, `send_text_to_element`, etc. will timeout.

**Workaround:** If you need to interact with the Tauri app (click buttons, enter text, inspect elements, etc.), ask the user to perform the action manually. You can still use `take_screenshot` to verify the current state of the app.

<!-- MANUAL ADDITIONS END -->
