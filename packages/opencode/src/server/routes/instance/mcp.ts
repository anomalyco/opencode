import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { MCP } from "@/mcp"
import { ConfigMCP } from "@/config/mcp"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Effect } from "effect"
import { jsonRequest, runRequest } from "./trace"

export const McpRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Get MCP status",
        description: "Get the status of all Model Context Protocol (MCP) servers.",
        operationId: "mcp.status",
        responses: {
          200: {
            description: "MCP server status",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status)),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("McpRoutes.status", c, function* () {
          const mcp = yield* MCP.Service
          return yield* mcp.status()
        }),
    )
    .post(
      "/",
      describeRoute({
        summary: "Add MCP server",
        description: "Dynamically add a new Model Context Protocol (MCP) server to the system.",
        operationId: "mcp.add",
        responses: {
          200: {
            description: "MCP server added successfully",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Status)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          config: ConfigMCP.Info.zod,
        }),
      ),
      async (c) =>
        jsonRequest("McpRoutes.add", c, function* () {
          const { name, config } = c.req.valid("json")
          const mcp = yield* MCP.Service
          const result = yield* mcp.add(name, config)
          return result.status
        }),
    )
    .post(
      "/:name/auth",
      describeRoute({
        summary: "Start MCP OAuth",
        description: "Start OAuth authentication flow for a Model Context Protocol (MCP) server.",
        operationId: "mcp.auth.start",
        responses: {
          200: {
            description: "OAuth flow started",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    authorizationUrl: z.string().describe("URL to open in browser for authorization"),
                  }),
                ),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const result = await runRequest(
          "McpRoutes.auth.start",
          c,
          Effect.gen(function* () {
            const mcp = yield* MCP.Service
            const supports = yield* mcp.supportsOAuth(name)
            if (!supports) return { supports }
            return {
              supports,
              auth: yield* mcp.startAuth(name),
            }
          }),
        )
        if (!result.supports) {
          return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
        }
        return c.json(result.auth)
      },
    )
    .post(
      "/:name/auth/callback",
      describeRoute({
        summary: "Complete MCP OAuth",
        description:
          "Complete OAuth authentication for a Model Context Protocol (MCP) server using the authorization code.",
        operationId: "mcp.auth.callback",
        responses: {
          200: {
            description: "OAuth authentication completed",
            content: {
              "application/json": {
                schema: resolver(MCP.Status),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "json",
        z.object({
          code: z.string().describe("Authorization code from OAuth callback"),
        }),
      ),
      async (c) =>
        jsonRequest("McpRoutes.auth.callback", c, function* () {
          const name = c.req.param("name")
          const { code } = c.req.valid("json")
          const mcp = yield* MCP.Service
          return yield* mcp.finishAuth(name, code)
        }),
    )
    .post(
      "/:name/auth/authenticate",
      describeRoute({
        summary: "Authenticate MCP OAuth",
        description: "Start OAuth flow and wait for callback (opens browser)",
        operationId: "mcp.auth.authenticate",
        responses: {
          200: {
            description: "OAuth authentication completed",
            content: {
              "application/json": {
                schema: resolver(MCP.Status),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      async (c) => {
        const name = c.req.param("name")
        const result = await runRequest(
          "McpRoutes.auth.authenticate",
          c,
          Effect.gen(function* () {
            const mcp = yield* MCP.Service
            const supports = yield* mcp.supportsOAuth(name)
            if (!supports) return { supports }
            return {
              supports,
              status: yield* mcp.authenticate(name),
            }
          }),
        )
        if (!result.supports) {
          return c.json({ error: `MCP server ${name} does not support OAuth` }, 400)
        }
        return c.json(result.status)
      },
    )
    .delete(
      "/:name/auth",
      describeRoute({
        summary: "Remove MCP OAuth",
        description: "Remove OAuth credentials for an MCP server",
        operationId: "mcp.auth.remove",
        responses: {
          200: {
            description: "OAuth credentials removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.literal(true) })),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) =>
        jsonRequest("McpRoutes.auth.remove", c, function* () {
          const name = c.req.param("name")
          const mcp = yield* MCP.Service
          yield* mcp.removeAuth(name)
          return { success: true as const }
        }),
    )
    .post(
      "/:name/connect",
      describeRoute({
        description: "Connect an MCP server",
        operationId: "mcp.connect",
        responses: {
          200: {
            description: "MCP server connected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) =>
        jsonRequest("McpRoutes.connect", c, function* () {
          const { name } = c.req.valid("param")
          const mcp = yield* MCP.Service
          yield* mcp.connect(name)
          return true
        }),
    )
    .post(
      "/:name/disconnect",
      describeRoute({
        description: "Disconnect an MCP server",
        operationId: "mcp.disconnect",
        responses: {
          200: {
            description: "MCP server disconnected successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("param", z.object({ name: z.string() })),
      async (c) =>
        jsonRequest("McpRoutes.disconnect", c, function* () {
          const { name } = c.req.valid("param")
          const mcp = yield* MCP.Service
          yield* mcp.disconnect(name)
          return true
        }),
    ),
)
