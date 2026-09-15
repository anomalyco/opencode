export * as OpenCodeTools from "./opencode.js"

import { SystemPart, ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"

export const RenameInput = Schema.Struct({
  sessionID: Schema.optionalKey(Session.ID).annotate({ description: "Omit to rename the current session." }),
  title: Schema.String.check(Schema.isMinLength(1)).annotate({ description: "New session title." }),
})

const RenameOutput = Schema.Struct({ sessionID: Session.ID, title: Schema.String })

export const MoveInput = Schema.Struct({
  sessionID: Schema.optionalKey(Session.ID).annotate({ description: "Omit to move the current session." }),
  directory: AbsolutePath.check(Schema.isMinLength(1)).annotate({
    description: "Destination directory, relative to the target session's directory or absolute. Supports ~.",
  }),
})

const MoveOutput = Schema.Struct({ sessionID: Session.ID, directory: AbsolutePath })

export const ModelsInput = Schema.Struct({
  provider: Schema.optionalKey(Schema.String).annotate({
    description: "Limit results to models from a particular provider.",
  }),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))).annotate({
    description: "Maximum number of models to return. Defaults to 20.",
  }),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "Number of models to skip, for paging through results.",
  }),
})

const ModelsOutput = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      id: Schema.String.annotate({ description: 'Model reference in "provider/model" form.' }),
      name: Schema.String,
      released: Model.Info.fields.time.fields.released.annotate({
        description: "Release date as a Unix timestamp in milliseconds, or 0 when unknown.",
      }),
      variants: Schema.Array(Model.VariantID),
      cost: Model.Info.fields.cost.annotate({ description: "Pricing in USD per million tokens." }),
      status: Model.Info.fields.status,
    }),
  ),
  total: Schema.Int,
  next: Schema.NullOr(Schema.Int).annotate({ description: "Offset of the next page, or null on the last page." }),
})

export const Plugin = {
  id: "opencode.tools",
  effect: Effect.fn("OpenCodeTools.Plugin")(function* (ctx: Context) {
    const hook = (event: SessionHooks["context"]) =>
      Effect.sync(() => {
        event.system.push(
          SystemPart.make(
            "When you create a worktree outside the current working directory and intend to use it as your primary working directory, consider using `execute` to call `tools.opencode.session_move` and make the worktree the session's working directory.",
          ),
        )
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
    yield* ctx.tool
      .transform((draft) => {
        draft.namespace({ name: "opencode", description: "OpenCode session and runtime tools." })
        draft.add({
          name: "session_rename",
          description:
            "Rename a session, or omit sessionID to rename the current session. Use a short, specific title that summarizes the work being done.",
          input: RenameInput,
          output: RenameOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) => {
            const sessionID = input.sessionID ?? context.sessionID
            const title = input.title.trim()
            if (!title) return Effect.fail(new ToolFailure({ message: "Session title must not be empty" }))
            return ctx.session.rename({ sessionID, title }).pipe(
              Effect.as({
                output: { sessionID, title },
                content: `Renamed session ${sessionID} to ${title}.`,
              }),
              Effect.mapError((error) => new ToolFailure({ message: `Unable to rename session ${sessionID}`, error })),
            )
          },
        })
        draft.add({
          name: "session_move",
          description:
            "Move a session to another directory, or omit sessionID to move the current session. The current session moves at the next safe boundary; do not run destination-dependent tools in the same execute call.",
          input: MoveInput,
          output: MoveOutput,
          options: { namespace: "opencode", codemode: true, pinned: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              const sessionID = input.sessionID ?? context.sessionID
              yield* ctx.session.move({
                sessionID,
                directory: input.directory,
                delivery: "steer",
              })
              return {
                output: { sessionID, directory: input.directory },
                content: `Moved session ${sessionID} to ${input.directory}.`,
              }
            }).pipe(
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to move session to ${input.directory}`, error }),
              ),
            ),
        })
        draft.add({
          name: "models",
          description: "List the models available to use.",
          input: ModelsInput,
          output: ModelsOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input) =>
            ctx.model.list().pipe(
              Effect.map((list) => {
                const offset = input.offset ?? 0
                const limit = input.limit ?? 20
                const matching = list.data
                  .filter((model) => input.provider === undefined || model.providerID === input.provider)
                  .toSorted((left, right) => right.time.released - left.time.released)
                const models = matching.slice(offset, offset + limit).map((model) => ({
                  id: `${model.providerID}/${model.id}`,
                  name: model.name,
                  released: model.time.released,
                  variants: model.variants.map((variant) => variant.id),
                  cost: model.cost,
                  status: model.status,
                }))
                return {
                  output: {
                    models,
                    total: matching.length,
                    next: offset + limit < matching.length ? offset + limit : null,
                  },
                }
              }),
              Effect.mapError((error) => new ToolFailure({ message: "Unable to list models", error })),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
