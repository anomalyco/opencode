import { SessionID } from "@/session/schema"
import { SessionMessage } from "@/v2/session-message"
import { SessionV2 } from "@/v2/session"
import { zod } from "@/util/effect-zod"
import { lazy } from "@/util/lazy"
import { Effect, Schema } from "effect"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { errors } from "../../error"
import { jsonRequest } from "./trace"

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
              schema: resolver(zod(Schema.Array(SessionMessage.Message))),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator("param", z.object({ sessionID: SessionID.zod })),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      return jsonRequest("V2Routes.messages", c, function* () {
        return yield* Effect.gen(function* () {
          const session = yield* SessionV2.Service
          return yield* session.messages({ sessionID })
        }).pipe(Effect.provide(SessionV2.defaultLayer))
      })
    },
  ),
)
