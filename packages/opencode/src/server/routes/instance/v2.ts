import { WorkspaceID } from "@/control-plane/schema"
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
const DefaultSessionsLimit = 50

const SessionCursor = Schema.Struct({
  id: SessionID,
  time: Schema.Number,
  order: Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")]),
  direction: Schema.Union([Schema.Literal("previous"), Schema.Literal("next")]),
  directory: Schema.String.pipe(Schema.optional),
  path: Schema.String.pipe(Schema.optional),
  workspaceID: WorkspaceID.pipe(Schema.optional),
  roots: Schema.Boolean.pipe(Schema.optional),
  start: Schema.Number.pipe(Schema.optional),
  search: Schema.String.pipe(Schema.optional),
})
type SessionCursor = typeof SessionCursor.Type

const SessionsResponse = Schema.Struct({
  items: Schema.Array(SessionV2.Info),
  cursor: Schema.Struct({
    previous: Schema.String.pipe(Schema.optional),
    next: Schema.String.pipe(Schema.optional),
  }),
}).annotate({ identifier: "V2SessionsResponse" })

const Cursor = Schema.Struct({
  id: SessionMessage.ID,
  time: Schema.Number,
  order: Schema.Union([Schema.Literal("asc"), Schema.Literal("desc")]),
  direction: Schema.Union([Schema.Literal("previous"), Schema.Literal("next")]),
})

const MessagesResponse = Schema.Struct({
  items: Schema.Array(SessionMessage.Message),
  cursor: Schema.Struct({
    previous: Schema.String.pipe(Schema.optional),
    next: Schema.String.pipe(Schema.optional),
  }),
}).annotate({ identifier: "V2SessionMessagesResponse" })

const decodeCursor = Schema.decodeUnknownSync(Cursor)
const decodeSessionCursor = Schema.decodeUnknownSync(SessionCursor)

const sessionCursor = {
  encode(
    session: SessionV2.Info,
    order: "asc" | "desc",
    direction: "previous" | "next",
    filters: Pick<SessionCursor, "directory" | "path" | "workspaceID" | "roots" | "start" | "search">,
  ) {
    return Buffer.from(
      JSON.stringify({ id: session.id, time: session.time.created, order, direction, ...filters }),
    ).toString("base64url")
  },
  decode(input: string) {
    return decodeSessionCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

const cursor = {
  encode(message: SessionMessage.Message, order: "asc" | "desc", direction: "previous" | "next") {
    return Buffer.from(
      JSON.stringify({ id: message.id, time: DateTime.toEpochMillis(message.time.created), order, direction }),
    ).toString("base64url")
  },
  decode(input: string) {
    return decodeCursor(JSON.parse(Buffer.from(input, "base64url").toString("utf8")))
  },
}

export const V2Routes = lazy(() =>
  new Hono()
    .get(
      "/session",
      describeRoute({
        summary: "List v2 sessions",
        description:
          "Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.",
        operationId: "v2.session.list",
        responses: {
          200: {
            description: "List of v2 sessions",
            content: {
              "application/json": {
                schema: resolver(zod(SessionsResponse)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().int().min(1).max(200).optional(),
          cursor: z.string().optional(),
          order: z.enum(["asc", "desc"]).optional(),
          directory: z.string().optional(),
          path: z.string().optional(),
          workspace: WorkspaceID.zod.optional(),
          roots: z
            .enum(["true", "false"])
            .transform((value) => value === "true")
            .optional(),
          start: z.coerce.number().optional(),
          search: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const decoded = (() => {
          try {
            return query.cursor ? sessionCursor.decode(query.cursor) : undefined
          } catch {
            throw new HTTPException(400)
          }
        })()
        const order = decoded?.order ?? query.order ?? "desc"
        const filters = decoded ?? {
          directory: query.directory,
          path: query.path,
          workspaceID: query.workspace,
          roots: query.roots,
          start: query.start,
          search: query.search,
        }
        return jsonRequest("V2Routes.sessions", c, function* () {
          return yield* Effect.gen(function* () {
            const session = yield* SessionV2.Service
            const sessions = yield* session.list({
              limit: query.limit ?? DefaultSessionsLimit,
              order,
              directory: filters.directory,
              path: filters.path,
              workspaceID: filters.workspaceID,
              roots: filters.roots,
              start: filters.start,
              search: filters.search,
              cursor: decoded ? { id: decoded.id, time: decoded.time, direction: decoded.direction } : undefined,
            })
            const first = sessions[0]
            const last = sessions.at(-1)
            return {
              items: sessions,
              cursor: {
                previous: first ? sessionCursor.encode(first, order, "previous", filters) : undefined,
                next: last ? sessionCursor.encode(last, order, "next", filters) : undefined,
              },
            }
          }).pipe(Effect.provide(SessionV2.defaultLayer))
        })
      },
    )
    .get(
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
          order: z.enum(["asc", "desc"]).optional(),
        }),
      ),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const query = c.req.valid("query")
        const decoded = (() => {
          try {
            return query.cursor ? cursor.decode(query.cursor) : undefined
          } catch {
            throw new HTTPException(400)
          }
        })()
        const order = decoded?.order ?? query.order ?? "desc"
        return jsonRequest("V2Routes.messages", c, function* () {
          return yield* Effect.gen(function* () {
            const session = yield* SessionV2.Service
            const messages = yield* session.messages({
              sessionID,
              limit: query.limit ?? DefaultMessagesLimit,
              order,
              cursor: decoded ? { id: decoded.id, time: decoded.time, direction: decoded.direction } : undefined,
            })
            const first = messages[0]
            const last = messages.at(-1)
            return {
              items: messages,
              cursor: {
                previous: first ? cursor.encode(first, order, "previous") : undefined,
                next: last ? cursor.encode(last, order, "next") : undefined,
              },
            }
          }).pipe(Effect.provide(SessionV2.defaultLayer))
        })
      },
    ),
)
