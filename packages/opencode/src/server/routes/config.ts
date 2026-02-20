import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import path from "path"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { Yolo } from "../../yolo"
import { Global } from "../../global"
import { mapValues } from "remeda"
import { errors } from "../error"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"

const log = Log.create({ service: "server" })

// Helper to read/write global config for YOLO persistence (uses config.json, not opencode.jsonc)
async function readGlobalConfig(): Promise<Record<string, unknown>> {
  const filepath = path.join(Global.Path.config, "config.json")
  try {
    const text = await Bun.file(filepath).text()
    return JSON.parse(text)
  } catch {
    return {}
  }
}

async function writeGlobalConfig(config: Record<string, unknown>): Promise<void> {
  const filepath = path.join(Global.Path.config, "config.json")
  await Bun.write(filepath, JSON.stringify(config, null, 2))
}

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
    )
    .get(
      "/yolo",
      describeRoute({
        summary: "Get YOLO mode status",
        description:
          "Check if YOLO mode is enabled. When enabled, all permission prompts are auto-approved (except explicit deny rules).",
        operationId: "config.yolo.get",
        responses: {
          200: {
            description: "YOLO mode status",
            content: {
              "application/json": {
                schema: resolver(z.object({ enabled: z.boolean(), persisted: z.boolean() })),
              },
            },
          },
        },
      }),
      async (c) => {
        const globalConfig = await readGlobalConfig()
        return c.json({
          enabled: Yolo.isEnabled(),
          persisted: globalConfig.yolo === true,
        })
      },
    )
    .post(
      "/yolo",
      describeRoute({
        summary: "Set YOLO mode",
        description:
          "Enable or disable YOLO mode. When enabled, all permission prompts are auto-approved (except explicit deny rules). Use with caution. Set persist=true to save to config file.",
        operationId: "config.yolo.set",
        responses: {
          200: {
            description: "YOLO mode updated",
            content: {
              "application/json": {
                schema: resolver(z.object({ enabled: z.boolean(), persisted: z.boolean() })),
              },
            },
          },
        },
      }),
      validator("json", z.object({ enabled: z.boolean(), persist: z.boolean().optional() })),
      async (c) => {
        const { enabled, persist } = c.req.valid("json")
        Yolo.set(enabled)

        try {
          const globalConfig = await readGlobalConfig()
          const wasPersisted = globalConfig.yolo === true

          if (persist) {
            // Explicitly save to or remove from config
            if (enabled) {
              globalConfig.yolo = true
            } else {
              delete globalConfig.yolo
            }
            await writeGlobalConfig(globalConfig)
            log.info("YOLO mode config updated", { enabled, path: Global.Path.config })
          } else if (wasPersisted && enabled) {
            // Downgrade from persistent to session-only: remove from config but keep enabled
            delete globalConfig.yolo
            await writeGlobalConfig(globalConfig)
            log.info("YOLO mode downgraded to session-only", { path: Global.Path.config })
          }
        } catch (e) {
          log.error("Failed to update YOLO config", { error: e })
        }

        // Return the actual persisted state from config
        const finalConfig = await readGlobalConfig()
        return c.json({ enabled: Yolo.isEnabled(), persisted: finalConfig.yolo === true })
      },
    ),
)
