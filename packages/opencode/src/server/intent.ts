import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { Intent } from "../intent"
import { errors } from "./error"

export const IntentRoute = new Hono()
  .post(
    "/:sessionID/:intentID",
    describeRoute({
      summary: "Respond to intent",
      description: "Submit user response to a pending intent request.",
      operationId: "intent.respond",
      responses: {
        200: {
          description: "Intent processed successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "param",
      z.object({
        sessionID: z.string(),
        intentID: z.string(),
      }),
    ),
    validator("json", z.object({ response: Intent.IntentResponse })),
    async (c) => {
      const params = c.req.valid("param")
      const sessionID = params.sessionID
      const intentID = params.intentID
      const success = Intent.respond({
        sessionID,
        intentID,
        response: c.req.valid("json").response,
      })
      if (!success) {
        return c.json({ error: "Intent not found" }, 404)
      }
      return c.json(true)
    },
  )
  .get(
    "/",
    describeRoute({
      summary: "List pending intents",
      description: "Get all pending intent requests across all sessions.",
      operationId: "intent.list",
      responses: {
        200: {
          description: "List of pending intents",
          content: {
            "application/json": {
              schema: resolver(Intent.IntentInfo.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      const intents = Intent.list()
      return c.json(intents)
    },
  )
