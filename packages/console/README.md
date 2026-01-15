# OpenCode Console

> Multi-layered platform for OpenCode: web console, Tauri desktop app, backend core, and serverless functions.

## Overview

The `packages/console` package is a monorepo-style collection of related packages that power the OpenCode console platform:

| Package | Description |
|---------|-------------|
| `app/` | SolidStart web application - main web frontend |
| `core/` | Backend core - database, business logic, domain modules |
| `function/` | Cloudflare Workers - serverless functions |
| `mail/` | Email templates using JSX Email |
| `resource/` | SST resource configuration |
| `src/` + `src-tauri/` | Tauri desktop app - "Build Studio" |

## Project Structure

```
packages/console/
├── app/                      # SolidStart Web Application
│   ├── src/
│   │   ├── routes/           # Page routes (auth, workspace, download, etc.)
│   │   ├── context/          # Auth context providers
│   │   ├── component/        # Shared UI components
│   │   ├── asset/            # Images, SVGs, brand assets
│   │   └── style/            # Global CSS styles
│   ├── public/               # Static assets (favicon, manifest, etc.)
│   ├── script/
│   │   └── generate-sitemap.ts
│   └── vite.config.ts
│
├── core/                     # Backend Core (Database + Business Logic)
│   ├── src/
│   │   ├── account.ts        # Account management
│   │   ├── actor.ts          # Actor pattern for auth context
│   │   ├── billing.ts        # Billing & subscription logic
│   │   ├── black.ts          # Black tier features
│   │   ├── key.ts            # API key management
│   │   ├── model.ts          # AI model configuration
│   │   ├── provider.ts       # Provider management
│   │   ├── user.ts           # User management
│   │   ├── workspace.ts      # Workspace management
│   │   ├── drizzle/          # Database client & types
│   │   ├── schema/           # Drizzle ORM table definitions
│   │   └── util/             # Utility functions
│   ├── migrations/           # SQL migration files (53+ migrations)
│   ├── script/               # Admin scripts (see below)
│   └── drizzle.config.ts
│
├── function/                 # Cloudflare Workers
│   └── src/
│       ├── auth.ts           # OpenAuth authentication handler
│       └── log-processor.ts  # Honeycomb metrics processor
│
├── mail/                     # Email Templates (JSX Email)
│   └── emails/
│       ├── templates/
│       │   ├── InviteEmail.tsx
│       │   └── static/       # Fonts, images for emails
│       ├── components.tsx    # Shared email components
│       └── styles.ts         # Email styles
│
├── resource/                 # SST Resource Configuration
│   ├── resource.cloudflare.ts  # Cloudflare environment
│   └── resource.node.ts        # Node.js environment
│
├── scripts/                  # Console Dev Scripts
│   ├── predev.ts             # Pre-dev setup hook
│   └── verify-setup.ts       # Validates file structure
│
├── src/                      # Tauri Desktop App (Build Studio) - React
│   ├── main.tsx              # Entry point
│   ├── App.tsx               # Main application component
│   ├── components/           # React UI components
│   │   ├── index.ts          # Barrel exports
│   │   ├── ChatPanel.tsx     # AI chat interface
│   │   ├── WorkspacePanel.tsx # Workspace tabs (Preview/Code)
│   │   ├── PreviewTab.tsx    # Dev server preview with iframe
│   │   ├── CodeTab.tsx       # File tree + code editor
│   │   ├── FileTree.tsx      # File explorer
│   │   ├── ActionsBar.tsx    # Deploy/Export/Copy actions
│   │   ├── DeployDialog.tsx  # Deployment configuration
│   │   ├── ProviderSelector.tsx # AI model selection
│   │   ├── WorkspaceDropdown.tsx # Workspace switcher
│   │   └── ResizableSplitter.tsx # Resizable panel divider
│   ├── hooks/                # React hooks
│   │   ├── index.ts          # Barrel exports
│   │   ├── useSession.ts     # OpenCode session management
│   │   ├── useProviders.ts   # AI provider/model fetching
│   │   ├── useFileTree.ts    # File tree state
│   │   ├── useOpenFiles.ts   # Open file tabs
│   │   ├── useCodeMirror.ts  # CodeMirror editor integration
│   │   ├── useDeploy.ts      # Deployment workflow
│   │   ├── useSplitPane.ts   # Resizable panel logic
│   │   └── useWorkspaceHistory.ts # Recent workspaces
│   ├── lib/                  # Client utilities
│   │   ├── index.ts          # Barrel exports
│   │   ├── opencode-client.ts # OpenCode Server API client
│   │   └── af-client.ts      # Agent Foundry backend client
│   └── types/                # TypeScript types
│       ├── index.ts          # Barrel exports
│       ├── workspace.ts      # Workspace data models
│       ├── deploy.ts         # Deployment types
│       ├── fs.ts             # File system types
│       └── provider.ts       # Provider types
│
└── src-tauri/                # Tauri Rust Backend
    ├── src/
    │   ├── main.rs           # Rust entry point
    │   ├── workspace_runner.rs # Dev server process management
    │   ├── file_ops.rs       # File system operations
    │   ├── deploy.rs         # Deployment commands
    │   └── lib.rs            # Library exports
    ├── icons/                # App icons
    ├── Cargo.toml            # Rust dependencies
    └── tauri.conf.json       # Tauri configuration
```

