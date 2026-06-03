<!-- Context: development/agents-tools | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Concept: Mastra Agents & Tools

**Purpose**: Reusable units of logic and LLM-powered entities.

**Last Updated**: 2026-01-09

---

## Core Idea
Agents are specialized LLM configurations that use Tools to interact with external systems or perform specific logic. Tools are the building blocks that provide functionality to both agents and workflows.

## Key Points
- **Agents**: Defined with a `name`, `instructions`, and `model`. They can be assigned a set of `tools`.
- **Tools**: Defined with `id`, `inputSchema`, `outputSchema`, and an `execute` function.
- **Type Safety**: Both agents and tools use Zod for schema validation.
- **Standalone Use**: Tools can be executed independently of agents, making them highly reusable.

## Quick Example
```typescript
// Tool
const myTool = createTool({
  id: 'my-tool',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ inputData }) => ({ result: `Processed ${inputData.query}` }),
});

// Agent
const myAgent = new Agent({
  name: 'My Agent',
  instructions: 'Use my-tool to process queries.',
  model: { provider: 'OPEN_AI', name: 'gpt-4o' },
  tools: { myTool },
});
```

**Reference**: `src/mastra/agents/`, `src/mastra/tools/`
**Related**:
- concepts/core.md
- concepts/workflows.md
