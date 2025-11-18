---
title: Custom Tools
description: Create tools the LLM can call in opencode.
---

Custom tools are functions you create that the LLM can call during conversations. They work alongside opencode's [built-in tools](/docs/tools) like `read`, `write`, and `bash`.

---

## Creating a tool

Tools are defined as **TypeScript** or **JavaScript** files. However, the tool definition can invoke scripts written in **any language** — TypeScript or JavaScript is only used for the tool definition itself.

---

### Location

They can be defined:

- Locally by placing them in the `.opencode/tool/` directory of your project.
- Or globally, by placing them in `~/.config/opencode/tool/`.

---

### Structure

The easiest way to create tools is using the `tool()` helper which provides type-safety and validation.

```ts title=".opencode/tool/database.ts" {1}
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Query the project database",
  args: {
    query: tool.schema.string().describe("SQL query to execute"),
  },
  async execute(args) {
    // Your database logic here
    return `Executed query: ${args.query}`
  },
})
```

The **filename** becomes the **tool name**. The above creates a `database` tool.

---

#### Multiple tools per file

You can also export multiple tools from a single file. Each export becomes **a separate tool** with the name **`<filename>_<exportname>`**:

```ts title=".opencode/tool/math.ts"
import { tool } from "@opencode-ai/plugin"

export const add = tool({
  description: "Add two numbers",
  args: {
    a: tool.schema.number().describe("First number"),
    b: tool.schema.number().describe("Second number"),
  },
  async execute(args) {
    return args.a + args.b
  },
})

export const multiply = tool({
  description: "Multiply two numbers",
  args: {
    a: tool.schema.number().describe("First number"),
    b: tool.schema.number().describe("Second number"),
  },
  async execute(args) {
    return args.a * args.b
  },
})
```

This creates two tools: `math_add` and `math_multiply`.

---

### Arguments

You can use `tool.schema`, which is just [Zod](https://zod.dev), to define argument types.

```ts "tool.schema"
args: {
  query: tool.schema.string().describe("SQL query to execute")
}
```

You can also import [Zod](https://zod.dev) directly and return a plain object:

```ts {6}
import { z } from "zod"

export default {
  description: "Tool description",
  args: {
    param: z.string().describe("Parameter description"),
  },
  async execute(args, context) {
    // Tool implementation
    return "result"
  },
}
```

---

### Context

Tools receive context about the current session:

```ts title=".opencode/tool/project.ts" {8}
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Get project information",
  args: {},
  async execute(args, context) {
    // Access context information
    const { agent, sessionID, messageID } = context
    return `Agent: ${agent}, Session: ${sessionID}, Message: ${messageID}`
  },
})
```

---

## Examples

### Write a tool in Python

You can write your tools in any language you want. Here's an example that adds two numbers using Python.

First, create the tool as a Python script:

```python title=".opencode/tool/add.py"
import sys

a = int(sys.argv[1])
b = int(sys.argv[2])
print(a + b)
```

Then create the tool definition that invokes it:

```ts title=".opencode/tool/python-add.ts" {10}
import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Add two numbers using Python",
  args: {
    a: tool.schema.number().describe("First number"),
    b: tool.schema.number().describe("Second number"),
  },
  async execute(args) {
    const result = await Bun.$`python3 .opencode/tool/add.py ${args.a} ${args.b}`.text()
    return result.trim()
  },
})
```

Here we are using the [`Bun.$`](https://bun.com/docs/runtime/shell) utility to run the Python script.
