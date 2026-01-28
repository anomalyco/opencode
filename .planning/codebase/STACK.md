# Technology Stack

**Analysis Date:** 2026-01-27

## Languages

**Primary:**

- TypeScript 5.8.2 - All packages, CLI, web apps, desktop frontend
- Rust (2024 edition) - Desktop app native backend via Tauri

**Secondary:**

- JavaScript - Some config files, build scripts
- CSS/TailwindCSS 4.1.11 - Styling across all UI packages

## Runtime

**Environment:**

- Bun 1.3.5 - Primary runtime and package manager (specified in `package.json`)
- Node.js 22+ - Required for some packages (enterprise, console)

**Package Manager:**

- Bun with workspaces
- Lockfile: `bun.lock` (present)
- Configuration: Catalog-based dependency management in root `package.json`

## Frameworks

**Core:**

- SolidJS 1.9.10 - Reactive UI framework for all frontend packages
- Hono 4.10.7 - HTTP server framework for API endpoints and workers
- Astro 5.7.x - Static site generator for docs (`packages/web`)
- Tauri 2.x - Desktop app framework (Rust + web view)

**Testing:**

- Bun Test - Native test runner (`bun test`)
- Test files: `packages/opencode/test/**/*.test.ts`

**Build/Dev:**

- Vite 7.1.4 - Build tool for all web packages
- TurboBuild 2.5.6 - Monorepo build orchestration
- SST 3.17.23 - Infrastructure as code / deployment framework
- TypeScript Native Preview 7.0.0-dev.20251207.1 - Experimental TypeScript compiler

## Key Dependencies

**AI/LLM Integration:**

- `ai` 5.0.119 (Vercel AI SDK) - Unified AI model interface
- `@ai-sdk/anthropic` 2.0.57 - Anthropic Claude provider
- `@ai-sdk/openai` 2.0.89 - OpenAI provider
- `@ai-sdk/google` 2.0.52 - Google Gemini provider
- `@ai-sdk/google-vertex` 3.0.97 - Google Vertex AI provider
- `@ai-sdk/amazon-bedrock` 3.0.73 - AWS Bedrock provider
- `@ai-sdk/azure` 2.0.91 - Azure OpenAI provider
- `@ai-sdk/groq` 2.0.34 - Groq provider
- `@ai-sdk/mistral` 2.0.27 - Mistral provider
- `@ai-sdk/xai` 2.0.51 - xAI/Grok provider
- `@ai-sdk/deepinfra` 1.0.31 - DeepInfra provider
- `@ai-sdk/cerebras` 1.0.34 - Cerebras provider
- `@ai-sdk/cohere` 2.0.22 - Cohere provider
- `@ai-sdk/togetherai` 1.0.31 - TogetherAI provider
- `@ai-sdk/perplexity` 2.0.23 - Perplexity provider
- `@ai-sdk/vercel` 1.0.31 - Vercel AI Gateway provider
- `@ai-sdk/gateway` 2.0.25 - Gateway provider
- `@ai-sdk/openai-compatible` 1.0.30 - OpenAI-compatible API provider
- `@openrouter/ai-sdk-provider` 1.5.2 - OpenRouter integration
- `@gitlab/gitlab-ai-provider` 3.1.1 - GitLab AI provider
- `@modelcontextprotocol/sdk` 1.25.2 - MCP client for tool integration
- `@agentclientprotocol/sdk` 0.5.1 - Agent Client Protocol SDK

**UI Framework:**

- `@kobalte/core` 0.13.11 - Headless UI components for SolidJS
- `@solidjs/router` 0.15.4 - Client-side routing
- `@solidjs/start` - SSR/SSG framework (custom build from PR)
- `@solidjs/meta` 0.29.4 - Meta tags management
- `@opentui/core` 0.1.74, `@opentui/solid` 0.1.74 - TUI rendering
- `virtua` 0.42.3 - Virtual scrolling
- `solid-list` 0.3.0 - List components

