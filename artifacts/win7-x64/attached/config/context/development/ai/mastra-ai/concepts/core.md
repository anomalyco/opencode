<!-- Context: development/core | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Concept: Mastra Core

**Purpose**: Central orchestration layer for AI agents, workflows, and tools in this project.

**Last Updated**: 2026-01-09

---

## Core Idea
Mastra is the central hub that wires together agents, tools, workflows, and observability. It provides a unified interface for executing complex AI tasks with built-in persistence and logging.

## Key Points
- **Centralized Config**: All components are registered in `src/mastra/index.ts`.
- **Persistence**: Uses `LibSQLStore` (SQLite) for storing traces, spans, and workflow states.
- **Observability**: Built-in tracing and logging (Pino) for every execution.
- **Modular Design**: Agents, tools, and workflows are defined separately and composed in the main instance.

## Quick Example
```typescript
import { Mastra } from '@mastra/core/mastra';
import { agents, tools, workflows } from './components';

export const mastra = new Mastra({
  agents,
  tools,
  workflows,
  storage: new LibSQLStore({ url: 'file:./mastra.db' }),
});
```

**Reference**: `src/mastra/index.ts`
**Related**:
- concepts/workflows.md
- concepts/agents-tools.md
- lookup/mastra-config.md
