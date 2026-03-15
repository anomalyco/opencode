# OpenCode Codebase Map

**Last Updated:** March 2025  
**Purpose:** Complete architectural reference and file organization guide

## Project Overview

OpenCode is a **sophisticated AI-powered development platform** with the following characteristics:

- **Monorepo Type:** Bun workspaces with Turbo build orchestration
- **Package Manager:** Bun 1.3.10 (exact dependency pinning)
- **Primary Language:** TypeScript 5.8.2 + JavaScript (ES2022+)
- **Version:** 1.2.26 (monorepo-wide synchronization)

## Quick Reference

### 19 Monorepo Packages

**Core:** @opencode-ai/opencode, @opencode-ai/app, @opencode-ai/ui, @opencode-ai/sdk
**Desktop:** @opencode-ai/desktop, @opencode-ai/desktop-electron
**Console:** @opencode-ai/console-{core,app,function,mail,resource}
**Enterprise:** @opencode-ai/enterprise
**Integrations:** @opencode-ai/plugin, @opencode-ai/util, @opencode-ai/script, @opencode-ai/slack
**Docs/Dev:** @opencode-ai/docs, @opencode-ai/storybook

### Key Technologies

- **Frontend:** SolidJS, Tailwind CSS, Kobalte primitives
- **Backend:** Hono, Effect, Drizzle ORM
- **Database:** SQLite (dev), PlanetScale MySQL (prod)
- **Deployment:** Cloudflare Workers, AWS (SST), Electron, Tauri, Node.js
- **Testing:** Bun test, Playwright, HappyDOM
- **Build:** Turbo, Vite, SST

## Architecture Layers

```
Layer 1: Core (@opencode-ai/opencode)
  └─ HTTP Server, Sessions, Messages, Tools, Providers
  
Layer 2: API & Types (@opencode-ai/sdk)
  └─ Generated OpenAPI client/server types
  
Layer 3: UI Components (@opencode-ai/ui)
  └─ SolidJS components, Tailwind, accessible primitives
  
Layer 4: Applications
  ├─ Web (@opencode-ai/app)
  ├─ Desktop (Tauri, Electron)
  └─ Console (@opencode-ai/console-*)
  
Layer 5: Infrastructure (infra/, SST configs)
```

## Documentation Reference

- **CODEMAP.md** (this file) - Project layout and structure
- **ENTITY_DEFINITIONS.md** - Types, interfaces, data structures  
- **LOGICAL_FLOWS.md** - Request handling, state management, lifecycles
- **DEVELOPMENT_STANDARDS.md** - Code patterns, naming, conventions

## Getting Started

1. Read CODEMAP.md (structure overview)
2. Study ENTITY_DEFINITIONS.md (type system)
3. Review LOGICAL_FLOWS.md (how things work together)
4. Follow DEVELOPMENT_STANDARDS.md (patterns to use)
5. Use opencode-dev-ops skill for development governance

For detailed section-by-section breakdown, see full CODEMAP.md in docs/reference/
