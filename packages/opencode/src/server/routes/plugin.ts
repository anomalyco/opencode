import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { Plugin } from "../../plugin"
import { lazy } from "../../util/lazy"

export const PluginRoutes = lazy(() =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "Get plugin status",
      description: "Get the status of all installed plugins with their resolved versions.",
      operationId: "plugin.status",
      responses: {
        200: {
          description: "Plugin status",
          content: {
            "application/json": {
              schema: resolver(Plugin.Status.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await Plugin.status())
    },
  ),
)
