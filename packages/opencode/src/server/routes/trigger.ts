import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { Trigger } from "@/trigger"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

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
    ),
)
