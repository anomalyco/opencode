<!-- Context: development/workflow-step-structure | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Workflow Step Structure

**Purpose**: Standardized pattern for defining maintainable and testable workflow steps.

**Last Updated**: 2026-01-09

---

## Core Idea
Workflow steps should be self-contained units that encapsulate their input/output schemas and execution logic. For complex workflows, steps should be moved to a dedicated `steps/` directory and grouped by phase.

## Key Points
- **Directory Structure**: Group steps by phase (e.g., `steps/phase1-load.ts`, `steps/phase2-process.ts`).
- **Schema Centralization**: Define shared schemas (like `workflowStateSchema`) in a `schemas.ts` file within the steps directory.
- **Explicit State**: Use `stateSchema` in `createStep` to ensure type safety when accessing the global workflow state.
- **Tool Delegation**: Steps should primarily act as orchestrators, delegating heavy lifting to Tools.
- **Logging**: Include clear console logs at the start and end of each step for easier debugging.

## Quick Example
```typescript
// src/mastra/workflows/v3/steps/phase1.ts
export const myStep = createStep({
  id: 'my-step-id',
  inputSchema: z.object({ ... }),
  outputSchema: z.object({ ... }),
  stateSchema: workflowStateSchema,
  execute: async ({ inputData, state, mastra }) => {
    console.log('🚀 Starting myStep...');
    const result = await myTool.execute(inputData, { mastra });
    return result;
  },
});
```

**Reference**: `src/mastra/workflows/v3/steps/`
**Related**:
- concepts/workflows.md
- guides/modular-building.md
