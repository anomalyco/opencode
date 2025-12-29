import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../config/config"
import { ServerRegistry } from "./registry"
import { errors } from "./error"

export const DiscoveryRoute = new Hono()
  .get(
    "/servers",
    describeRoute({
      summary: "List servers",
      description: "Get a list of all registered OpenCode servers for multi-server discovery.",
      operationId: "servers.list",
      responses: {
        200: {
          description: "List of registered servers",
          content: {
            "application/json": {
              schema: resolver(ServerRegistry.ServerEntry.array()),
            },
          },
        },
        ...errors(400),
      },
    }),
    async (c) => {
      const config = await Config.get()
      if (!config.experimental?.durableStreams) {
        return c.json(
          {
            error: "durableStreams not enabled",
            message: "Enable experimental.durableStreams in config",
          },
          400,
        )
      }

      await ServerRegistry.pruneStale()
      const servers = await ServerRegistry.list()
      return c.json(servers)
    },
  )
  .post(
    "/servers",
    describeRoute({
      summary: "Register server",
      description: "Manually register an OpenCode server in the registry.",
      operationId: "servers.register",
      responses: {
        200: {
          description: "Server registered successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    async (c) => {
      const config = await Config.get()
      if (!config.experimental?.durableStreams) {
        return c.json(
          {
            error: "durableStreams not enabled",
            message: "Enable experimental.durableStreams in config",
          },
          400,
        )
      }

      const body = await c.req.json()
      const parsed = ServerRegistry.ServerEntry.safeParse(body)
      if (!parsed.success) {
        return c.json({ error: "Invalid server entry", issues: parsed.error.issues }, 400)
      }

      await ServerRegistry.register(parsed.data)
      return c.json(true)
    },
  )
  .delete(
    "/servers/:serverId",
    describeRoute({
      summary: "Unregister server",
      description: "Remove a server from the registry.",
      operationId: "servers.unregister",
      responses: {
        200: {
          description: "Server unregistered successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    async (c) => {
      const config = await Config.get()
      if (!config.experimental?.durableStreams) {
        return c.json(
          {
            error: "durableStreams not enabled",
            message: "Enable experimental.durableStreams in config",
          },
          400,
        )
      }

      const serverId = c.req.param("serverId")
      await ServerRegistry.unregister(serverId)
      return c.json(true)
    },
  )
