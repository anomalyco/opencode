import type { SidebarItem } from "@opencode-ai/plugin"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Plugin } from "../../plugin"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "server" })

const item = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string(),
  href: z.string(),
  order: z.number().optional(),
})

const result = z.object({
  items: item.array(),
})

function sort(a: SidebarItem, b: SidebarItem) {
  const order = (a.order ?? 0) - (b.order ?? 0)
  if (order) return order
  return a.id.localeCompare(b.id)
}

export const PluginRoutes = lazy(() =>
  new Hono().get(
    "/sidebar",
    describeRoute({
      summary: "List plugin sidebar items",
      description: "Retrieve sidebar items contributed by loaded plugins.",
      operationId: "plugin.sidebar",
      responses: {
        200: {
          description: "Plugin sidebar items",
          content: {
            "application/json": {
              schema: resolver(result),
            },
          },
        },
      },
    }),
    async (c) => {
      const body = await Plugin.trigger("ui.sidebar", {}, { items: [] as SidebarItem[] })
        .then((output) => {
          const map = new Map<string, SidebarItem>()
          for (const item of output.items) map.set(item.id, item)
          return {
            items: [...map.values()].sort(sort),
          }
        })
        .catch((error) => {
          log.error("plugin sidebar failed", { error })
          return { items: [] as SidebarItem[] }
        })
      return c.json(body)
    },
  ),
)
