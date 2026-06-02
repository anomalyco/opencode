export * as ToolRegistry from "./tool-registry"

import { Tool, ToolFailure, ToolResultValue as ToolResult, type AnyTool, type ToolCall, type ToolResultValue } from "@opencode-ai/llm"
import { Context, Effect, Layer, Scope } from "effect"
import { castDraft, enableMapSet } from "immer"
import { State } from "./state"
import { SessionSchema } from "./session/schema"

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly call: ToolCall
}

export type AuthorizeInput = ExecuteInput & {
  readonly parameters: unknown
}

export type Entry = {
  readonly tool: AnyTool
  readonly authorize?: (input: AuthorizeInput) => Effect.Effect<void, ToolFailure>
  readonly execute?: (input: AuthorizeInput) => Effect.Effect<unknown, ToolFailure>
}

type Data = {
  readonly entries: Map<string, Entry>
}

export type Editor = {
  readonly list: () => ReadonlyArray<readonly [string, Entry]>
  readonly get: (name: string) => Entry | undefined
  readonly set: (name: string, entry: Entry) => void
  readonly remove: (name: string) => void
}

export interface Interface {
  readonly transform: State.Interface<Data, Editor>["transform"]
  readonly contribute: (update: State.Transform<Editor>) => Effect.Effect<void, never, Scope.Scope>
  readonly definitions: () => Effect.Effect<ReadonlyArray<ReturnType<typeof Tool.toDefinitions>[number]>>
  readonly execute: (input: ExecuteInput) => Effect.Effect<ToolResultValue>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolRegistry") {}

enableMapSet()

export const layer = (initial: Readonly<Record<string, Entry>> = {}) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = State.create<Data, Editor>({
        initial: () => ({ entries: new Map(Object.entries(initial)) }),
        editor: (draft) => ({
          list: () => Array.from(draft.entries.entries()) as Array<[string, Entry]>,
          get: (name) => draft.entries.get(name) as Entry | undefined,
          set: (name, entry) => {
            draft.entries.set(name, castDraft(entry))
          },
          remove: (name) => {
            draft.entries.delete(name)
          },
        }),
      })

      const definitions = Effect.fn("ToolRegistry.definitions")(function* () {
        return Tool.toDefinitions(Object.fromEntries(Array.from(state.get().entries, ([name, entry]) => [name, entry.tool])))
      })

      const execute = Effect.fn("ToolRegistry.execute")(function* (input: ExecuteInput) {
        const entry = state.get().entries.get(input.call.name)
        if (!entry) return { type: "error" as const, value: `Unknown tool: ${input.call.name}` }
        if (!entry.execute && !entry.tool.execute)
          return { type: "error" as const, value: `Tool has no execute handler: ${input.call.name}` }

        return yield* entry.tool._decode(input.call.input).pipe(
          Effect.mapError((error) => new ToolFailure({ message: `Invalid tool input: ${error.message}` })),
          Effect.flatMap((parameters) =>
            entry.authorize === undefined
              ? entry.execute?.({ ...input, parameters }) ??
                  entry.tool.execute!(parameters, { id: input.call.id, name: input.call.name })
              : entry.authorize({ ...input, parameters }).pipe(
                  Effect.andThen(
                    entry.execute?.({ ...input, parameters }) ??
                      entry.tool.execute!(parameters, { id: input.call.id, name: input.call.name }),
                  ),
                ),
          ),
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
          Effect.map((value): ToolResultValue => ToolResult.make(value)),
          Effect.catchTag("LLM.ToolFailure", (failure) =>
            Effect.succeed({ type: "error" as const, value: failure.message }),
          ),
        )
      })

      return Service.of({
        transform: state.transform,
        contribute: Effect.fn("ToolRegistry.contribute")(function* (update) {
          const transform = yield* state.transform()
          yield* transform(update)
        }),
        definitions,
        execute,
      })
    }),
  )
