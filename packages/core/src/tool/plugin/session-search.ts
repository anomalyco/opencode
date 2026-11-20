export * as SessionSearchTools from "./session-search.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Session } from "@opencode/schema/session"
import { Effect, Schema } from "effect"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Flag } from "../../flag.js"
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
  subagents: Schema.optionalKey(Schema.Boolean).annotate({
    description: "When listing, include subagent sessions (default false). Searches include them by default.",
  }),
  limit: Schema.optionalKey(Schema.Int).annotate({
    description: "Max sessions. Default 5 when searching (max 20), 20 when listing (max 100).",
  }),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).annotate({
    description: "When listing, skip this many sessions.",
  }),
})

export const ReadInput = Schema.Struct({
  sessionID: Session.ID.annotate({ description: "Session to read." }),
  messageID: Schema.optionalKey(SessionMessage.ID).annotate({
    description: "Anchor message, from session.search or a cursor. Omit to start from the newest or oldest message.",
  }),
  direction: Schema.optionalKey(Schema.Literals(["around", "before", "after"])).annotate({
    description:
      'Which messages to read relative to the anchor (default "around"). Without messageID, "around" and "before" read the newest messages and "after" the oldest.',
  }),
  limit: Schema.optionalKey(Schema.Int).annotate({
    description: "Number of messages. Default 7, at most 50.",
  }),
  full: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Show each tool call's full input, output and error, and include system messages. Default false.",
  }),
})

export const Plugin = {
  id: "opencode.tool.session-search",
  effect: Effect.fn("SessionSearchTools.Plugin")(function* (ctx: Context) {
    const config = yield* Config.Service
    const search = yield* SessionSearch.Service
    // Internal plugins are not re-run on config changes, so reload the tool transform instead.
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.tool.reload())
    const flags = yield* Flag.Service
    const enabled = () => flags.resolve(loaded.entries).sqlite_fts.enabled
    const failure = (error: { readonly message: string }) => new ToolFailure({ message: error.message, error })

    yield* ctx.tool
      .transform((editor) => {
        if (!enabled()) return
        editor.add({
          name: "search",
          description:
            'Find the user\'s past sessions, in this project unless scope is "all". With query: full-text search over session titles, user and assistant messages, and compaction summaries. Matches any query word, ranked so messages with more and rarer words come first; supports "exact phrase", prefix*, AND, OR, NOT. Returns the best-matching sessions with up to 3 snippets and messageIDs each. Without query: lists sessions, most recently updated first. Filter either way by directory. Follow up with opencode.session.read({ sessionID, messageID }).',
          input: SearchInput,
          output: SessionSearch.SearchOutput,
          options: { namespace: "opencode.session", codemode: true },
          execute: (input) =>
            search
              .search({ ...input, projectID: input.scope === "all" ? undefined : ctx.location.project.id })
              .pipe(
                Effect.map((output) => ({ output })),
                Effect.mapError(failure),
              ),
        })
        editor.add({
          name: "read",
          description:
            'Read messages from one session, including history from before compaction. With messageID (from opencode.session.search), returns messages around it; direction "before" or "after" reads only one side. Without messageID, reads the newest messages, or the oldest with direction "after". Tool calls are one-line summaries in calls unless full is true. To keep reading, pass older as messageID with direction "before", or newer with direction "after"; pages never repeat.',
          input: ReadInput,
          output: SessionSearch.ReadOutput,
          options: { namespace: "opencode.session", codemode: true },
          execute: (input) =>
            search.read(input).pipe(
              Effect.map((output) => ({ output })),
              Effect.mapError(failure),
            ),
        })
      })
      .pipe(Effect.orDie)
  }),
}
