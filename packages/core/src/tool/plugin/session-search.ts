export * as SessionSearchTools from "./session-search.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
import { Permission } from "../../permission.js"
import { SessionMessage } from "../../session/message.js"
import { SessionSearch } from "../../session/search.js"

export const SearchInput = Schema.Struct({
  query: Schema.optionalKey(Schema.String).annotate({
    description: "Distinctive keywords, names, numbers or phrases. Omit to list sessions.",
  }),
  scope: Schema.optionalKey(Schema.Literals(["project", "all"])).annotate({
    description: 'Which sessions to cover: "project" (default) for this project, "all" for every project.',
  }),
  sessionID: Schema.optionalKey(Session.ID).annotate({
    description: "Search only inside this session, in any project.",
  }),
  directory: Schema.optionalKey(Schema.String).annotate({
    description: "Only sessions in this directory or below it.",
  }),
  after: Schema.optionalKey(Schema.String).annotate({
    description: "Only sessions active at or after this time: ISO date (2026-11-15) or duration ago (7d, 24h, 2w).",
  }),
  before: Schema.optionalKey(Schema.String).annotate({
    description: "Only sessions created before this time: ISO date or duration ago.",
  }),
  children: Schema.optionalKey(Schema.Boolean).annotate({
    description: "When listing, include subagent sessions (default false). Searches include them by default.",
  }),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))).annotate({
    description: "Max sessions. Default 5 when searching (max 20), 20 when listing (max 100).",
  }),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "When listing, skip this many sessions.",
  }),
})

export const ReadInput = Schema.Struct({
  sessionID: Session.ID.annotate({ description: "Session to read." }),
  messageID: Schema.optionalKey(SessionMessage.ID).annotate({
    description: "Center the window on this message.",
  }),
  from: Schema.optionalKey(Schema.Literals(["start", "end"])).annotate({
    description: 'Without messageID: read from the start or the end (default "end").',
  }),
  before: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 }))).annotate({
    description: "Messages before the anchor. Default 3 (with messageID) or 10 (from end).",
  }),
  after: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 50 }))).annotate({
    description: "Messages after the anchor. Default 3 (with messageID) or 10 (from start).",
  }),
  includeTools: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Include tool inputs, outputs, and system messages. Default false.",
  }),
})

export const Plugin = {
  id: "opencode.tool.session-search",
  effect: Effect.fn("SessionSearchTools.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const search = yield* SessionSearch.Service
    // Internal plugins are not re-run on config changes, so reload the tool transform instead.
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const flags = yield* Flag.Service
    const enabled = () => flags.resolve(loaded.entries).sqlite_fts.enabled
    const requireEnabled = Effect.gen(function* () {
      if (yield* flags.enabled("sqlite_fts")) return
      return yield* new ToolFailure({
        message: "Session search is disabled. Enable the sqlite_fts flag to use it.",
      })
    })
    const failure = (error: { readonly message: string }) => new ToolFailure({ message: error.message, error })

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled()) return
        editor.add({
          name: "search",
          description:
            'Find the user\'s past sessions, in this project unless scope is "all". With query: full-text search over session titles, user and assistant messages, and compaction summaries. Matches any query word, ranked so messages with more and rarer words come first; supports "exact phrase", prefix*, AND, OR, NOT. Returns the best-matching sessions with up to 3 snippets and messageIDs each. Without query: lists sessions, most recently updated first. Filter either way by directory or time. Follow up with opencode.session.read({ sessionID, messageID }).',
          input: SearchInput,
          output: SessionSearch.SearchOutput,
          options: { namespace: "opencode.session", codemode: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* requireEnabled
              yield* permission.assert({
                action: "opencode_session_search",
                resources: ["*"],
                save: ["*"],
                ...Permission.invocation(context),
              })
              return {
                output: yield* search.search({
                  ...input,
                  projectID: input.scope === "all" ? undefined : ctx.location.project.id,
                }),
              }
            }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : failure(error)))),
        })
        editor.add({
          name: "read",
          description:
            'Read messages from one session, including history from before compaction. With messageID, returns a window around that message (from opencode.session.search). Without it, returns the session\'s latest messages, or its first ones with from="start". Tool calls are shown as one-line summaries unless includeTools is true. Page with olderCursor or newerCursor.',
          input: ReadInput,
          output: SessionSearch.ReadOutput,
          options: { namespace: "opencode.session", codemode: true },
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* requireEnabled
              yield* permission.assert({
                action: "opencode_session_read",
                resources: ["*"],
                save: ["*"],
                ...Permission.invocation(context),
              })
              return { output: yield* search.read(input) }
            }).pipe(Effect.mapError((error) => (error instanceof ToolFailure ? error : failure(error)))),
        })
      })
      .pipe(Effect.orDie)
  }),
}
