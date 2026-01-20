import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Elicitation } from "../../mcp/elicitation"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const ElicitationRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending elicitations",
        description: "Get all pending MCP elicitation requests.",
        operationId: "mcp.elicitation.list",
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
      "/:id/reply",
      describeRoute({
        summary: "Reply to elicitation request",
        description: "Submit form data for an MCP elicitation request.",
        operationId: "mcp.elicitation.reply",
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
          id: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          content: Elicitation.Content,
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const { content } = c.req.valid("json")
        await Elicitation.reply(id, content)
        return c.json(true)
      },
    )
    .post(
      "/:id/reject",
      describeRoute({
        summary: "Reject elicitation request",
        description: "Decline or cancel an MCP elicitation request.",
        operationId: "mcp.elicitation.reject",
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
          id: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          action: z.enum(["decline", "cancel"]),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const { action } = c.req.valid("json")
        await Elicitation.reject(id, action)
        return c.json(true)
      },
    ),
)
