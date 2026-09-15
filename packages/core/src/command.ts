export * as Command from "./command.js"

import { Command } from "@opencode/schema/command"
import type { PromptInput } from "@opencode/schema/prompt-input"
import type { Session } from "@opencode/schema/session"
import type { SessionInbox } from "@opencode/schema/session-inbox"
import type { SessionMessage } from "@opencode/schema/session-message"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { Bus } from "./bus.js"
import { State } from "./state.js"

export const Info = Command.Info
export type Info = Command.Info
export const Outcome = Command.Outcome
export type Outcome = Command.Outcome
export { Event } from "@opencode/schema/command"

export function prompted(admitted: { readonly id: SessionMessage.ID }): Outcome {
  return { type: "prompt", inboxID: admitted.id }
}

export interface Invocation {
  readonly sessionID: Session.ID
  /**
   * Identity for the input this command admits. Commands that prompt a Session must admit
   * with this ID and report it in their outcome so clients can follow the resulting work.
   */
  readonly messageID: SessionMessage.ID
  readonly prompt: PromptInput.Prompt
  readonly delivery: SessionInbox.Delivery
}

export interface Definition {
  readonly name: string
  readonly description?: string
  /** Resolve with an Outcome to report admitted work; `void` means the command finished immediately. */
  readonly execute: (input: Invocation) => Effect.Effect<Outcome | void, unknown>
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
  }) => Effect.Effect<Outcome, NotFoundError | ExecutionError>
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
        const outcome = yield* definition.execute(input.invocation).pipe(
          Effect.tapError((error) => Effect.logError("command execution failed", { command: input.name, error })),
          Effect.mapError((error) => new ExecutionError({ command: input.name, message: errorMessage(error) })),
        )
        if (outcome === undefined) return { type: "immediate" as const }
        // Plugin callbacks cross a JavaScript boundary; only a well-formed outcome is reportable.
        if (!isOutcome(outcome))
          return yield* new ExecutionError({
            command: input.name,
            message: `Command returned an invalid outcome (${typeof outcome})`,
          })
        // Clients follow the invocation ID, so a command that admitted under another ID (typically by
        // omitting `id: messageID` from its prompt) would leave them waiting forever. Fail loudly instead.
        if (outcome.type === "prompt" && outcome.inboxID !== input.invocation.messageID)
          return yield* new ExecutionError({
            command: input.name,
            message: `Command admitted ${outcome.inboxID} instead of the invocation message ID ${input.invocation.messageID}`,
          })
        return outcome
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Bus.node],
})

const isOutcome = Schema.is(Outcome)

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string")
    return error.message
  return "Command execution failed"
}
