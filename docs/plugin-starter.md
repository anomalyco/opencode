# Plugin Starter Template

Use the helpers exported from `@opencode-ai/plugin` to build tools quickly:

```ts
import { tool } from "@opencode-ai/plugin"

export const hello = tool({
  description: "Greet a name",
  args: {
    name: tool.schema.string().describe("Name to greet"),
  },
  async execute(args, ctx) {
    return {
      title: `Hello, ${args.name}!`,
      output: `Session ${ctx.sessionID} says hello to ${args.name}.`,
      metadata: {
        length: args.name.length,
      },
    }
  },
})
```

Guidelines:
- Always describe arguments with `tool.schema` so the host can validate inputs.
- Return either a string or an object containing `output`, plus optional `title` and `metadata`.
- Use the tool telemetry (`measure`) and workspace guards when calling back into core tools.
- Test plugins by importing the generated hook into `packages/plugin/src/example.ts` and running `bunx tsc --noEmit`.