## Core Scripts

Admin scripts located in `core/script/`:

| Script | Purpose |
|--------|---------|
| `credit-workspace.ts` | Add credits to a workspace |
| `lookup-user.ts` | Find user by email/ID |
| `onboard-zen-black.ts` | Onboard new Zen Black users |
| `promote-black.ts` | Promote user to Black tier |
| `remove-black.ts` | Remove Black tier from user |
| `promote-models.ts` | Promote models to dev/prod |
| `pull-models.ts` | Pull model configs from stage |
| `update-models.ts` | Update model configurations |
| `update-black.ts` | Update Black tier settings |
| `reset-db.ts` | Reset database (danger!) |

Usage:
```bash
# Run with SST shell for environment
bun run --cwd packages/console/core shell-dev script/lookup-user.ts user@example.com
```

## Quick Start

### Prerequisites

- **Bun** 1.3+ ([install](https://bun.sh))
- **Rust** 1.70+ ([install](https://rustup.rs)) - for Tauri desktop app
- **Node.js** 18+ (for some tooling)

### Install Dependencies

```bash
# From project root
bun install

# Or install console package only
cd packages/console
bun install
```

### Development

#### Web App (SolidStart)

```bash
# Start dev server
bun run --cwd packages/console/app dev

# With remote auth (for testing against dev environment)
bun run --cwd packages/console/app dev:remote
```

#### Tauri Desktop App (Build Studio)

```bash
# Start Tauri dev mode (recommended)
bun run --cwd packages/console tauri dev

# Or run web dev server only (for UI debugging)
bun run --cwd packages/console dev
```

#### Email Templates

```bash
# Preview email templates
bun run --cwd packages/console/mail dev
```

### Build

```bash
# Build Tauri desktop app
bun run --cwd packages/console tauri build

# Output locations:
# - macOS: src-tauri/target/release/bundle/macos/
# - Windows: src-tauri/target/release/bundle/msi/
```

### Database

```bash
# Run migrations (dev stage)
bun run --cwd packages/console/core db-dev push

# Generate new migration
bun run --cwd packages/console/core db-dev generate

# Open Drizzle Studio
bun run --cwd packages/console/core db-dev studio
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Web App** | SolidStart, Solid.js, Tailwind CSS, Vite |
| **Desktop App** | Tauri 2.x, React 18, CodeMirror 6, Tailwind CSS |
| **Backend Core** | Drizzle ORM, PostgreSQL/PlanetScale |
| **Serverless** | Cloudflare Workers, OpenAuth |
| **Email** | JSX Email |
| **Infrastructure** | SST (Serverless Stack) |
| **Build Tool** | Bun, Vite |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interfaces                         │
├─────────────────────────────┬───────────────────────────────┤
│     Web App (SolidStart)    │    Desktop App (Tauri/React)  │
│         app/                │         src/ + src-tauri/     │
└─────────────┬───────────────┴───────────────┬───────────────┘
              │                               │
              ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend Services                          │
├─────────────────────────────┬───────────────────────────────┤
│    Cloudflare Workers       │      OpenCode Server          │
│       function/             │    (local, via Tauri IPC)     │
└─────────────┬───────────────┴───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                       Core Layer                             │
│                         core/                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────────┐ │
│  │ Account │  │  User   │  │Workspace│  │     Billing     │ │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────────┬────────┘ │
│       └────────────┴────────────┴────────────────┘          │
│                           │                                  │
│                    ┌──────▼──────┐                          │
│                    │   Drizzle   │                          │
│                    │     ORM     │                          │
│                    └──────┬──────┘                          │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  PostgreSQL/  │
                    │  PlanetScale  │
                    └───────────────┘
```

## Tauri Commands

Rust commands defined in `src-tauri/src/` and callable from frontend via `invoke`:

```typescript
import { invoke } from '@tauri-apps/api/core'

// Open workspace folder dialog
const rootPath = await invoke<string>('open_workspace_dialog')

// Start dev server
const info = await invoke<DevServerInfo>('workspace_dev_start', {
  workspaceId,
  rootPath,
})

// Stop dev server
await invoke('workspace_dev_stop', { workspaceId })

// Read directory contents
const items = await invoke<FileItem[]>('read_directory', { path })

// Read file content
const content = await invoke<string>('read_file_content', { path })

// Write file content
await invoke('write_file_content', { path, content })
```

## Troubleshooting

### Rust Compilation Errors

```bash
cd packages/console/src-tauri
cargo clean
cargo build
```

### TypeScript Errors

```bash
bun run --cwd packages/console typecheck
```

### Dependency Issues

```bash
# Clean and reinstall
rm -rf node_modules
bun install
```

### Database Connection

```bash
# Test database connection
bun run --cwd packages/console/core shell-dev script/lookup-user.ts test
```

## Related Documentation

- [Design Document](../../docs/devplan/BUILD-STUDIO-DESIGN.md)
- [Product Spec](../../docs/product/SPEC.md)
- [Tauri Documentation](https://tauri.app/)
- [SolidStart Documentation](https://start.solidjs.com/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
