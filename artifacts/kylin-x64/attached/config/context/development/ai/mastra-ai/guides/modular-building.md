<!-- Context: development/modular-building | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Modular Mastra Building

**Purpose**: Best practices for structuring a large-scale Mastra implementation.

**Last Updated**: 2026-01-09

---

## Core Idea
Modular building ensures that as the project grows, components remain testable, reusable, and easy to navigate. This is achieved by separating logic into specialized directories and using a central registry.

## Key Points
- **Component Separation**: Keep `agents`, `tools`, `workflows`, and `scorers` in their own top-level directories within `src/mastra/`.
- **Shared Services**: Use a `shared.ts` file to instantiate services (DB, repositories) to prevent circular dependencies between workflows and the main Mastra instance.
- **Central Registry**: Register all components in `src/mastra/index.ts`. This is the single source of truth for the Mastra instance.
- **Feature-Based Steps**: Group related workflow steps into sub-directories (e.g., `src/mastra/workflows/v3/steps/`) to keep workflow files clean.

## Quick Example
```typescript
// src/mastra/shared.ts
export const services = createServices();

// src/mastra/index.ts
import { services } from './shared';
export const mastra = new Mastra({
  workflows: { myWorkflow },
  agents: { myAgent },
  // ...
});
```

**Reference**: `src/mastra/index.ts`, `src/mastra/shared.ts`
**Related**:
- concepts/core.md
- guides/workflow-step-structure.md
