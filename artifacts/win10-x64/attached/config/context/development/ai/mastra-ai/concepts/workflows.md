<!-- Context: development/workflows | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Concept: Mastra Workflows

**Purpose**: Linear and parallel execution chains for complex AI tasks.

**Last Updated**: 2026-01-09

---

## Core Idea
Workflows in Mastra are directed graphs of steps that process data sequentially or in parallel. They provide a structured way to handle multi-stage LLM operations with built-in state management and human-in-the-loop (HITL) support.

## Key Points
- **Step Definition**: Created with `createStep`, requiring `inputSchema`, `outputSchema`, and an `execute` function.
- **Chaining**: Steps are linked using `.then()` for sequential and `.parallel()` for concurrent execution.
- **HITL Support**: Steps can `suspend` execution to wait for human input and `resume` when data is provided.
- **State Access**: Each step has access to the global workflow `state` and the `inputData` from the previous step.

## Quick Example
```typescript
const workflow = createWorkflow({ id: 'my-workflow', inputSchema, outputSchema })
  .then(step1)
  .parallel([step2a, step2b])
  .then(mergeStep)
  .commit();

const { runId, start } = workflow.createRun();
const result = await start({ inputData: { ... } });
```

**Reference**: `src/mastra/workflows/`
**Related**:
- concepts/core.md
- examples/workflow-example.md