**Data/Validation:**

- `zod` 4.1.8 - Schema validation throughout codebase
- `drizzle-orm` 0.41.0 - Type-safe ORM for database access
- `@planetscale/database` 1.19.0 - PlanetScale database client
- `remeda` 2.26.0 - Functional utilities
- `ulid` 3.0.1 - ULID generation

**Desktop (Tauri):**

- `@tauri-apps/api` v2 - IPC and native APIs
- `tauri-plugin-*` (dialog, shell, updater, store, etc.) - Native functionality

**Code Analysis:**

- `web-tree-sitter` 0.25.10, `tree-sitter-bash` 0.25.0 - AST parsing
- `shiki` 3.20.0 - Syntax highlighting
- `marked` 17.0.1 - Markdown parsing
- `marked-shiki` 1.2.1 - Markdown with syntax highlighting
- `diff` 8.0.2 - Diff utilities
- `@pierre/diffs` 1.0.2 - Diff rendering

**Payments:**

- `stripe` 18.0.0 - Payment processing SDK
- `@stripe/stripe-js` 8.6.1 - Client-side Stripe

**GitHub Integration:**

- `@octokit/rest` 22.0.0 - GitHub REST API
- `@octokit/graphql` 9.0.2 - GitHub GraphQL API
- `@octokit/auth-app` 8.0.1 - GitHub App authentication
- `@octokit/webhooks-types` 7.6.1 - GitHub webhook types
- `@actions/core` 1.11.1, `@actions/github` 6.0.1 - GitHub Actions SDK

**Authentication:**

- `@openauthjs/openauth` 0.0.0-20250322224806 - OAuth 2.0 issuer
- `jose` 6.1.3 - JWT handling

**HTTP/Server:**

- `hono` 4.10.7 - Web framework
- `hono-openapi` 1.1.2 - OpenAPI integration
- `hono-rate-limiter` 0.5.3 - Rate limiting middleware
- `@hono/zod-validator` 0.4.2 - Zod validation for Hono
- `@hono/standard-validator` 0.1.5 - Standard validator

**File System:**

- `@parcel/watcher` 2.5.1 - File watching
- `chokidar` 4.0.3 - File watching (fallback)
- `@zip.js/zip.js` 2.7.62 - ZIP file handling

**Utilities:**

- `luxon` 3.6.1 - Date/time handling
- `fuzzysort` 3.1.0 - Fuzzy search
- `qrcode` 1.5.4 - QR code generation
- `clipboardy` 4.0.0 - Clipboard access
- `bonjour-service` 1.3.0 - mDNS service discovery
- `bun-pty` 0.4.4 - PTY terminal emulation
- `yargs` 18.0.0 - CLI argument parsing
- `@clack/prompts` 1.0.0-alpha.1 - CLI prompts

**Storage:**

- `aws4fetch` 1.0.20 - AWS signature v4 for fetch
- `@aws-sdk/client-s3` 3.933.0 - AWS S3 client
- `@aws-sdk/client-sts` 3.782.0 - AWS STS client

**Email:**

- `@jsx-email/render` 1.1.1 - JSX email rendering

**SolidJS Primitives:**

- `@solid-primitives/storage` 4.3.3 - LocalStorage/sessionStorage
- `@solid-primitives/event-bus` 1.1.2 - Event bus
- `@solid-primitives/scheduled` 1.5.2 - Scheduled tasks
- `@solid-primitives/active-element` 2.1.3 - Active element tracking
- `@solid-primitives/audio` 1.4.2 - Audio utilities
- `@solid-primitives/media` 2.3.3 - Media queries
- `@solid-primitives/resize-observer` 2.1.3 - Resize observer
- `@solid-primitives/scroll` 2.1.3 - Scroll utilities
- `@solid-primitives/websocket` 1.3.1 - WebSocket client

**Other:**

