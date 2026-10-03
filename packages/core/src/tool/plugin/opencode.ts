export * as OpenCodeTools from "./opencode.js"

import { SystemPart, ToolFailure } from "@opencode/ai"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Model } from "@opencode/schema/model"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "../../session.js"
import { SessionMessage } from "@opencode/schema/session-message"
import { DateTime, Effect, Schema } from "effect"

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

export const SessionListInput = Schema.Struct({
  search: Schema.optionalKey(Schema.String).annotate({ description: "Optional title substring." }),
  rootsOnly: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Return only top-level sessions. Defaults to true.",
  }),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 }))).annotate({
    description: "Maximum sessions to return. Defaults to 5.",
  }),
})

const SessionSummary = Schema.Struct({
  id: Session.ID,
  parentID: Schema.optionalKey(Session.ID),
  title: Schema.optionalKey(Schema.String),
  agent: Schema.optionalKey(Schema.String),
  directory: Schema.String,
  updated: Schema.Number,
  outcome: Schema.optionalKey(Schema.String),
})

const SessionListOutput = Schema.Struct({ sessions: Schema.Array(SessionSummary), count: Schema.Int })

export const SessionExcerptInput = Schema.Struct({
  sessionID: Session.ID,
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))).annotate({
    description: "Maximum recent messages to inspect. Defaults to 12.",
  }),
  maxChars: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 2_000 }))).annotate({
    description: "Maximum text characters returned per message. Defaults to 500.",
  }),
  includeTools: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Include tool names and terminal statuses. Tool inputs and outputs are never returned.",
  }),
})

const SessionExcerptEntry = Schema.Struct({
  id: SessionMessage.ID,
  type: Schema.String,
  created: Schema.Number,
  text: Schema.String,
  truncated: Schema.Boolean,
  tools: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String }))),
})

const SessionExcerptOutput = Schema.Struct({
  sessionID: Session.ID,
  messages: Schema.Array(SessionExcerptEntry),
  count: Schema.Int,
})

const textExcerpt = (text: string, limit: number) => {
  const chars = Array.from(text)
  return chars.length <= limit ? { text, truncated: false } : { text: chars.slice(0, limit).join(""), truncated: true }
}

const messageExcerpt = (message: SessionMessage.Info, maxChars: number, includeTools: boolean) => {
  const text = (() => {
    switch (message.type) {
      case "user":
      case "synthetic":
      case "system":
      case "skill":
        return message.text
      case "assistant":
        return message.content
          .filter((item): item is SessionMessage.AssistantText => item.type === "text")
          .map((item) => item.text)
          .join("\n")
      default:
        return ""
    }
  })()
  const excerpt = textExcerpt(text, maxChars)
  const tools =
    includeTools && message.type === "assistant"
      ? message.content.flatMap((item) =>
          item.type === "tool" ? [{ name: item.name, status: item.state.status }] : [],
        )
      : []
  if (!excerpt.text && tools.length === 0) return
  return {
    id: message.id,
    type: message.type,
    created: DateTime.toEpochMillis(message.time.created),
    ...excerpt,
    ...(tools.length === 0 ? {} : { tools }),
  }
}

export const Plugin = {
  id: "opencode.tools",
  effect: Effect.fn("OpenCodeTools.Plugin")(function* (ctx: Context) {
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
        draft.add({
          name: "session_list",
          description:
            "List recent sessions as compact structured data. Use inside execute to select sessions before reading excerpts; return only the final summary needed by the user.",
          input: SessionListInput,
          output: SessionListOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input) =>
            sessions
              .list({
                limit: input.limit ?? 5,
                order: "desc",
                ...(input.search === undefined ? {} : { search: input.search }),
                ...((input.rootsOnly ?? true) ? { parentID: null } : {}),
              })
              .pipe(
                Effect.map(({ data }) => {
                  const sessions = data.map((session) => ({
                    id: session.id,
                    ...(session.parentID === undefined ? {} : { parentID: session.parentID }),
                    ...(session.title === undefined ? {} : { title: session.title }),
                    ...(session.agent === undefined ? {} : { agent: session.agent }),
                    directory: session.location.directory,
                    updated: DateTime.toEpochMillis(session.time.updated),
                    ...(session.outcome === undefined ? {} : { outcome: session.outcome }),
                  }))
                  const output = { sessions, count: sessions.length }
                  return { output }
                }),
              ),
        })
        draft.add({
          name: "session_excerpt",
          description:
            "Read compact recent text from one session. Text is capped per message; reasoning, tool inputs, and tool outputs are omitted. Use inside execute and return only relevant evidence.",
          input: SessionExcerptInput,
          output: SessionExcerptOutput,
          options: { namespace: "opencode", codemode: true },
          execute: (input) => {
            const limit = input.limit ?? 12
            const maxChars = input.maxChars ?? 500
            return sessions.messages({ sessionID: input.sessionID, limit, order: "desc" }).pipe(
              Effect.map((data) => {
                const messages = data.toReversed().flatMap((message) => {
                  const excerpt = messageExcerpt(message, maxChars, input.includeTools ?? false)
                  return excerpt === undefined ? [] : [excerpt]
                })
                const output = { sessionID: input.sessionID, messages, count: messages.length }
                return { output }
              }),
              Effect.mapError((error) => new ToolFailure({ message: "Unable to read session excerpt", error })),
            )
          },
        })
      })
      .pipe(Effect.orDie)
  }),
}
