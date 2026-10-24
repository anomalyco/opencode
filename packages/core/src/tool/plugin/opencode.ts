export * as OpenCodeTools from "./opencode.js"

import { SystemPart, ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { AbsolutePath } from "@opencode/schema/schema"
import { DateTime, Effect, Schema } from "effect"
import { FileAccess } from "../../file-access.js"
import { Git } from "../../git.js"
import { Permission } from "../../permission.js"
import { Session } from "../../session.js"
import type { SessionMessage } from "../../session/message.js"
import { SessionRecentText } from "../../session/recent-text.js"
import { Worktree } from "../../worktree.js"

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

export const SessionListInput = Schema.Struct({
  search: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1))).annotate({
    description: "Words to find in session titles and messages. Every word must match.",
  }),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))).annotate({
    description: "Maximum number of sessions. Defaults to 20.",
  }),
  cursor: Schema.optionalKey(Session.ListCursor).annotate({
    description: "Cursor from a previous response, to list the next page. Searches return a single page.",
  }),
})

const SessionListOutput = Schema.Struct({
  sessions: Schema.Array(
    Schema.Struct({
      sessionID: Session.ID,
      title: Schema.optional(Schema.String),
      directory: Schema.String,
      parentID: Schema.optional(Session.ID),
      updated: Schema.String.annotate({ description: "ISO 8601 time, UTC." }),
      messages: Schema.Number.annotate({ description: "Number of messages in the session." }),
      matches: Schema.optional(
        Schema.Array(
          Schema.Struct({
            index: Schema.Number.annotate({
              description: "Pass as session_read's offset, or a little lower for context.",
            }),
            snippet: Schema.String,
          }),
        ),
      ).annotate({ description: "Messages that matched the search, newest first." }),
    }),
  ).annotate({ description: "Most recently updated first." }),
  cursor: Schema.optional(Session.ListCursor).annotate({ description: "Omitted on the last page." }),
})

export const SessionReadInput = Schema.Struct({
  sessionID: Session.ID,
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))).annotate({
    description: "Maximum number of messages. Defaults to 20.",
  }),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "Index of the first message to read, counting from 0. Omit to read the latest messages.",
  }),
  tools: Schema.optionalKey(Schema.Boolean).annotate({ description: "Include tool calls and their output." }),
})

