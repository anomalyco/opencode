import { MessagePage } from "@opencode/core/session/message-page"
import { Session } from "@opencode/core/session"
import { SessionMediaMessagesResponse } from "@opencode/protocol/groups/message"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { wantsMediaRefs } from "../media-uri"

export const MessageHandler = HttpApiBuilder.group(Api, "server.message", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    return handlers.handle(
      "session.messages",
      Effect.fn(function* (ctx) {
        const input = { ...ctx.params, ...ctx.query }
        if (wantsMediaRefs(ctx.request)) {
          const page = yield* MessagePage.list(session.messagesWithRefs, input)
          return yield* HttpServerResponse.schemaJson(SessionMediaMessagesResponse)(page).pipe(Effect.orDie)
        }
        return yield* MessagePage.list(session.messages, input)
      }),
    )
  }),
)
