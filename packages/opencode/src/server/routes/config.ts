import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { Plugin } from "../../plugin"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "server" })

export const ConfigRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get configuration",
        description: "Retrieve the current OpenCode configuration settings and preferences.",
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
        summary: "Update configuration",
        description: "Update OpenCode configuration settings and preferences.",
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
    .get(
      "/plugin-settings",
      describeRoute({
        summary: "Get plugin settings",
        description: "Retrieve plugin settings schemas and current values.",
        operationId: "config.pluginSettings.get",
        responses: {
          200: {
            description: "Plugin settings schemas and values",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    schemas: z.array(
                      z.object({
                        id: z.string(),
                        title: z.string(),
                        properties: z.record(
                          z.string(),
                          z.discriminatedUnion("type", [
                            z.object({ type: z.literal("string"), title: z.string(), description: z.string().optional(), default: z.string().optional(), required: z.boolean().optional(), placeholder: z.string().optional() }),
                            z.object({ type: z.literal("number"), title: z.string(), description: z.string().optional(), default: z.number().optional(), required: z.boolean().optional(), placeholder: z.string().optional() }),
                            z.object({ type: z.literal("boolean"), title: z.string(), description: z.string().optional(), default: z.boolean().optional(), required: z.boolean().optional() }),
                            z.object({ type: z.literal("select"), title: z.string(), description: z.string().optional(), default: z.string().optional(), required: z.boolean().optional(), placeholder: z.string().optional(), enum: z.array(z.string()), enumLabels: z.array(z.string()).optional() }),
                            z.object({ type: z.literal("secret"), title: z.string(), description: z.string().optional(), default: z.string().optional(), required: z.boolean().optional(), placeholder: z.string().optional() }),
                            z.object({ type: z.literal("object"), title: z.string(), description: z.string().optional(), required: z.boolean().optional(), properties: z.record(z.string(), z.unknown()).optional() }),
                            z.object({ type: z.literal("array"), title: z.string(), description: z.string().optional(), required: z.boolean().optional(), items: z.unknown().optional() }),
                          ])
                        ),
                      }),
                    ),
                    values: z.record(z.string(), z.record(z.string(), z.unknown())),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const [schemas, config] = await Promise.all([Plugin.schemas(), Config.get()])
        return c.json({
          schemas,
          values: config.plugin_settings ?? {},
        })
      },
    )
    .patch(
      "/plugin-settings",
      describeRoute({
        summary: "Update plugin settings",
        description: "Update settings for a specific plugin.",
        operationId: "config.pluginSettings.update",
        responses: {
          200: {
            description: "Successfully updated plugin settings",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    plugin_settings: z.record(z.string(), z.record(z.string(), z.unknown())),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          plugin_id: z.string(),
          settings: z.record(z.string(), z.unknown()),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const config = await Config.get()
        const current = config.plugin_settings ?? {}
        const updated = { ...current, [body.plugin_id]: { ...config.plugin_settings?.[body.plugin_id], ...body.settings } }
        await Config.update({ plugin_settings: updated })
        return c.json({ plugin_settings: updated })
      },
    )
    .get(
      "/providers",
      describeRoute({
        summary: "List config providers",
        description: "Get a list of all configured AI providers and their default models.",
        operationId: "config.providers",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    providers: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        using _ = log.time("providers")
        const providers = await Provider.list().then((x) => mapValues(x, (item) => item))
        return c.json({
          providers: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0].id),
        })
      },
    ),
)
