export * as Command from "./command.js"

import { Command } from "@opencode-ai/schema/command"
import type { PromptInput } from "@opencode-ai/schema/prompt-input"
import type { Session } from "@opencode-ai/schema/session"
import type { SessionInbox } from "@opencode-ai/schema/session-inbox"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Bus } from "./bus.js"
import { State } from "./state.js"

export const Info = Command.Info
export type Info = Command.Info
export { Event } from "@opencode-ai/schema/command"

export interface Invocation {
  readonly sessionID: Session.ID
  readonly prompt: PromptInput.Prompt
  readonly delivery: SessionInbox.Delivery
}

export interface Definition {
  readonly name: string
  readonly description?: string
  readonly execute: (input: Invocation) => Effect.Effect<void, unknown>
}

export type Editor = {
  add: (definition: Definition) => void
}

export class NotFoundError extends Schema.TaggedError<NotFoundError>()("Command.NotFoundError", {
  command: Schema.String,
  message: Schema.String,
}) {}

export class ExecutionError extends Schema.TaggedError<ExecutionError>()("Command.ExecutionError", {
  command: Schema.String,
  message: Schema.String,
}) {}

export interface Interface extends State.Transformable<Editor> {
  readonly get: (name: string) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
  readonly execute: (input: {
    readonly name: string
    readonly invocation: Invocation
  }) => Effect.Effect<void, NotFoundError | ExecutionError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Command") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const state = State.create<Map<string, Definition>, Editor>({
      name: "command",
      initial: () => new Map(),
      editor: (editor) => ({
        add: (definition) => editor.set(definition.name, definition),
      }),
      notify: () => bus.publish(Command.Event.Updated, {}).pipe(Effect.asVoid),
    })
    const info = (definition: Definition) =>
      Info.make({
        name: definition.name,
        description: definition.description,
      })

    return Service.of({
      reload: state.reload,
      transform: state.transform,
      get: Effect.fn("Command.get")((name) =>
        Effect.sync(() => {
          const definition = state.get().get(name)
          return definition ? info(definition) : undefined
        }),
      ),
      list: Effect.fn("Command.list")(() => Effect.sync(() => Array.from(state.get().values(), info))),
      execute: Effect.fn("Command.execute")(function* (input) {
        const definition = state.get().get(input.name)
        if (!definition)
          return yield* new NotFoundError({ command: input.name, message: `Command not found: ${input.name}` })
        return yield* definition.execute(input.invocation).pipe(
          Effect.tapError((error) => Effect.logError("command execution failed", { command: input.name, error })),
          Effect.mapError((error) => new ExecutionError({ command: input.name, message: errorMessage(error) })),
        )
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node],
})

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message
  return "Command execution failed"
}
