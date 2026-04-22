import { SessionID } from "@/session/schema"
import { Session } from "../../session"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { errors } from "../error"

export function applySessionTeamRoutes(app: Hono) {
  return app.post(
    "/:sessionID/stop-all",
    describeRoute({
      summary: "Stop all",
      description: "Stop all async tasks and cancel team plans for the session tree, then return the counts.",
      operationId: "session.stopAll",
      responses: {
        200: {
          description: "Stop all result",
          content: {
            "application/json": {
              schema: resolver(z.object({ sessions: z.number(), plans: z.number() })),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    async (c) => {
      const sessionID = c.req.valid("param").sessionID
      const result = await Session.stopAll({ sessionID })
      return c.json(result)
    },
  )
}
