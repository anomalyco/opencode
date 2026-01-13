# Changelog

All notable changes to ShopOS will be documented in this file.

## [Unreleased] - 2026-01-13

### ShopOS Fork from OpenCode

ShopOS is a fork of OpenCode, adapted to be an AI-powered commerce operations agent for e-commerce brands.

### Added

#### Hierarchical Orchestrator System
- **Planner Agent** (`.opencode/agent/planner.md`) - Orchestrator that breaks down user intent into parallel work units
- **Worker Agent** (`.opencode/agent/worker.md`) - Generic executor with full permissions, delegates to specialists
- **Reviewer Agent** (`.opencode/agent/reviewer.md`) - Validates outputs and triggers retries for failed work units
- **Shared Memory** (`.opencode/plan/`) - Directory for inter-agent communication via plan files

#### Domain-Specific Agents
- **Analyst Agent** (`.opencode/agent/analyst.md`) - Data queries: ROI, sales, inventory, campaign performance
- **Strategist Agent** (`.opencode/agent/strategist.md`) - Strategic planning for launches, campaigns, expansion
- **Executor Agent** (`.opencode/agent/executor.md`) - Runs Spaces and executes creative workflows
- **Ops Agent** (`.opencode/agent/ops.md`) - Operational questions and brand context

#### Skills (Plans)
- `@launch-product` - New product launch workflow
- `@seasonal-campaign` - Seasonal campaign refresh
- `@marketplace-expansion` - Multi-marketplace expansion
- `@competitor-response` - Competitor response sprint
- `@analyze-performance` - Deep performance analysis
- `@orchestrate` - Triggers autonomous orchestration

#### ShopOS UI Components
- **ShopOS Logo** (`packages/ui/src/components/shopos-logo.tsx`) - Brand logo with shopping bag + circuit pattern
- **Agent Flow Node** (`packages/ui/src/components/agent-flow-node.tsx`) - Expandable agent node with status, duration, prompts
- **Agent Flow Panel** (`packages/ui/src/components/agent-flow-panel.tsx`) - Container panel with stats and empty state
- **Session View Tabs** (`packages/app/src/components/session/session-view-tabs.tsx`) - Chat | Agent Flow view switcher
- **Agent Flow Context** (`packages/app/src/context/agent-flow.tsx`) - State management for agent visualization
- **Workflow Icon** (`packages/ui/src/components/icon.tsx`) - Added workflow icon for Agent Flow tab

#### UI Features
- View tab switcher in session page (Chat | Agent Flow)
- Real-time agent flow visualization from SDK events
- Click-to-expand agent nodes showing prompts and tool calls
- Color-coded agent badges (planner=purple, worker=orange, reviewer=teal, etc.)
- Status indicators with animations (pending, running, complete, failed)
- Duration display for completed agents

### Changed

#### Branding
- Replaced OpenCode logo with ShopOS logo throughout the app
- Updated page title to "ShopOS"
- Updated notification and getting started text from "OpenCode" to "ShopOS"

#### Agent System
- Updated analyst, strategist, executor agents with `mode: all` for subagent support
- Added "When Called as Subagent" section to domain agents
- Enhanced ShopOS system prompt with autonomous orchestration section

### Technical Details

#### Files Created
```
.opencode/agent/planner.md
.opencode/agent/worker.md
.opencode/agent/reviewer.md
.opencode/agent/ops.md
.opencode/agent/analyst.md (modified)
.opencode/agent/strategist.md (modified)
.opencode/agent/executor.md (modified)
.opencode/plan/README.md
.opencode/skill/orchestrate/SKILL.md
.opencode/skill/launch-product/SKILL.md
.opencode/skill/seasonal-campaign/SKILL.md
.opencode/skill/marketplace-expansion/SKILL.md
.opencode/skill/competitor-response/SKILL.md
.opencode/skill/analyze-performance/SKILL.md
.opencode/ORCHESTRATOR.md
packages/ui/src/components/shopos-logo.tsx
packages/ui/src/components/shopos-logo.css
packages/ui/src/components/agent-flow-node.tsx
packages/ui/src/components/agent-flow-node.css
packages/ui/src/components/agent-flow-panel.tsx
packages/ui/src/components/agent-flow-panel.css
packages/app/src/components/session/session-view-tabs.tsx
packages/app/src/components/session/session-view-tabs.css
packages/app/src/context/agent-flow.tsx
```

#### Files Modified
```
packages/opencode/src/session/prompt/shopos.txt
packages/ui/src/components/icon.tsx
packages/ui/src/styles/index.css
packages/app/src/app.tsx
packages/app/src/pages/session.tsx
packages/app/src/pages/layout.tsx
packages/app/src/pages/home.tsx
packages/app/index.html
```

### Architecture

```
ShopOS Architecture
├── Agents (Hierarchical)
│   ├── planner (orchestrator)
│   ├── worker (executor)
│   ├── reviewer (validator)
│   └── specialists (analyst, strategist, executor)
├── Skills (Pre-built workflows)
│   ├── @launch-product
│   ├── @seasonal-campaign
│   └── ...
├── UI
│   ├── Chat View (default)
│   └── Agent Flow View (visualization)
└── Tools
    ├── get_brand_context
    ├── query_sales
    ├── query_campaigns
    ├── query_inventory
    └── run_space
```
