export * as OpenCodeTools from "./opencode.js"

import { SystemPart, ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { Worktree } from "@opencode/schema/worktree"
import { Effect, Schema } from "effect"
import { FileAccess } from "../../file-access.js"
import { Permission } from "../../permission.js"

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

export const WorktreeCreateInput = Schema.Struct({
  name: Schema.Trim.check(Schema.isNonEmpty()).annotate({ description: "Worktree name." }),
})

export const WorktreeRemoveInput = Schema.Struct({
  directory: AbsolutePath.check(Schema.isMinLength(1)).annotate({
    description: "Absolute path of the worktree to remove.",
  }),
  force: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Force removal, including uncommitted changes. Defaults to false.",
  }),
})

const WorktreeRemoveOutput = Schema.Struct({ directory: AbsolutePath, removed: Schema.Boolean })

export const ModelsInput = Schema.Struct({
  query: Schema.optionalKey(Schema.String).annotate({
    description: "Text to search for in model names and IDs.",
  }),
  provider: Schema.optionalKey(Schema.String).annotate({
    description: "Provider ID or name to filter by. Try your own provider first.",
  }),
  all: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Include older versions of each model family. By default only the newest version is listed.",
  }),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))).annotate({
    description: "Maximum number of models to return. Defaults to 20.",
  }),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "Number of models to skip, for paging through results.",
  }),
})

const ModelEntry = Schema.Struct({
  id: Schema.String.annotate({ description: "providerID/modelID" }),
  name: Schema.String,
  released: Model.Info.fields.time.fields.released.annotate({
    description: "Release date as a Unix timestamp in milliseconds, or 0 when unknown.",
  }),
  variants: Schema.Array(Model.VariantID),
  cost: Model.Info.fields.cost.annotate({ description: "Pricing in USD per million tokens." }),
  status: Model.Info.fields.status,
})

const ModelsOutput = Schema.Struct({
  providers: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      models: Schema.Array(ModelEntry).annotate({ description: "Newest first." }),
    }),
  ).annotate({ description: "Matching models grouped by provider. Your own provider comes first." }),
  total: Schema.Int.annotate({ description: "Number of matching models across all pages." }),
  next: Schema.NullOr(Schema.Int).annotate({ description: "Offset of the next page, or null on the last page." }),
})

export const Plugin = {
  id: "opencode.tools",
  effect: Effect.fn("OpenCodeTools.Plugin")(function* (ctx: Context) {
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service
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
        draft.namespace({
          name: "opencode",
          description:
            "Tools for managing OpenCode itself, such as working with sessions and worktrees, searching the available models, and reading MCP resources.",
        })
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
            return ctx.session.update({ sessionID, title }).pipe(
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
          name: "worktree_create",
          description: "Create a named worktree. Returns its directory.",
          input: WorktreeCreateInput,
          output: Worktree.Info,
          options: { namespace: "opencode", codemode: true },
          execute: (input) =>
            ctx.worktree.create({ projectID: ctx.location.project.id, name: input.name }).pipe(
              Effect.map((output) => ({ output, content: `Created worktree in ${output.directory}.` })),
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to create worktree ${input.name}`, error }),
              ),
            ),
        })
        draft.add({
          name: "worktree_list",
          description: "List a repository's worktrees.",
          input: Schema.Struct({}),
          output: Schema.Struct({ worktrees: Worktree.List }),
          options: { namespace: "opencode", codemode: true },
          execute: () =>
            ctx.worktree.list({ projectID: ctx.location.project.id }).pipe(
              Effect.map((worktrees) => ({ output: { worktrees } })),
              Effect.mapError((error) => new ToolFailure({ message: "Unable to list worktrees", error })),
            ),
        })
        draft.add({
          name: "worktree_remove",
          description:
            "Remove a worktree. The repository location selects configuration; directory identifies the worktree to remove.",
          input: WorktreeRemoveInput,
          output: WorktreeRemoveOutput,
          options: { namespace: "opencode", codemode: true, permission: "edit" },
          execute: (input, context) =>
            Effect.gen(function* () {
              // Removing a worktree deletes files, so it requires the same approval as editing them.
              const target = yield* access.resolve({ path: input.directory, kind: "directory" })
              yield* access.authorizeExternal([target], context)
              yield* permission.assert({
                action: "edit",
                resources: [target.resource],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              yield* ctx.worktree.remove({
                projectID: ctx.location.project.id,
                directory: input.directory,
                force: input.force ?? false,
              })
              return {
                output: { directory: input.directory, removed: true },
                content: `Removed worktree ${input.directory}.`,
              }
            }).pipe(
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to remove worktree ${input.directory}`, error }),
              ),
            ),
        })
        draft.add({
          name: "models",
          description:
            "Search the models available to use. Use this to turn a model name the user mentions into an exact reference before running a subagent on it. Check your own provider first.",
          input: ModelsInput,
          output: ModelsOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              const offset = input.offset ?? 0
              const limit = input.limit ?? 20
              const own = (yield* ctx.session.get({ sessionID: context.sessionID })).model?.providerID
              const terms = input.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? []
              const names = new Map((yield* ctx.provider.list()).data.map((provider) => [provider.id, provider.name]))
              const provider = input.provider?.toLowerCase()
              const matching = (yield* ctx.model.list()).data
                .filter(
                  (model) =>
                    provider === undefined ||
                    model.providerID.toLowerCase() === provider ||
                    names.get(model.providerID)?.toLowerCase() === provider,
                )
                .filter((model) => {
                  const text = `${model.providerID}/${model.id} ${model.name}`.toLowerCase()
                  return terms.every((term) => text.includes(term))
                })
                .toSorted(
                  (left, right) =>
                    Number(right.providerID === own) - Number(left.providerID === own) ||
                    left.providerID.localeCompare(right.providerID) ||
                    right.time.released - left.time.released,
                )
                .filter((model, index, sorted) => {
                  if (input.all || model.family === undefined) return true
                  return (
                    sorted.findIndex(
                      (other) => other.providerID === model.providerID && other.family === model.family,
                    ) === index
                  )
                })
              const page = matching.slice(offset, offset + limit)
              const providers = Array.from(new Set(page.map((model) => model.providerID))).map((id) => ({
                id,
                name: names.get(id) ?? id,
                models: page
                  .filter((model) => model.providerID === id)
                  .map((model) => ({
                    id: `${model.providerID}/${model.id}`,
                    name: model.name,
                    released: model.time.released,
                    variants: model.variants.map((variant) => variant.id),
                    cost: model.cost,
                    status: model.status,
                  })),
              }))
              return {
                output: {
                  providers,
                  total: matching.length,
                  next: offset + limit < matching.length ? offset + limit : null,
                },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to list models", error }))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
