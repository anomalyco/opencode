# OpenWork Developer Documentation

Welcome to the OpenWork developer documentation. This directory contains comprehensive guides for understanding and contributing to the codebase.

## Quick Links

### Getting Started
| Document | Description |
|----------|-------------|
| [Development Setup](./DEVELOPMENT_SETUP.md) | Set up your local development environment |
| [Architecture Overview](./ARCHITECTURE.md) | Understand the project structure and data flow |
| [Code Conventions](./CODE_CONVENTIONS.md) | Learn the coding standards and patterns |

### Deep Dives
| Document | Description |
|----------|-------------|
| [Component Patterns](./COMPONENT_PATTERNS.md) | Solid.js component and context patterns |
| [SDK/API Documentation](./SDK_API.md) | SDK architecture, REST endpoints, integrations |
| [Tauri Backend](./TAURI_BACKEND.md) | Rust backend and MCP plugin patterns |
| [Plugin Development](./PLUGIN_DEVELOPMENT.md) | Create custom plugins and tools |

### Operations
| Document | Description |
|----------|-------------|
| [Testing Guide](./TESTING.md) | Testing patterns and strategies |
| [CI/CD Pipeline](./CI_CD.md) | Continuous integration and deployment |

### Reference
| Document | Description |
|----------|-------------|
| [Glossary](./GLOSSARY.md) | Key terms, concepts, and abbreviations |

---

## Documentation Overview

### [ARCHITECTURE.md](./ARCHITECTURE.md)
Comprehensive overview of the codebase including:
- Project structure and monorepo organization
- Technology stack (Solid.js, Tauri, Rust, TypeScript)
- Package architecture (app, desktop, ui, sdk, opencode, plugin)
- Data flow diagrams
- Key concepts (Sessions, MCP, Providers, Tools)
- Console packages for enterprise features

### [CODE_CONVENTIONS.md](./CODE_CONVENTIONS.md)
Coding standards including:
- File naming conventions (kebab-case)
- Import organization and path aliases
- TypeScript patterns (interfaces, types, generics)
- State management patterns
- Tailwind CSS styling conventions
- Error handling patterns

### [COMPONENT_PATTERNS.md](./COMPONENT_PATTERNS.md)
Solid.js specific patterns:
- Component structure and props
- Context/Provider pattern with `createSimpleContext`
- State patterns (createSignal, createStore, persisted)
- Reactivity patterns (createMemo, createEffect)
- Component communication
- Performance optimization

### [SDK_API.md](./SDK_API.md)
SDK and API documentation:
- SDK package structure
- Client initialization patterns
- API generation from OpenAPI
- REST endpoint reference
- Event streaming (SSE)
- Provider integration (18+ AI providers)
- MCP integration
- Tool system architecture

### [TAURI_BACKEND.md](./TAURI_BACKEND.md)
Rust backend documentation:
- Desktop backend structure
- MCP plugin architecture
- Tauri command patterns
- Error handling in Rust
- Async patterns with Tokio
- State management
- Platform-specific code (macOS, Windows, Linux)

### [DEVELOPMENT_SETUP.md](./DEVELOPMENT_SETUP.md)
Local development guide:
- Prerequisites (Bun, Rust, Node.js)
- Platform-specific setup
- Development workflows
- Package-specific setup
- Environment variables
- IDE configuration
- Troubleshooting

### [TESTING.md](./TESTING.md)
Testing documentation:
- Bun test runner usage
- Testing patterns (arrange-act-assert)
- Solid.js component testing
- Context and store testing
- Rust testing with Cargo
- Best practices

### [CI_CD.md](./CI_CD.md)
CI/CD pipeline documentation:
- GitHub Actions workflow overview
- Core workflows (test, publish, deploy)
- Release process
- Multi-platform builds
- Secrets management
- Troubleshooting

### [PLUGIN_DEVELOPMENT.md](./PLUGIN_DEVELOPMENT.md)
Plugin development guide:
- Plugin architecture
- Available hooks
- Tool development
- Authentication plugins
- Distribution methods
- Example implementations

---

## Contributing to Documentation

When adding or updating documentation:

1. **Keep it current** - Update docs when making code changes
2. **Use examples** - Include code samples where helpful
3. **Be concise** - Focus on what developers need to know
4. **Cross-reference** - Link to related documentation
5. **Test code samples** - Ensure examples actually work

---

## Need Help?

- Check [CLAUDE.md](../CLAUDE.md) for quick reference guidelines
- Review [specs/](../specs/) for feature specifications
- Open an issue for documentation improvements
