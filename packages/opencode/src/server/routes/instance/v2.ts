import { SessionID } from "@/session/schema"
import { SessionMessage } from "@/v2/session-message"
import { SessionV2 } from "@/v2/session"
import { zod } from "@/util/effect-zod"
import { lazy } from "@/util/lazy"
import { Effect, Schema } from "effect"
import * as DateTime from "effect/DateTime"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import { errors } from "../../error"
import { jsonRequest } from "./trace"

const DefaultMessagesLimit = 50

const Cursor = Schema.Struct({
  id: SessionMessage.ID,
  time: Schema.Number,
  from: Schema.Union([Schema.Literal("start"), Schema.Literal("end")]),
})

const MessagesResponse = Schema.Struct({
  items: Schema.Array(SessionMessage.Message),
  cursor: Schema.Struct({
    before: Schema.String.pipe(Schema.optional),
    after: Schema.String.pipe(Schema.optional),
  }),
}).annotate({ identifier: "V2SessionMessagesResponse" })

const decodeCursor = Schema.decodeUnknownSync(Cursor)

const cursor = {
  encode(message: SessionMessage.Message, from: "start" | "end") {
    return Buffer.from(
      JSON.stringify({ id: message.id, time: DateTime.toEpochMillis(message.time.created), from }),
    ).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

export const V2Routes = lazy(() =>
  new Hono().get(
    "/session/:sessionID/message",
    describeRoute({
      summary: "Get v2 session messages",
      description: "Retrieve projected v2 messages for a session directly from the message database.",
      operationId: "v2.session.messages",
      responses: {
        200: {
          description: "List of v2 session messages",
          content: {
            "application/json": {
              schema: resolver(zod(MessagesResponse)),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    validator(
      "query",
      z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const query = c.req.valid("query")
      const decoded = (() => {
        try {
          return query.cursor && query.cursor !== "start" && query.cursor !== "end"
            ? cursor.decode(query.cursor)
            : undefined
        } catch {
          throw new HTTPException(400)
        }
      })()
      return jsonRequest("V2Routes.messages", c, function* () {
        return yield* Effect.gen(function* () {
          const session = yield* SessionV2.Service
          const messages = yield* session.messages({
            sessionID,
            limit: query.limit ?? DefaultMessagesLimit,
            from: decoded?.from ?? (query.cursor === "start" ? "start" : "end"),
            cursor: decoded ? { id: decoded.id, time: decoded.time } : undefined,
          })
          const oldest = messages[0]
          const newest = messages.at(-1)
          return {
            items: messages,
            cursor: {
              before: oldest ? cursor.encode(oldest, "end") : undefined,
              after: newest ? cursor.encode(newest, "start") : undefined,
            },
          }
        }).pipe(Effect.provide(SessionV2.defaultLayer))
      })
    },
  ),
)
