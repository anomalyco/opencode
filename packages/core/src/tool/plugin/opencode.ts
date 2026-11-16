export * as OpenCodeTools from "./opencode.js"

import { SystemPart, ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Schema } from "effect"
import path from "path"
import { FileAccess } from "../../file-access.js"
import { WorktreeStrategies } from "../../worktree/strategies.js"

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
  query: Schema.optionalKey(Schema.String).annotate({
    description: "Text to search for in model names and IDs.",
  }),
  provider: Schema.optionalKey(Schema.String).annotate({
    description: "Provider ID or name to filter by. Try your own provider first.",
  }),
  type: Schema.optionalKey(Schema.Literals(["chat", "image"])).annotate({
    description: [
      'Which kind of model to list. Defaults to "chat".',
      '"chat": a language model (LLM). Powers sessions, agents and subagents, and can call tools.',
      '"image": generates or edits images from a prompt. It can\'t chat or call tools.',
    ].join("\n"),
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
    const worktrees = yield* WorktreeStrategies.Service
    const hook = (event: SessionHooks["context"]) =>
      Effect.sync(() => {
        const worktree = worktrees.get()
        // Only for a configured directory and the built-in git strategy; a strategy plugin adds its own instructions.
        if (worktree.configured && worktree.selected === "git")
          event.system.push(SystemPart.make(guidance(worktree.directory)))
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
            "Tools for managing OpenCode itself, such as working with sessions, searching the available models, and reading MCP resources.",
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
              const session = yield* ctx.session.get({ sessionID })
              const directory = AbsolutePath.make(
                FileAccess.resolvePath(session.location.directory, input.directory.trim()),
              )
              // The destination becomes the session's internal directory, so leaving the project
              // needs the same approval as reaching outside it. The project's own worktrees don't.
              const target = yield* access.resolve({ path: directory, kind: "directory" })
              const projectID = ctx.location.project.id
              const known = ctx.worktree
                .list({ projectID })
                .pipe(
                  Effect.map((worktrees) =>
                    worktrees.some((worktree) => FSUtil.contains(worktree.directory, directory)),
                  ),
                )
              // Models create worktrees with `git worktree add`, so a new one is found by refreshing the inventory.
              const worktree =
                target.externalDirectory &&
                ((yield* known) ||
                  (yield* ctx.worktree.refresh({ projectID }).pipe(Effect.ignore, Effect.andThen(known))))
              if (!worktree) yield* access.authorizeExternal([target], context)
              yield* ctx.session.move({
                sessionID,
                directory,
                delivery: "steer",
              })
              return {
                output: { sessionID, directory },
                content: `Moved session ${sessionID} to ${directory}.`,
              }
            }).pipe(
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to move session to ${input.directory}`, error }),
              ),
            ),
        })
        draft.add({
          name: "models",
          description:
            "Search the models available to use. Use this to turn a model name the user mentions into an exact reference for a tool that takes a model. Check your own provider first.",
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
              const matching = (yield* ctx.model.list({ types: [input.type ?? "chat"] })).data
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

/** Where and how to make worktrees, from `worktree.directory`. Measured to steer models better than worktree tools. */
const guidance = (directory: string) =>
  `Unless the user asks otherwise, create worktrees in \`${directory}\` with \`git worktree add ${path.join(directory, "<name>")}\` (add \`-b <branch>\` for a new branch). List them with \`git worktree list\` and remove one with \`git worktree remove <path>\`.`
