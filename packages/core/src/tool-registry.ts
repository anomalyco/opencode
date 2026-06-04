export * as ToolRegistry from "./tool-registry"

import {
  Tool,
  ToolFailure,
  ToolOutput,
  ToolResultValue as ToolResult,
  type Tool as TypedTool,
  type ToolCall,
  type ToolResultValue,
  type ToolSchema,
  type ToolSettlement,
} from "@opencode-ai/llm"
import { Context, Effect, Layer, Schema, Scope } from "effect"
import { castDraft, enableMapSet } from "immer"
import { PermissionV2 } from "./permission"
import { State } from "./state"
import { SessionSchema } from "./session/schema"
import type { SessionV2 } from "./session"

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly call: ToolCall
}

/**
 * Narrow cross-cutting context for one registry invocation. Leaf tools retain
 * ownership of sequence-sensitive policy decisions; the registry only binds
 * identity and shared helper behavior consistently.
 *
 * TODO: Add `source` when the runner can pass the durable owning assistant
 * message ID alongside the call ID. Do not infer it from the tool call alone.
 * TODO: Add cancellation and progress only when the runner exposes a real
 * signal and durable/live progress sink.
 */
export type Invocation = ExecuteInput & {
  readonly source?: PermissionV2.Source
  readonly assertPermission: (
    input: Omit<PermissionV2.AssertInput, "sessionID" | "source">,
  ) => Effect.Effect<void, PermissionV2.Error | SessionV2.NotFoundError>
}

/** Kept as the leaf entry input name for backwards-compatible execute usage. */
export type AuthorizeInput<Parameters = unknown> = Invocation & {
  readonly parameters: Parameters
}

export type Entry<
  Parameters extends ToolSchema<any> = ToolSchema<any>,
  Success extends ToolSchema<any> = ToolSchema<any>,
> = {
  readonly tool: TypedTool<Parameters, Success>
  readonly authorize?: (input: AuthorizeInput<Schema.Schema.Type<Parameters>>) => Effect.Effect<void, ToolFailure>
  readonly execute?: (
    input: AuthorizeInput<Schema.Schema.Type<Parameters>>,
  ) => Effect.Effect<Schema.Schema.Type<Success>, ToolFailure>
}

type Data = {
  readonly entries: Map<string, Entry>
}

export type Editor = {
  readonly list: () => ReadonlyArray<readonly [string, Entry]>
  readonly get: (name: string) => Entry | undefined
  readonly set: <Parameters extends ToolSchema<any>, Success extends ToolSchema<any>>(
    name: string,
    entry: Entry<Parameters, Success>,
  ) => void
  readonly remove: (name: string) => void
}

export interface Interface {
  readonly transform: State.Interface<Data, Editor>["transform"]
  readonly contribute: (update: State.Transform<Editor>) => Effect.Effect<void, never, Scope.Scope>
  readonly definitions: () => Effect.Effect<ReadonlyArray<ReturnType<typeof Tool.toDefinitions>[number]>>
  readonly execute: (input: ExecuteInput) => Effect.Effect<ToolResultValue>
  readonly settle: (input: ExecuteInput) => Effect.Effect<ToolSettlement>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolRegistry") {}

enableMapSet()

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const permission = yield* PermissionV2.Service
    const state = State.create<Data, Editor>({
      initial: () => ({ entries: new Map() }),
      editor: (draft) => ({
        list: () => Array.from(draft.entries.entries()) as Array<[string, Entry]>,
        get: (name) => draft.entries.get(name) as Entry | undefined,
        set: (name, entry) => {
          draft.entries.set(
            name,
            castDraft(entry) as typeof draft.entries extends Map<string, infer Value> ? Value : never,
          )
        },
        remove: (name) => {
          draft.entries.delete(name)
        },
      }),
    })

    const definitions = Effect.fn("ToolRegistry.definitions")(function* () {
      return Tool.toDefinitions(
        Object.fromEntries(Array.from(state.get().entries, ([name, entry]) => [name, entry.tool])),
      )
    })

    const invocation = (input: ExecuteInput): Invocation => ({
      ...input,
      // Source needs the durable owning assistant message ID, which the registry does not receive yet.
      assertPermission: (request) => permission.assert({ ...request, sessionID: input.sessionID }),
    })

    const settle = Effect.fn("ToolRegistry.settle")(function* (input: ExecuteInput) {
      const entry = state.get().entries.get(input.call.name)
      if (!entry) return { result: { type: "error" as const, value: `Unknown tool: ${input.call.name}` } }
      if (!entry.execute && !entry.tool.execute)
        return { result: { type: "error" as const, value: `Tool has no execute handler: ${input.call.name}` } }

      return yield* entry.tool._decode(input.call.input).pipe(
        Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
        Effect.flatMap((parameters) => {
          const context = { ...invocation(input), parameters }
          const execute =
            entry.execute?.(context) ?? entry.tool.execute!(parameters, { id: input.call.id, name: input.call.name })
          return (
            entry.authorize === undefined ? execute : entry.authorize(context).pipe(Effect.andThen(execute))
          ).pipe(
            Effect.flatMap((value) =>
              entry.tool._encode(value).pipe(
                Effect.mapError(
                  (error) =>
                    new ToolFailure({
                      message: `Tool returned an invalid value for its success schema: ${error.message}`,
                    }),
                ),
              ),
            ),
            Effect.map((value): ToolSettlement => {
              if (entry.tool._legacyResult && ToolResult.is(value))
                return { result: value, output: ToolOutput.fromResultValue(value) }
              const output = entry.tool._project(parameters, input.call.id, value)
              const result = ToolOutput.toResultValue(output)
              return result.type === "error" ? { result } : { result, output }
            }),
          )
        }),
        Effect.catchTag("LLM.ToolFailure", (failure) =>
          Effect.succeed({ result: { type: "error" as const, value: failure.message } }),
        ),
      )
    })

    const execute = Effect.fn("ToolRegistry.execute")(function* (input: ExecuteInput) {
      return (yield* settle(input)).result
    })

    return Service.of({
      transform: state.transform,
      contribute: Effect.fn("ToolRegistry.contribute")(function* (update) {
        const transform = yield* state.transform()
        yield* transform(update)
      }),
      definitions,
      execute,
      settle,
    })
  }),
)
