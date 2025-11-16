import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { ToolFavorites } from "../../tool/favorites"
import { errors } from "./shared"

export function configRoutes() {
  const router = new Hono()

  router
    .get(
      "/",
      describeRoute({
        description: "Get config info",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.get())
      },
    )
    .patch(
      "/",
      describeRoute({
        description: "Update config",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        await Config.update(config)
        return c.json(config)
      },
    )

  return router
}

export function favoriteToolsRoutes() {
  const router = new Hono()

  router
    .get(
      "/",
      describeRoute({
        description: "Get project and global favorite tool IDs",
        operationId: "favoriteTools.list",
        responses: {
          200: {
            description: "Lists of project and global favorite tool IDs",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    project: z.array(z.string()),
                    global: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const favorites = await ToolFavorites.list()
        return c.json(favorites)
      },
    )
    .post(
      "/cycle",
      describeRoute({
        description: "Cycle tool favorite status: none → project → global → none",
        operationId: "favoriteTools.cycle",
        responses: {
          200: {
            description: "Successfully cycled favorite status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    toolId: z.string(),
                    level: z.enum(["none", "project", "global"]),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ toolId: z.string() })),
      async (c) => {
        const { toolId } = c.req.valid("json")
        const level = await ToolFavorites.cycle(toolId)
        return c.json({ toolId, level })
      },
    )
    .get(
      "/:toolId/level",
      describeRoute({
        description: "Get favorite level for a specific tool",
        operationId: "favoriteTools.getLevel",
        responses: {
          200: {
            description: "Favorite level for the tool",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    toolId: z.string(),
                    level: z.enum(["none", "project", "global"]),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator("param", z.object({ toolId: z.string() })),
      async (c) => {
        const { toolId } = c.req.valid("param")
        const level = await ToolFavorites.getLevel(toolId)
        return c.json({ toolId, level })
      },
    )

  return router
}
