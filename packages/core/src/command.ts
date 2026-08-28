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

export type Draft = {
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

export interface Interface extends State.Transformable<Draft> {
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
    const state = State.create<Map<string, Definition>, Draft>({
      name: "command",
      initial: () => new Map(),
      draft: (draft) => ({
        add: (definition) => draft.set(definition.name, definition),
      }),
      finalize: () => bus.publish(Command.Event.Updated, {}).pipe(Effect.asVoid),
    })
    const info = (definition: Definition) =>
      Info.make({
        name: definition.name,
        description: definition.description,
      })

    return Service.of({
      reload: state.reload,
      transform: state.transform,
      get: Effect.fn("Command.get")(function* (name) {
        const definition = (yield* state.read()).get(name)
        return definition ? info(definition) : undefined
      }),
      list: Effect.fn("Command.list")(function* () {
        return Array.from((yield* state.read()).values(), info)
      }),
      execute: Effect.fn("Command.execute")(function* (input) {
        const definition = (yield* state.read()).get(input.name)
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
