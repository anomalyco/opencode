import { ToolDefinition } from "@opencode/ai/effect"
import { Tool } from "@opencode/schema/tool"
import { Context, Effect, Result } from "effect"
import { isDeepStrictEqual } from "node:util"

type Repair = (input: unknown, schema: ToolDefinition["inputSchema"]) => unknown
type Draft = { tool: string; input: unknown }

export type Target = { readonly tool: Tool.Info; readonly definition: ToolDefinition }

// Each invocation resolves names against its own visible registrations.
export const Selection = Context.Reference<
  | {
      readonly has: (name: string) => boolean
      readonly repair: (event: Draft, repair: Repair) => void
      readonly redirected: (event: Draft) => void
    }
  | undefined
>("@opencode/Tool/Selection", { defaultValue: () => undefined })

export const prepare = Effect.fnUntraced(function* (
  requested: string,
  input: unknown,
  lookup: (name: string) => Target | undefined,
  before: (name: string, input: unknown) => Effect.Effect<Draft, Tool.Error>,
) {
  let repair: Repair | undefined
  const select = (name: string, source: unknown) => {
    const target = lookup(name)
    const schema = target?.definition.inputSchema
    const field =
      schema && target.definition.freeform && typeof source === "string"
        ? ToolDefinition.freeformField(schema)
        : undefined
    const wrapped = field === undefined ? source : { [field]: source }
    const input = repair && schema ? repair(wrapped, schema) : wrapped
    // Repair can share nested objects with the source. Snapshot only transformed values
    // so an in-place hook edit can be distinguished from a name-only redirect.
    const baseline = input === source ? undefined : Result.try(() => structuredClone(input))
    return { name, source, input, baseline }
  }
  let selected = select(requested, input)
  const reselect = (event: Draft) => {
    // A name-only redirect starts from the original arguments: the old schema may have
    // dropped fields or wrapped text under a different key. Explicit edits take precedence.
    const unchanged =
      event.input === selected.input &&
      selected.baseline &&
      Result.isSuccess(selected.baseline) &&
      isDeepStrictEqual(event.input, selected.baseline.success)
    selected = select(event.tool, unchanged ? selected.source : event.input)
    event.input = selected.input
  }
  const event = yield* before(requested, selected.input).pipe(
    Effect.provideService(Selection, {
      has: (name) => lookup(name) !== undefined,
      repair: (event, fn) => {
        repair = fn
        reselect(event)
      },
      redirected: (event) => {
        if (event.tool !== selected.name) reselect(event)
      },
    }),
  )
  // A later hook that replaces the prepared object must supply the handler's input shape.
  // In particular a bare string here must not be interpreted again as Code Mode shorthand.
  const target = lookup(event.tool)
  if (
    typeof event.input === "string" &&
    target?.definition.freeform &&
    ToolDefinition.freeformField(target.definition.inputSchema) !== undefined
  )
    return yield* new Tool.Error({ message: `Expected an input object for freeform tool ${event.tool}` })
  return { name: event.tool, target, input: event.input }
})