const SessionReadOutput = Schema.Struct({
  total: Schema.Number.annotate({ description: "Number of messages in the session. Indexes run from 0 to total - 1." }),
  messages: Schema.Array(
    Schema.Struct({
      index: Schema.Number,
      role: Schema.String,
      text: Schema.optional(Schema.String),
      tools: Schema.optional(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            input: Schema.String,
            output: Schema.optional(Schema.String),
            error: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ).annotate({
    description: "Oldest first. Long text is shortened. Hidden messages, such as agent switches, still use an index.",
  }),
})

export const WorktreeCreateInput = Schema.Struct({
  name: Schema.Trim.check(Schema.isNonEmpty()).annotate({ description: "Worktree name." }),
})

export const WorktreeRemoveInput = Schema.Struct({
  directory: AbsolutePath.check(Schema.isMinLength(1)).annotate({
    description: "Absolute path of the worktree to remove.",
  }),
  force: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Discard modified and untracked files. Only set this when the user has confirmed forced removal.",
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
    const sessions = yield* Session.Service
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
          name: "session_list",
          description:
            "List sessions across all projects, most recently updated first. With search, find sessions whose title or messages mention something, then pass a match's index as session_read's offset to read that part of the conversation, including history from before compaction.",
          input: SessionListInput,
          output: SessionListOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input) =>
            Effect.gen(function* () {
              const limit = input.limit ?? 20
              if (input.search === undefined) {
                const page = yield* sessions.list({ limit, cursor: input.cursor })
                const counts = yield* sessions.counts(page.data.map((session) => session.id))
                return {
                  output: {
                    sessions: page.data.map((session) => listEntry(session, counts.get(session.id) ?? 0)),
                    cursor: page.cursor.next,
                  },
                }
              }
              const search = input.search
              const titled = (yield* sessions.list({ search, limit })).data
              const found = yield* sessions.search({ query: search, limit: 200 })
              const matches = Map.groupBy(found, (hit) => hit.sessionID)
              const others = yield* Effect.forEach(
                Array.from(matches.keys()).filter((id) => !titled.some((session) => session.id === id)),
                (id) => sessions.get(id).pipe(Effect.option),
              )
              const listed = [
                ...titled,
                ...others.flatMap((session) => (session._tag === "Some" ? [session.value] : [])),
              ]
                .toSorted(
                  (left, right) =>
                    DateTime.toEpochMillis(right.time.updated) - DateTime.toEpochMillis(left.time.updated),
                )
                .slice(0, limit)
              const counts = yield* sessions.counts(listed.map((session) => session.id))
              return {
                output: {
                  sessions: listed.map((session) =>
                    listEntry(
                      session,
                      counts.get(session.id) ?? 0,
                      matches
                        .get(session.id)
                        ?.slice(0, 3)
                        .map((hit) => ({ index: hit.index, snippet: snippet(messageText(hit.message), search) })),
                    ),
                  ),
                },
              }
            }).pipe(Effect.mapError((error) => new ToolFailure({ message: "Unable to list sessions", error }))),
        })
        draft.add({
          name: "session_read",
          description:
            "Read a session's messages by index, including those from before compaction. Omit offset to read the latest messages, or pass a session_list match's index, or a little lower for context, to read that part of the conversation.",
          input: SessionReadInput,
          output: SessionReadOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input) =>
            sessions.page({ sessionID: input.sessionID, offset: input.offset, limit: input.limit ?? 20 }).pipe(
              Effect.map((page) => ({
                output: {
                  total: page.total,
                  messages: page.messages.flatMap(
                    (entry) => readEntry(entry.index, entry.message, input.tools === true) ?? [],
                  ),
                },
              })),
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to read session ${input.sessionID}`, error }),
              ),
            ),
        })
        draft.add({
          name: "worktree_create",
          description: "Create a named worktree. Returns its directory.",
          input: WorktreeCreateInput,
          output: Worktree.Info,
          options: { namespace: "opencode", codemode: true, pinned: true },
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
          options: { namespace: "opencode", codemode: true, pinned: true },
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
          options: { namespace: "opencode", codemode: true, pinned: true, permission: "edit" },
          execute: (input, context) =>
            Effect.gen(function* () {
              // Removing a worktree deletes files, so it requires the same approval as editing them.
              const target = yield* access.resolve({ path: input.directory, kind: "directory" })
              yield* permission.assert({
                action: "edit",
                resources: [target.resource],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              yield* ctx.worktree
                .remove({
                  projectID: ctx.location.project.id,
                  directory: target.absolute,
                  force: input.force ?? false,
                })
                .pipe(Effect.mapError((error) => new ToolFailure({ message: removeFailure(target.absolute, error) })))
              return {
                output: { directory: target.absolute, removed: true },
                content: `Removed worktree ${target.absolute}.`,
              }
            }).pipe(
              Effect.mapError((error) =>
                error instanceof ToolFailure
                  ? error
                  : new ToolFailure({ message: `Unable to remove worktree ${input.directory}`, error }),
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

const TEXT_MAX_CHARS = 10_000

function listEntry(
  session: Session.Info,
  messages: number,
  matches?: ReadonlyArray<{ index: number; snippet: string }>,
) {
  return {
    sessionID: session.id,
    title: session.title,
    directory: session.location.directory,
    parentID: session.parentID,
    updated: DateTime.formatIso(session.time.updated),
    messages,
    matches,
  }
}

function messageText(message: SessionMessage.Info) {
  if (message.type === "user") return message.text
  if (message.type !== "assistant") return ""
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
}

// A short window of the text around the first matching word.
function snippet(text: string, search: string) {
  const flat = text.replace(/\s+/g, " ").trim()
  const lower = flat.toLowerCase()
  const index = Math.max(
    0,
    Math.min(
      ...search
        .toLowerCase()
        .split(/\s+/)
        .map((term) => lower.indexOf(term))
        .filter((index) => index >= 0),
    ),
  )
  const start = Math.max(0, index - 60)
  const end = Math.min(flat.length, index + 140)
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`
}

function clip(text: string) {
  if (text.length <= TEXT_MAX_CHARS) return text
  return `${text.slice(0, TEXT_MAX_CHARS)}… [${text.length - TEXT_MAX_CHARS} more characters]`
}

function readEntry(index: number, message: SessionMessage.Info, tools: boolean) {
  if (message.type === "user" || message.type === "synthetic" || message.type === "system" || message.type === "skill")
    return { index, role: message.type, text: clip(message.text) }
  if (message.type === "compaction")
    return message.status === "completed" ? { index, role: "compaction", text: clip(message.summary) } : undefined
  if (message.type === "shell")
    return tools
      ? {
          index,
          role: "shell",
          text: clip([`$ ${message.command}`, message.output?.output].filter(Boolean).join("\n")),
        }
      : undefined
  if (message.type !== "assistant") return undefined
  const text = messageText(message)
  const calls = tools
    ? message.content.flatMap((part) => {
        if (part.type !== "tool") return []
        return [
          {
            name: part.name,
            input: SessionRecentText.truncateToolOutput(
              typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input),
            ),
            output:
              (part.state.status === "completed" || part.state.status === "error") && part.state.content
                ? SessionRecentText.truncateToolOutput(SessionRecentText.serializeToolContent(part.state.content))
                : undefined,
            error: part.state.status === "error" ? part.state.error.message : undefined,
          },
        ]
      })
    : []
  if (!text && calls.length === 0) return undefined
  return {
    index,
    role: "assistant",
    text: text ? clip(text) : undefined,
    tools: calls.length > 0 ? calls : undefined,
  }
}

// Worktree errors carry no model-facing message, and Git's own text suggests forcing removal.
function removeFailure(directory: string, error: unknown) {
  if (error instanceof Worktree.DirectoryUnavailableError)
    return `Unable to remove worktree ${directory}: the directory does not exist or is not a directory.`
  if (error instanceof Worktree.InvalidDirectoryError)
    return `Unable to remove ${directory}: it is not a worktree of this project. Use worktree_list to see the project's worktrees.`
  if (error instanceof Worktree.StrategyUnavailableError)
    return `Unable to remove worktree ${directory}: its worktree strategy ${error.strategy} is not available.`
  if ((error instanceof Git.WorktreeError || error instanceof Worktree.OperationError) && error.forceRequired)
    return `Unable to remove worktree ${directory}: it has modified or untracked files.`
  return `Unable to remove worktree ${directory}.`
}
