# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ShopOS** is an AI-powered commerce operations agent built on OpenCode. It helps e-commerce brands operate their business by answering questions, analyzing data, creating strategies, and executing pre-built workflow Plans.

**Key Difference from OpenCode**: ShopOS is not a chatbot - it's an operations agent that takes action. When asked a question, it queries real data. When asked to create something, it executes Spaces. When given an outcome goal, it runs a Plan.

## Development Commands

```bash
# Install dependencies
bun install

# Run TUI
bun dev

# Run web app
bun run --cwd packages/app dev

# Run backend server
bun run --cwd packages/opencode src/index.ts serve --port 4096

# Type checking
bun turbo typecheck

# Tests (from package directory, NOT root)
bun test --cwd packages/opencode

# Build standalone
./packages/opencode/script/build.ts --single
```

## ShopOS Architecture

### Hierarchical 3-Tier Agent System

```
User Prompt
     ↓
┌─────────────────┐
│    PLANNER      │  ← Breaks down intent, spawns workers
└────────┬────────┘
         │ spawns (parallel)
    ┌────┼────┐
    ↓    ↓    ↓
┌──────┐┌──────┐┌──────┐
│WORKER││WORKER││WORKER│  ← Execute work units
└──┬───┘└──┬───┘└──┬───┘
   │       │       │
   ↓       ↓       ↓
@analyst @strategist @executor  ← Domain specialists
         │
         ↓
┌─────────────────┐
│    REVIEWER     │  ← Validates, triggers retries
└─────────────────┘
         │
         ↓
   Complete Output
```

### Domain Agents

| Agent | Purpose | Location |
|-------|---------|----------|
| `planner` | Orchestration, breaks down tasks, spawns workers | `.opencode/agent/planner.md` |
| `worker` | Generic execution, delegates to specialists | `.opencode/agent/worker.md` |
| `reviewer` | Validates outputs, triggers retries | `.opencode/agent/reviewer.md` |
| `analyst` | Data queries (ROI, sales, inventory) | `.opencode/agent/analyst.md` |
| `strategist` | Strategic planning, campaign design | `.opencode/agent/strategist.md` |
| `executor` | Creative Space execution (images, copy, ads) | `.opencode/agent/executor.md` |
| `ops` | Complex operational tasks | `.opencode/agent/ops.md` |
| `triage` | Request routing | `.opencode/agent/triage.md` |

### Available Brands (Mock Data)

- `nike` - Sports apparel (Nike India)
- `luxebags` - Premium handbags (LuxeBags)
- `freshfoods` - Organic food products (FreshFoods Co)

### ShopOS Tools

| Tool | Purpose |
|------|---------|
| `get-brand-context` | Load brand config, databases, preferences |
| `query-sales` | Query sales data by region, category, date |
| `query-campaigns` | Query campaign performance metrics |
| `query-inventory` | Query inventory levels and alerts |
| `run-space` | Execute creative Spaces (image_generation, copy_generation, etc.) |

### ShopOS Skills (Pre-built Workflows)

| Skill | Purpose |
|-------|---------|
| `analyze-performance` | Analyze brand performance metrics |
| `seasonal-campaign` | Create seasonal marketing campaigns |
| `launch-product` | Execute product launches |
| `marketplace-expansion` | Plan marketplace expansion |
| `competitor-response` | Respond to competitor actions |

## Repository Structure

**Bun monorepo** with Turbo for build orchestration. Default branch is `dev`.

### Core Packages
- `packages/opencode` - CLI, server, TUI (main agent)
- `packages/app` - Web UI (SolidJS)
- `packages/ui` - Component library (Kobalte, Tailwind)
- `packages/desktop` - Native app (Tauri v2)
- `packages/sdk/js` - JavaScript SDK

### ShopOS-Specific Files
- `.opencode/agent/` - Agent definitions (planner, worker, reviewer, specialists)
- `.opencode/skill/` - Pre-built workflow Plans
- `.opencode/tool/` - ShopOS tools (brand context, queries, Spaces)
- `.opencode/plan/` - Shared memory for inter-agent communication
- `.opencode/opencode.jsonc` - Config (default_agent: planner)

### Agent Flow Visualization
- `packages/ui/src/components/agent-card.tsx` - Agent card component (grid layout)
- `packages/ui/src/components/agent-flow-panel.tsx` - Agent flow container
- `packages/app/src/context/agent-flow.tsx` - Agent flow state management

## Code Style

- **No destructuring**: Use `obj.a` instead of `const { a } = obj`
- **No `let`**: Prefer `const` with ternary or early returns
- **No `else`**: Use early returns
- **No `try/catch`**: Prefer `.catch()`
- **Single-word names**: When possible
- **No `any`**: Use precise types
- **No semicolons**: Prettier enforced, 120 char line width

## ShopOS Guardrails

When working with ShopOS:

1. **Always call `get_brand_context` first** before any other tool
2. **Never fabricate data** - if query fails, say "Data unavailable"
3. **Never run Spaces without brand context** - preferences matter
4. **Never guess brand IDs** - only use: `nike`, `luxebags`, `freshfoods`

## Key Technical Details

- **Runtime**: Bun 1.3.5+
- **TypeScript**: 5.8.2
- **UI Framework**: SolidJS
- **API Framework**: Hono
- **ORM**: Drizzle
- **AI SDK**: Vercel AI SDK (multi-provider)

## Recent Changes

### Agent Flow Card Redesign
- Grid layout with responsive cards (280px+ columns)
- Status pills showing current action with colored indicators
- Live preview of agent output in card background
- Previous action → current action transition tracking
- Timestamps ("Updated X seconds ago")

### Bug Fixes
- Fixed zod cross-instance schema issue using `zodToJsonSchema` library
- Plugin tools now work correctly with different zod instances

## Important Notes

- Always use parallel tool calls when operations are independent
- Never run `bun test` from repo root
- Run `./script/generate.ts` after modifying API or SDK
- UI components use `data-component`, `data-slot` CSS attribute pattern
- Agent flow visualization hooks to SDK `message.part.updated` events
