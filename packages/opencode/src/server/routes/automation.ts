import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import { Automation } from "../../automation"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import z from "zod"

export const AutomationRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List automations",
        description: "Get a list of all automations.",
        operationId: "automation.list",
        responses: {
          200: {
            description: "List of automations",
            content: {
              "application/json": {
                schema: resolver(Automation.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await Automation.list()
        return c.json(result)
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create automation",
        description: "Create a new automation.",
        operationId: "automation.create",
        responses: {
          200: {
            description: "Created automation",
            content: {
              "application/json": {
                schema: resolver(Automation.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Automation.create.schema),
      async (c) => {
        const body = c.req.valid("json")
        const result = await Automation.create(body)
        return c.json(result)
      },
    )
    .post(
      "/preview",
      describeRoute({
        summary: "Preview automation schedule",
        description: "Validate a cron schedule and return the next run.",
        operationId: "automation.preview",
        responses: {
          200: {
            description: "Schedule preview",
            content: {
              "application/json": {
                schema: resolver(Automation.Preview),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Automation.preview.schema),
      async (c) => {
        const body = c.req.valid("json")
        const result = await Automation.preview(body)
        return c.json(result)
      },
    )
    .delete(
      "/history",
      describeRoute({
        summary: "Clear automation run history",
        description: "Delete all automation run history.",
        operationId: "automation.clearHistory",
        responses: {
          200: {
            description: "History cleared",
            content: {
              "application/json": {
                schema: resolver(Automation.HistoryClear),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        const result = await Automation.clearHistory({})
        return c.json(result)
      },
    )
    .patch(
      "/:automationID",
      describeRoute({
        summary: "Update automation",
        description: "Update an existing automation.",
        operationId: "automation.update",
        responses: {
          200: {
            description: "Updated automation",
            content: {
              "application/json": {
                schema: resolver(Automation.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          automationID: Automation.update.schema.shape.id,
        }),
      ),
      validator("json", Automation.update.schema.omit({ id: true })),
      async (c) => {
        const automationID = c.req.valid("param").automationID
        const body = c.req.valid("json")
        const result = await Automation.update({ ...body, id: automationID })
        return c.json(result)
      },
    )
    .get(
      "/:automationID/history",
      describeRoute({
        summary: "List automation run history",
        description: "Get recent run history for an automation.",
        operationId: "automation.history",
        responses: {
          200: {
            description: "Automation run history",
            content: {
              "application/json": {
                schema: resolver(Automation.Run.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          automationID: Automation.update.schema.shape.id,
        }),
      ),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().int().positive().optional(),
        }),
      ),
      async (c) => {
        const automationID = c.req.valid("param").automationID
        const query = c.req.valid("query")
        const result = await Automation.history({ id: automationID, limit: query.limit })
        return c.json(result)
      },
    )
    .delete(
      "/:automationID",
      describeRoute({
        summary: "Delete automation",
        description: "Delete an automation.",
        operationId: "automation.remove",
        responses: {
          200: {
            description: "Deleted automation",
            content: {
              "application/json": {
                schema: resolver(Automation.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          automationID: Automation.update.schema.shape.id,
        }),
      ),
      async (c) => {
        const automationID = c.req.valid("param").automationID
        const result = await Automation.remove(automationID)
        return c.json(result)
      },
    )
    .post(
      "/:automationID/run",
      describeRoute({
        summary: "Run automation",
        description: "Manually run an automation.",
        operationId: "automation.run",
        responses: {
          200: {
            description: "Automation run started",
            content: {
              "application/json": {
                schema: resolver(Automation.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          automationID: Automation.update.schema.shape.id,
        }),
      ),
      async (c) => {
        const automationID = c.req.valid("param").automationID
        const result = await Automation.run({ id: automationID })
        return c.json(result)
      },
    ),
)
