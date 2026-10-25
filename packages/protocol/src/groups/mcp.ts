import { Mcp } from "@opencode/schema/mcp"
import { Location } from "@opencode/schema/location"
import { PtyTicket } from "@opencode/schema/pty-ticket"
import { Context, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, OpenApi } from "effect/http-api"
import { ForbiddenError, LocationNotFoundError, McpServerNotFoundError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"
import { PTY_CONNECT_TICKET_QUERY, PTY_CONNECT_TOKEN_HEADER } from "./pty.js"

export const MCP_CLIENT_PATH = "/api/experimental/client-mcp"

export function hasMcpClientTicketURL(url: URL) {
  return url.pathname === MCP_CLIENT_PATH && !!url.searchParams.get(PTY_CONNECT_TICKET_QUERY)
}

const McpClientQuery = Schema.Struct({
  ...LocationQuery.fields,
  name: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/)),
})

export const makeMcpGroup = <LocationId extends HttpApiMiddleware.AnyId, LocationService>(
  locationMiddleware: Context.Key<LocationId, LocationService>,
) =>
  HttpApiGroup.make("server.mcp")
    .add(
      HttpApiEndpoint.get("mcp.list", "/api/mcp", {
        query: LocationQuery,
        success: Location.response(Schema.Array(Mcp.Server)),
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "mcp.list",
            summary: "List MCP servers",
            description: "Retrieve configured MCP servers and their connection status.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.put("mcp.add", "/api/experimental/mcp/:server", {
        params: { server: Schema.String },
        query: LocationQuery,
        // Wrapped in a struct because the client codegen flattens payload fields and cannot
        // represent a top-level union payload.
        payload: Schema.Struct({ config: Mcp.ServerConfig }),
        success: HttpApiSchema.NoContent,
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.mcp.add",
            summary: "Add MCP server",
            description: "Add an MCP server at runtime or replace an existing one, connecting it immediately.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.delete("mcp.remove", "/api/experimental/mcp/:server", {
        params: { server: Schema.String },
        query: LocationQuery,
        success: HttpApiSchema.NoContent,
        error: McpServerNotFoundError,
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.mcp.remove",
            summary: "Remove MCP server",
            description: "Stop an MCP server and remove it from the runtime set until restart.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("mcp.connect", "/api/experimental/mcp/:server/connect", {
        params: { server: Schema.String },
        query: LocationQuery,
        success: HttpApiSchema.NoContent,
        error: McpServerNotFoundError,
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.mcp.connect",
            summary: "Connect MCP server",
            description: "Connect an MCP server at runtime, overriding a disabled configuration until restart.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("mcp.disconnect", "/api/experimental/mcp/:server/disconnect", {
        params: { server: Schema.String },
        query: LocationQuery,
        success: HttpApiSchema.NoContent,
        error: McpServerNotFoundError,
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.mcp.disconnect",
            summary: "Disconnect MCP server",
            description: "Disconnect an MCP server at runtime, removing its tools until reconnected.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get("mcp.resource.catalog", "/api/mcp/resource", {
        query: LocationQuery,
        success: Location.response(Mcp.ResourceCatalog),
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "mcp.resource.catalog",
            summary: "List MCP resources",
            description: "Retrieve resources and resource templates from connected MCP servers.",
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post("mcp.clientToken", `${MCP_CLIENT_PATH}/token`, {
        query: McpClientQuery,
        headers: Schema.Struct({ [PTY_CONNECT_TOKEN_HEADER]: Schema.optional(Schema.String) }),
        success: Location.response(PtyTicket.ConnectToken),
        error: ForbiddenError,
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.mcp.client.token",
            summary: "Create client MCP WebSocket token",
            description:
              "Create a short-lived single-use ticket for opening a client MCP WebSocket connection from a browser.",
          }),
        ),
    )
    // The client handler checks origin and ticket before it boots the location itself.
    .middleware(locationMiddleware)
    .add(
      HttpApiEndpoint.get("mcp.client", MCP_CLIENT_PATH, {
        query: Schema.Struct({ ...McpClientQuery.fields, [PTY_CONNECT_TICKET_QUERY]: Schema.optional(Schema.String) }),
        success: Schema.Boolean,
        error: [ForbiddenError, LocationNotFoundError],
      })
        .annotateMerge(locationQueryOpenApi)
        .annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.mcp.client",
            summary: "Attach client MCP server",
            description:
              "Upgrade to a WebSocket over which the client hosts an MCP server named after `name`; its tools stay available while the socket is open. One JSON-RPC message per text frame. Experimental: may change without compatibility guarantees.",
            transform: (operation) => ({ ...operation, "x-websocket": true }),
          }),
        ),
    )
    .annotateMerge(OpenApi.annotations({ title: "mcp", description: "MCP server and resource routes." }))
