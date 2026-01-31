import { lazy } from "../../util/lazy"
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { adapter } from "../../preferences/adapter"
import { errors } from "../error"

export const PreferenceRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List plugin preference tabs",
        operationId: "preferences.list",
        responses: {
          200: {
            description: "List of preference tabs",
            content: { "application/json": { schema: resolver(z.any()) } },
          },
        },
      }),
      async (c) => {
        const tabs = await adapter.listPreferenceTabs()
        return c.json(tabs)
      },
    )
    .get("/:pluginId/values", async (c) => {
      const pluginId = c.req.param("pluginId")
      const values = await adapter.getPreferenceValues(pluginId)
      return c.json(values)
    })
    .post("/:pluginId/validate", async (c) => {
      const pluginId = c.req.param("pluginId")
      const body = await c.req.json()
      const result = await adapter.validatePreferenceValue(pluginId, body.key, body.value)
      return c.json(result)
    })
    .post("/:pluginId/apply", async (c) => {
      const pluginId = c.req.param("pluginId")
      const body = await c.req.json()
      await adapter.applyPreferenceChange(pluginId, body.key, body.value)
      return c.json({ ok: true })
    }),
)

export default PreferenceRoutes
