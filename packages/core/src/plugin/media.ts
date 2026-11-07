export * as MediaPlugin from "./media.js"

import { define } from "@opencode/plugin/effect/plugin"
import { SessionMedia } from "@opencode/schema/session-media"
import { SessionMessage } from "@opencode/schema/session-message"
import { DateTime, Effect } from "effect"
import { Flag } from "../flag.js"
import { Session } from "../session.js"
import { SessionSchema } from "../session/schema.js"
import { collect } from "./media/collect.js"

/** How many messages a page reads when the caller does not say. */
export const DEFAULT_LIMIT = 200

/**
 * The Media panel's server half, behind the `session_media` flag: it reads a session's history a page at a time and
 * returns the images, videos and links in it, so the app lists a whole session without loading its messages.
 */
export const Plugin = define({
  id: "opencode.media",
  effect: Effect.fn(function* (ctx) {
    if (!(yield* Flag.enabled("session_media"))) return
    const session = yield* Session.Service

    yield* ctx.rpc
      .register(SessionMedia.Definition, {
        list: Effect.fn("MediaPlugin.list")(function* (input) {
          const limit = input.limit ?? DEFAULT_LIMIT
          // One extra message tells whether older ones remain.
          const messages = yield* session
            .messagesWithRefs({
              sessionID: SessionSchema.ID.make(input.sessionID),
              limit: limit + 1,
              order: "desc",
              cursor: input.cursor ? { id: SessionMessage.ID.make(input.cursor), direction: "next" } : undefined,
            })
            .pipe(
              Effect.catchTag("Session.NotFoundError", () => Effect.succeed([])),
              Effect.orDie,
            )
          const page = messages.slice(0, limit)
          const newest = page.at(0)
          const oldest = page.at(-1)

          return {
            ...collect(page),
            newest: newest && DateTime.toEpochMillis(newest.time.created),
            oldest: oldest && DateTime.toEpochMillis(oldest.time.created),
            next: messages.length > limit ? oldest?.id : undefined,
          }
        }),
      })
      .pipe(Effect.orDie)
  }),
})
