import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { UIRegistry } from "../../ui/registry"
import { UIExtensionsSchema, UIRenderResponseSchema } from "../../ui/schema"
import { errors } from "./shared"

export function uiRoutes() {
  const router = new Hono()

  router
    .get(
      "/extensions",
      describeRoute({
        description: "Get all registered UI extensions from plugins",
        operationId: "ui.extensions",
        responses: {
          200: {
            description: "UI extensions",
            content: {
              "application/json": {
                schema: resolver(UIExtensionsSchema),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = {
          sidebars: await UIRegistry.getSidebars(),
          tabs: await UIRegistry.getTabs(),
          panels: await UIRegistry.getPanels(),
          widgets: await UIRegistry.getWidgets(),
          keybinds: await UIRegistry.getKeybinds(),
          statusItems: await UIRegistry.getStatusItems(),
          commands: await UIRegistry.getCommands(),
        }
        return c.json(result)
      },
    )
    .post(
      "/render/:componentId",
      describeRoute({
        description: "Render a specific UI component by ID",
        operationId: "ui.render",
        responses: {
          200: {
            description: "Rendered component content",
            content: {
              "application/json": {
                schema: resolver(UIRenderResponseSchema),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          componentId: z.string().meta({ description: "UI component ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          context: z.record(z.string(), z.any()).optional(),
        }),
      ),
      async (c) => {
        const { componentId } = c.req.valid("param")
        const { context = {} } = c.req.valid("json")
        const result = await UIRegistry.renderComponent(componentId, context)
        return c.json(result)
      },
    )
    .post(
      "/action/:componentId",
      describeRoute({
        description: "Trigger an action on a UI component",
        operationId: "ui.action",
        responses: {
          200: {
            description: "Action result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    result: z.any().optional(),
                    error: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          componentId: z.string().meta({ description: "UI component ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          action: z.string().meta({ description: "Action name" }),
          payload: z.any().optional().meta({ description: "Action payload" }),
        }),
      ),
      async (c) => {
        const { componentId } = c.req.valid("param")
        const { action, payload } = c.req.valid("json")
        const result = await UIRegistry.triggerAction(componentId, action, payload)
        return c.json(result)
      },
    )

  return router
}
