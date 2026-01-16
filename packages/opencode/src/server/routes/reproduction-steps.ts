import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { ReproductionSteps } from "../../debug/repro"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const ReproductionStepsRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List pending debug reproduction prompts",
        description: "Get all pending debug reproduction requests across all sessions.",
        operationId: "reproductionSteps.list",
        responses: {
          200: {
            description: "List of pending debug reproduction requests",
            content: {
              "application/json": {
                schema: resolver(ReproductionSteps.Request.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const requests = await ReproductionSteps.list()
        return c.json(requests)
      },
    )
    .post(
      "/:requestID/reply",
      describeRoute({
        summary: "Reply to debug reproduction prompt",
        description: "Provide the action for a debug reproduction request from the AI assistant.",
        operationId: "reproductionSteps.reply",
        responses: {
          200: {
            description: "Debug reproduction request answered successfully",
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
      validator("json", ReproductionSteps.Reply),
      async (c) => {
        const params = c.req.valid("param")
        const json = c.req.valid("json")
        await ReproductionSteps.reply({
          requestID: params.requestID,
          action: json.action,
        })
        return c.json(true)
      },
    )
    .post(
      "/:requestID/reject",
      describeRoute({
        summary: "Reject debug reproduction prompt",
        description: "Reject a debug reproduction request from the AI assistant.",
        operationId: "reproductionSteps.reject",
        responses: {
          200: {
            description: "Debug reproduction request rejected successfully",
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
        await ReproductionSteps.reject(params.requestID)
        return c.json(true)
      },
    ),
)
