import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { mapValues } from "remeda"
import z from "zod"
import { errors } from "./error"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"

const log = Log.create({ service: "server.config" })

export const ConfigRoute = new Hono()
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