- `vscode-jsonrpc` 8.2.1 - Language Server Protocol client
- `vscode-languageserver-types` 3.17.5 - LSP types
- `ghostty-web` 0.3.0 - Terminal emulator (patched)
- `dompurify` 3.3.1 - HTML sanitization
- `gray-matter` 4.0.3 - Front matter parsing
- `turndown` 7.2.0 - HTML to Markdown
- `jsonc-parser` 3.3.1 - JSONC parsing
- `minimatch` 10.0.3 - Glob matching
- `ignore` 7.0.5 - .gitignore parsing
- `partial-json` 0.1.7 - Partial JSON parsing
- `decimal.js` 10.5.0 - Decimal arithmetic
- `strip-ansi` 7.1.2 - ANSI stripping
- `xdg-basedir` 5.1.0 - XDG directories

## Configuration

**Environment:**

- Environment variables via `process.env`
- SST secrets for production (`sst.Secret`)
- `.env` files for local development
- Config file: `opencode.json` or `opencode.jsonc` (stored in `~/.opencode/config.json`)

**Build:**

- `tsconfig.json` - Extends `@tsconfig/bun`
- `turbo.json` - Turborepo task definitions
- `vite.config.ts` - Per-package Vite configs
- `eslint.config.js` - ESLint configuration (in some packages)

**Key Environment Variables:**

- AI Provider keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `AWS_BEARER_TOKEN_BEDROCK`, etc.
- AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`
- GitHub: `GITHUB_TOKEN`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_CLIENT_ID_CONSOLE`, `GITHUB_CLIENT_SECRET_CONSOLE`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`
- Cloudflare: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID`
- Storage: `OPENCODE_STORAGE_ADAPTER`, `OPENCODE_STORAGE_BUCKET`, `OPENCODE_STORAGE_REGION`, `OPENCODE_STORAGE_ACCESS_KEY_ID`, `OPENCODE_STORAGE_SECRET_ACCESS_KEY`, `OPENCODE_STORAGE_ACCOUNT_ID`
- Slack: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`
- Email: `EMAILOCTOPUS_API_KEY`
- Monitoring: `HONEYCOMB_API_KEY`
- Google OAuth: `GOOGLE_CLIENT_ID`

## Platform Requirements

**Development:**

- macOS, Linux, or Windows
- Bun 1.3.5+ (exact version required)
- Rust toolchain (for desktop development)
- Node.js 22+ (for some packages)

**Production:**

- Cloudflare Workers (API, auth, console)
- Cloudflare R2 (file storage)
- Cloudflare KV (key-value storage)
- Cloudflare Durable Objects (real-time sync)
- PlanetScale (MySQL database)
- Tauri builds for macOS/Windows/Linux desktop

## Workspace Structure

**Monorepo Packages:**

- `packages/opencode` - CLI tool and core agent logic
- `packages/app` - Web UI application (SolidJS + Vite)
- `packages/desktop` - Tauri desktop wrapper
- `packages/web` - Astro documentation site
- `packages/ui` - Shared UI components
- `packages/sdk/js` - JavaScript SDK for API
- `packages/enterprise` - Enterprise/Teams features
- `packages/console/*` - Admin console (app, core, function, mail, resource)
- `packages/slack` - Slack bot integration
- `packages/plugin` - Plugin system
- `packages/util` - Shared utilities
- `packages/function` - Cloudflare Worker functions
- `packages/script` - Build scripts and utilities

**Infrastructure:**

- `infra/app.ts` - API worker and static sites
- `infra/console.ts` - Console, auth, database, Stripe
- `infra/enterprise.ts` - Enterprise/Teams infrastructure
- `sst.config.ts` - Main SST configuration

**CI/CD:**

- GitHub Actions workflows in `.github/workflows/`
- SST deployment orchestration
- TurboBuild for monorepo builds

---

_Stack analysis: 2026-01-27_
