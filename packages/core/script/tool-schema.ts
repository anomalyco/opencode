import { Effect, Schema } from "effect"
import { definition } from "../src/tool/runtime"

const name = process.argv[2]
const names = new Set([
  "edit",
  "glob",
  "grep",
  "patch",
  "question",
  "read",
  "shell",
  "skill",
  "subagent",
  "webfetch",
  "websearch",
  "write",
])

if (!name || !names.has(name)) throw new Error(`Usage: bun script/tool-schema.ts <${[...names].join("|")}>`)

const plugin: unknown = await import(`../src/tool/plugin/${name}.ts`)
if (typeof plugin !== "object" || plugin === null || !("Input" in plugin) || !Schema.isSchema(plugin.Input))
  throw new Error(`Tool does not export an Effect Input schema: ${name}`)

console.log(
  JSON.stringify(
    definition({
      name,
      description: "",
      input: plugin.Input,
      execute: () => Effect.succeed({ content: "" }),
    }).inputSchema,
    null,
    2,
  ),
)
