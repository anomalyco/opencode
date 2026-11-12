import { ToolDefinition } from "@opencode/ai/effect"
import type { Tool } from "@opencode/schema/tool"
import { Context, Effect } from "effect"

type Repair = (input: unknown, schema: ToolDefinition["inputSchema"]) => unknown

export type Target = { readonly tool: Tool.Info; readonly definition: ToolDefinition }

// Each invocation gets its own scope. The repair plugin can resolve an alias in hook order,
// but only the final target determines how to interpret the input left by those hooks.
export const Selection = Context.Reference<
  | {
      readonly has: (name: string) => boolean
      readonly defer: (repair: Repair) => void
    }
  | undefined
>("@opencode/Tool/Selection", { defaultValue: () => undefined })

export const prepare = Effect.fnUntraced(function* (
  requested: string,
  input: unknown,
  lookup: (name: string) => Target | undefined,
  before: (name: string, input: unknown) => Effect.Effect<{ tool: string; input: unknown }, Tool.Error>,
) {
  let repair: Repair | undefined
  const event = yield* before(requested, input).pipe(
    Effect.provideService(Selection, {
      has: (name) => lookup(name) !== undefined,
      defer: (fn) => {
        repair = fn
      },
    }),
  )
  const target = lookup(event.tool)
  if (!target) return { name: event.tool, target, input: event.input }
  const schema = target.definition.inputSchema
  const field =
    target.definition.freeform && typeof event.input === "string" ? ToolDefinition.freeformField(schema) : undefined
  const wrapped = field === undefined ? event.input : { [field]: event.input }
  return { name: event.tool, target, input: repair ? repair(wrapped, schema) : wrapped }
})
