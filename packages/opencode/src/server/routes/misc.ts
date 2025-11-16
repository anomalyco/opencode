import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import z from "zod"
import { Log } from "../../util/log"
import { Agent } from "../../agent/agent"
import { Auth } from "../../auth"
import { LSP } from "../../lsp"
import { Format } from "../../format"
import { Plugin } from "../../plugin"
import { Command } from "../../command"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { errors } from "./shared"

export function agentRoutes() {
  const router = new Hono()

  router.get(
    "/",
    describeRoute({
      description: "List all agents",
      operationId: "app.agents",
      responses: {
        200: {
          description: "List of agents",
          content: {
            "application/json": {
              schema: resolver(Agent.Info.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      const modes = await Agent.list()
      return c.json(modes)
    },
  )

  return router
}

export function authRoutes() {
  const router = new Hono()

  router.put(
    "/:id",
    describeRoute({
      description: "Set authentication credentials",
      operationId: "auth.set",
      responses: {
        200: {
          description: "Successfully set authentication credentials",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "param",
      z.object({
        id: z.string(),
      }),
    ),
    validator("json", Auth.Info),
    async (c) => {
      const id = c.req.valid("param").id
      const info = c.req.valid("json")
      await Auth.set(id, info)
      return c.json(true)
    },
  )

  return router
}

export function lspRoutes() {
  const router = new Hono()

  router.get(
    "/",
    describeRoute({
      description: "Get LSP server status",
      operationId: "lsp.status",
      responses: {
        200: {
          description: "LSP server status",
          content: {
            "application/json": {
              schema: resolver(LSP.Status.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await LSP.status())
    },
  )

  return router
}

export function formatterRoutes() {
  const router = new Hono()

  router.get(
    "/",
    describeRoute({
      description: "Get formatter status",
      operationId: "formatter.status",
      responses: {
        200: {
          description: "Formatter status",
          content: {
            "application/json": {
              schema: resolver(Format.Status.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await Format.status())
    },
  )

  return router
}

export function pluginRoutes() {
  const router = new Hono()

  router.get(
    "/",
    describeRoute({
      description: "Get loaded plugins status",
      operationId: "plugins.status",
      responses: {
        200: {
          description: "Loaded plugins",
          content: {
            "application/json": {
              schema: resolver(
                z.array(
                  z.object({
                    name: z.string(),
                    path: z.string(),
                    status: z.literal("loaded"),
                  }),
                ),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(await Plugin.status())
    },
  )

  return router
}

export function commandRoutes() {
  const router = new Hono()

  router.get(
    "/",
    describeRoute({
      description: "List all commands",
      operationId: "command.list",
      responses: {
        200: {
          description: "List of commands",
          content: {
            "application/json": {
              schema: resolver(Command.Info.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      const commands = await Command.list()
      return c.json(commands)
    },
  )

  return router
}

export function pathRoutes() {
  const router = new Hono()

  router.get(
    "/",
    describeRoute({
      description: "Get the current path",
      operationId: "path.get",
      responses: {
        200: {
          description: "Path",
          content: {
            "application/json": {
              schema: resolver(
                z
                  .object({
                    state: z.string(),
                    config: z.string(),
                    worktree: z.string(),
                    directory: z.string(),
                  })
                  .meta({
                    ref: "Path",
                  }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({
        state: Global.Path.state,
        config: Global.Path.config,
        worktree: Instance.worktree,
        directory: Instance.directory,
      })
    },
  )

  return router
}

export function logRoutes() {
  const router = new Hono()

  router.post(
    "/",
    describeRoute({
      description: "Write a log entry to the server logs",
      operationId: "app.log",
      responses: {
        200: {
          description: "Log entry written successfully",
          content: {
            "application/json": {
              schema: resolver(z.boolean()),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.object({
        service: z.string().meta({ description: "Service name for the log entry" }),
        level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
        message: z.string().meta({ description: "Log message" }),
        extra: z
          .record(z.string(), z.any())
          .optional()
          .meta({ description: "Additional metadata for the log entry" }),
      }),
    ),
    async (c) => {
      const { service, level, message, extra } = c.req.valid("json")
      const logger = Log.create({ service })

      switch (level) {
        case "debug":
          logger.debug(message, extra)
          break
        case "info":
          logger.info(message, extra)
          break
        case "error":
          logger.error(message, extra)
          break
        case "warn":
          logger.warn(message, extra)
          break
      }

      return c.json(true)
    },
  )

  return router
}
