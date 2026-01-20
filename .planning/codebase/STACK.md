# Technology Stack

**Analysis Date:** 2026-01-19

## Languages

**Primary:**
- TypeScript 5.8.2 - All packages, CLI, web apps, desktop frontend
- Rust (2024 edition) - Desktop app native backend via Tauri

**Secondary:**
- JavaScript - Some config files, build scripts
- CSS/TailwindCSS 4.x - Styling across all UI packages

## Runtime

**Environment:**
- Bun 1.3.5 - Primary runtime and package manager
- Node.js 22+ - Required for some packages (enterprise, console)

**Package Manager:**
- Bun with workspaces
- Lockfile: `bun.lock` (present)
- Configuration: `bunfig.toml`

## Frameworks

**Core:**
- SolidJS 1.9.10 - Reactive UI framework for all frontend packages
- Hono 4.10.7 - HTTP server framework for API endpoints and workers
- Astro 5.7.x - Static site generator for docs (`packages/web`)
- Tauri 2.x - Desktop app framework (Rust + web view)

**Testing:**
- Bun Test - Native test runner (`bun test`)

**Build/Dev:**
- Vite 7.1.4 - Build tool for all web packages
- TurboBuild 2.5.6 - Monorepo build orchestration
- SST 3.17.23 - Infrastructure as code / deployment framework

## Key Dependencies

**AI/LLM Integration:**
- `ai` 5.0.119 (Vercel AI SDK) - Unified AI model interface
- `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, etc. - Provider SDKs
- `@modelcontextprotocol/sdk` 1.25.2 - MCP client for tool integration
- `@openrouter/ai-sdk-provider` - OpenRouter integration

**UI Framework:**
- `@kobalte/core` 0.13.11 - Headless UI components for SolidJS
- `@solidjs/router` 0.15.4 - Client-side routing
- `@solidjs/start` - SSR/SSG framework
- `@opentui/core`, `@opentui/solid` 0.1.74 - TUI rendering

**Data/Validation:**
- `zod` 4.1.8 - Schema validation throughout codebase
- `drizzle-orm` 0.41.0 - Type-safe ORM for database access
- `remeda` 2.26.0 - Functional utilities

**Desktop (Tauri):**
- `@tauri-apps/api` v2 - IPC and native APIs
- `tauri-plugin-*` (dialog, shell, updater, store, etc.) - Native functionality

**Code Analysis:**
- `web-tree-sitter` 0.25.10, `tree-sitter-bash` - AST parsing
- `shiki` 3.20.0 - Syntax highlighting
- `marked` 17.0.1 - Markdown parsing

**Payments:**
- `stripe` 18.0.0 - Payment processing SDK
- `@stripe/stripe-js` 8.6.1 - Client-side Stripe

**GitHub Integration:**
- `@octokit/rest` 22.0.0 - GitHub REST API
- `@octokit/graphql` 9.0.2 - GitHub GraphQL API
- `@octokit/auth-app` 8.0.1 - GitHub App authentication

## Configuration

**Environment:**
- Environment variables via `process.env`
- SST secrets for production (`sst.Secret`)
- `.env` files for local development
- Config file: `opencode.json` or `opencode.jsonc`

**Build:**
- `tsconfig.json` - Extends `@tsconfig/bun`
- `turbo.json` - Turborepo task definitions
- `vite.config.ts` - Per-package Vite configs

**Key Environment Variables:**
- AI Provider keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.
- AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
- GitHub: `GITHUB_TOKEN`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`
- Cloudflare: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`
- Slack: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`

## Platform Requirements

**Development:**
- macOS, Linux, or Windows
- Bun 1.3.5+
- Rust toolchain (for desktop development)
- Node.js 22+ (for some packages)

**Production:**
- Cloudflare Workers (API, auth, console)
- Cloudflare R2 (file storage)
- PlanetScale (MySQL database)
- Tauri builds for macOS/Windows/Linux desktop

## Workspace Structure

**Monorepo Packages:**
- `packages/opencode` - CLI tool and core agent logic
- `packages/app` - Web UI application
- `packages/desktop` - Tauri desktop wrapper
- `packages/web` - Astro documentation site
- `packages/ui` - Shared UI components
- `packages/sdk/js` - JavaScript SDK for API
- `packages/enterprise` - Enterprise/Teams features
- `packages/console/*` - Admin console (app, core, function, mail, resource)
- `packages/slack` - Slack bot integration
- `packages/plugin` - Plugin system
- `packages/util` - Shared utilities

---

*Stack analysis: 2026-01-19*
