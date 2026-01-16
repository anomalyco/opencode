# OpenWork Agent Guide

This guide helps AI agents get started working on the OpenWork codebase effectively.

## Getting Started

Before making changes, **read the documentation** to understand the codebase:

| Document | When to Read |
|----------|--------------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Understanding project structure, packages, data flow |
| [docs/CODE_CONVENTIONS.md](docs/CODE_CONVENTIONS.md) | File naming, imports, TypeScript patterns, styling |
| [docs/COMPONENT_PATTERNS.md](docs/COMPONENT_PATTERNS.md) | Solid.js components, contexts, state management |
| [docs/SDK_API.md](docs/SDK_API.md) | SDK structure, REST API, providers, MCP integration |
| [docs/TAURI_BACKEND.md](docs/TAURI_BACKEND.md) | Rust backend commands, plugins, async patterns |
| [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md) | Local dev setup, prerequisites |
| [docs/TESTING.md](docs/TESTING.md) | Testing patterns for TypeScript and Rust |
| [docs/PLUGIN_DEVELOPMENT.md](docs/PLUGIN_DEVELOPMENT.md) | Creating custom plugins and tools |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Key terms and abbreviations |

## Quick Reference

- **Default branch:** `dev`
- **Package manager:** Bun 1.3.5+
- **Frontend:** Solid.js 1.9.10, Tailwind CSS 4.1.11
- **Backend:** Tauri v2 (Rust 2024 Edition)
- **Type checking:** `bun run typecheck`

## Common Commands

```bash
# Run OpenCode CLI in dev mode
bun run dev

# Run desktop app
cd packages/desktop && bun run tauri dev

# Regenerate JavaScript SDK
./packages/sdk/js/script/build.ts

# Run tests
bun test                    # TypeScript tests
cargo test                  # Rust tests
```

## Key Principles

1. **ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE** - maximize efficiency
2. **Read before editing** - understand existing code before modifying
3. **Follow conventions** - use kebab-case files, path aliases, existing patterns
4. **Keep changes focused** - avoid over-engineering or unnecessary refactoring

## Desktop App Verification (MCP)

When editing the desktop app (`packages/desktop`), you MUST verify your changes visually using the tauri-plugin-mcp:

1. **Start the desktop app in dev mode:**
   ```bash
   cd packages/desktop && bun run tauri dev
   ```

2. **Wait for the MCP socket** to be created at `/tmp/tauri-mcp.sock`

3. **Capture a screenshot** to verify your changes:
   ```javascript
   // Save this as a temp script and run with node
   const net = require('net');
   const fs = require('fs');

   const client = net.createConnection({ path: '/private/tmp/tauri-mcp.sock' }, () => {
     const request = JSON.stringify({
       command: 'take_screenshot',
       payload: { window_label: 'main', quality: 80 }
     }) + '\n';
     client.write(request);
   });

   let buffer = '';
   client.on('data', (data) => {
     buffer += data.toString();
     const newlineIndex = buffer.indexOf('\n');
     if (newlineIndex !== -1) {
       const response = JSON.parse(buffer.substring(0, newlineIndex));
       if (response.success && response.data?.data) {
         const base64Data = response.data.data.replace(/^data:image\/\w+;base64,/, '');
         fs.writeFileSync('/tmp/tauri_screenshot.jpg', Buffer.from(base64Data, 'base64'));
         console.log('Screenshot saved to /tmp/tauri_screenshot.jpg');
       }
       client.end();
     }
   });
   ```

4. **Read the screenshot** using the Read tool to visually verify the UI changes.

The MCP plugin is only active in debug builds and provides:
- Screenshot capture
- DOM access
- Mouse/keyboard input simulation
- localStorage management
- JavaScript execution in app context
