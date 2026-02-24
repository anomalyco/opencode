import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Elicitation } from "../../elicitation"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const ElicitationRoutes = lazy(() =>
  new Hono()
    .post(
      "/test",
      describeRoute({
        summary: "Create a test elicitation",
        description: "Debug endpoint to create a test elicitation request for manual UI testing.",
        operationId: "elicitation.test",
        responses: {
          200: {
            description: "Elicitation reply from the user",
            content: {
              "application/json": {
                schema: resolver(Elicitation.Reply),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          sessionID: z.string(),
          mode: z.enum(["form", "url"]),
          message: z.string(),
          requestedSchema: z.record(z.string(), z.any()).optional(),
          url: z.string().optional(),
        }),
      ),
      async (c) => {
        const json = c.req.valid("json")
        const reply = await Elicitation.ask(json)
        return c.json(reply)
      },
    )
    .get(
      "/",
      describeRoute({
        summary: "List pending elicitations",
        description: "Get all pending elicitation requests across all sessions.",
        operationId: "elicitation.list",
        responses: {
          200: {
            description: "List of pending elicitations",
            content: {
              "application/json": {
                schema: resolver(Elicitation.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const elicitations = await Elicitation.list()
        return c.json(elicitations)
      },
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Reply to elicitation request",
        description: "Provide a response to an elicitation request.",
        operationId: "elicitation.reply",
        responses: {
          200: {
            description: "Elicitation answered successfully",
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
          requestID: z.string(),
        }),
      ),
      validator("json", Elicitation.Reply),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await Elicitation.reply({
          requestID: params.requestID,
          action: json.action,
          content: json.content,
        })
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reject",
      describeRoute({
        summary: "Reject elicitation request",
        description: "Reject/cancel an elicitation request.",
        operationId: "elicitation.reject",
        responses: {
          200: {
            description: "Elicitation rejected successfully",
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
          requestID: z.string(),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        await Elicitation.reject(params.requestID)
        return c.json(true)
      },
    ),
)
