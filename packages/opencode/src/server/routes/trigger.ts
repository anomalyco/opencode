import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Trigger } from "@/trigger"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

const Params = z.object({ id: z.string() })

export const TriggerRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List triggers",
        description: "List lightweight scheduled triggers for the current instance.",
        operationId: "trigger.list",
        responses: {
          200: {
            description: "Triggers",
            content: {
              "application/json": {
                schema: resolver(Trigger.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Trigger.list())
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create trigger",
        description: "Register a lightweight scheduled trigger for the current instance.",
        operationId: "trigger.create",
        responses: {
          200: {
            description: "Trigger",
            content: {
              "application/json": {
                schema: resolver(Trigger.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Trigger.CreateInput),
      async (c) => {
        return c.json(await Trigger.create(c.req.valid("json")))
      },
    )
    .get(
      "/:id",
      describeRoute({
        summary: "Get trigger",
        description: "Get the current state for a lightweight scheduled trigger.",
        operationId: "trigger.get",
        responses: {
          200: {
            description: "Trigger",
            content: {
              "application/json": {
                schema: resolver(Trigger.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", Params),
      async (c) => {
        return c.json(await Trigger.get(c.req.valid("param").id))
      },
    )
    .post(
      "/:id/fire",
      describeRoute({
        summary: "Fire trigger",
        description: "Invoke a lightweight scheduled trigger immediately.",
        operationId: "trigger.fire",
        responses: {
          200: {
            description: "Trigger",
            content: {
              "application/json": {
                schema: resolver(Trigger.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", Params),
      async (c) => {
        return c.json(await Trigger.fire(c.req.valid("param").id))
      },
    )
    .post(
      "/:id/fire/webhook",
      describeRoute({
        summary: "Fire trigger webhook",
        description: "Invoke a lightweight scheduled trigger immediately through an authenticated webhook endpoint.",
        operationId: "trigger.fire_webhook",
        responses: {
          200: {
            description: "Trigger",
            content: {
              "application/json": {
                schema: resolver(Trigger.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", Params),
      async (c) => {
        return c.json(await Trigger.fire(c.req.valid("param").id))
      },
    )
    .post(
      "/:id/enable",
      describeRoute({
        summary: "Enable trigger",
        description: "Enable a lightweight scheduled trigger.",
        operationId: "trigger.enable",
        responses: {
          200: {
            description: "Trigger",
            content: {
              "application/json": {
                schema: resolver(Trigger.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", Params),
      async (c) => {
        return c.json(await Trigger.enable(c.req.valid("param").id))
      },
    )
    .post(
      "/:id/disable",
      describeRoute({
        summary: "Disable trigger",
        description: "Disable a lightweight scheduled trigger.",
        operationId: "trigger.disable",
        responses: {
          200: {
            description: "Trigger",
            content: {
              "application/json": {
                schema: resolver(Trigger.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", Params),
      async (c) => {
        return c.json(await Trigger.disable(c.req.valid("param").id))
      },
    )
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete trigger",
        description: "Delete a lightweight scheduled trigger.",
        operationId: "trigger.delete",
        responses: {
          200: {
            description: "Trigger deleted",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", Params),
      async (c) => {
        await Trigger.remove(c.req.valid("param").id)
        return c.json({ success: true as const })
      },
    ),
)
