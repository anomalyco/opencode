import { Pty } from "@opencode-ai/schema/pty"
import { PtyTicket } from "@opencode-ai/schema/pty-ticket"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ForbiddenError, PtyNotFoundError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

export const PTY_CONNECT_TICKET_QUERY = "ticket"
export const PTY_CONNECT_TOKEN_HEADER = "x-opencode-ticket"
export const PTY_CONNECT_TOKEN_HEADER_VALUE = "1"

const PTY_CONNECT_PATH = /^\/api\/pty\/[^/]+\/connect$/

// Authorization middleware skips credential checks when this matches; the PTY connect handler
// is then responsible for consuming and validating the ticket.
export function hasPtyConnectTicketURL(url: URL) {
  return PTY_CONNECT_PATH.test(url.pathname) && !!url.searchParams.get(PTY_CONNECT_TICKET_QUERY)
}

export const PtyGroup = HttpApiGroup.make("server.pty")
  .add(
    HttpApiEndpoint.get("pty.list", "/api/pty", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Pty.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.pty.list",
          summary: "List PTY sessions",
          description: "List PTY sessions for a location, including exited sessions retained until removal.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("pty.create", "/api/pty", {
      query: LocationQuery,
      payload: Pty.CreateInput,
      success: Location.response(Pty.Info),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.pty.create",
          summary: "Create PTY session",
          description: "Create a pseudo-terminal session for a location.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("pty.get", "/api/pty/:ptyID", {
      params: { ptyID: Pty.ID },
      query: LocationQuery,
      success: Location.response(Pty.Info),
      error: PtyNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.pty.get",
          summary: "Get PTY session",
          description: "Get one PTY session, including its exit code once exited.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.put("pty.update", "/api/pty/:ptyID", {
      params: { ptyID: Pty.ID },
      query: LocationQuery,
      payload: Pty.UpdateInput,
      success: Location.response(Pty.Info),
      error: PtyNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.pty.update",
          summary: "Update PTY session",
          description: "Update the title or viewport size of one PTY session.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("pty.remove", "/api/pty/:ptyID", {
      params: { ptyID: Pty.ID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
      error: PtyNotFoundError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.pty.remove",
          summary: "Remove PTY session",
          description: "Terminate and remove one PTY session.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("pty.connectToken", "/api/pty/:ptyID/connect-token", {
      params: { ptyID: Pty.ID },
      query: LocationQuery,
      success: Location.response(PtyTicket.ConnectToken),
      error: [ForbiddenError, PtyNotFoundError],
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.pty.connect.token",
          summary: "Create PTY WebSocket token",
          description: "Create a short-lived single-use ticket for opening a PTY WebSocket connection.",
        }),
      ),
  )
  .add(
    // Query fields are decoded in the raw handler after the existence check so a missing
    // session responds with an empty 404 before any upgrade work.
    HttpApiEndpoint.get("pty.connect", "/api/pty/:ptyID/connect", {
      params: { ptyID: Pty.ID },
      success: Schema.Boolean,
      error: [ForbiddenError, PtyNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.pty.connect",
        summary: "Connect to PTY session",
        description: "Establish a WebSocket connection streaming PTY output and accepting terminal input.",
        transform: (operation) => ({
          ...operation,
          "x-websocket": true,
          parameters: [
            ...(operation.parameters ?? []),
            ...["location[directory]", "location[workspace]", "cursor", PTY_CONNECT_TICKET_QUERY].map((name) => ({
              in: "query",
              name,
              schema: { type: "string" },
            })),
          ],
        }),
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "pty", description: "Experimental location-scoped PTY routes." }))
