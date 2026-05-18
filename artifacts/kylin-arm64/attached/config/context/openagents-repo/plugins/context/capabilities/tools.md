<!-- Context: openagents-repo/tools | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# Building Custom Tools

Plugins can add custom tools that OpenCode agents can call autonomously.

## Tool Definition

Custom tools use Zod for schema definition and the `tool` helper from `@opencode-ai/plugin`.

```typescript
import { z } from 'zod';
import { tool } from '@opencode-ai/plugin';

export const MyCustomTool = tool(
  z.object({
    query: z.string().describe('Search query'),
    limit: z.number().default(10).describe('Results limit')
  }),
  async (args, context) => {
    const { query, limit } = args;
    // Implementation logic
    return { success: true, data: [] };
  }
).describe('Search your database');
```

## Shell-based Tools

You can leverage Bun's shell API (`$`) to run commands in any language.

```typescript
export const PythonCalculatorTool = tool(
  z.object({ expression: z.string() }),
  async (args, context) => {
    const { $ } = context;
    const result = await $`python3 -c 'print(eval("${args.expression}"))'`;
    return { result: result.stdout };
  }
).describe('Calculate mathematical expressions');
```

## Integration

To register tools in your plugin:

```typescript
export const MyPlugin = async (context) => {
  return {
    tool: [MyCustomTool, PythonCalculatorTool]
  };
};
```
