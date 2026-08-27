import { PersistentPty } from "@opencode-ai/schema/persistent-pty"
import { Pty } from "@opencode-ai/schema/pty"
import { PtyTicket } from "@opencode-ai/schema/pty-ticket"
import { Session } from "@opencode-ai/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ForbiddenError, InvalidRequestError, PtyNotFoundError, ServiceUnavailableError } from "../errors.js"
import { PTY_CONNECT_TICKET_QUERY, PTY_CONNECT_TOKEN_HEADER, PTY_CONNECT_TOKEN_HEADER_VALUE } from "./pty.js"

export { PTY_CONNECT_TICKET_QUERY, PTY_CONNECT_TOKEN_HEADER, PTY_CONNECT_TOKEN_HEADER_VALUE }

const CONNECT_PATH = /^\/api\/experimental\/persistent-pty\/[^/]+\/connect$/

export function hasPersistentPtyConnectTicketURL(url: URL) {
  return CONNECT_PATH.test(url.pathname) && !!url.searchParams.get(PTY_CONNECT_TICKET_QUERY)
}

const errors = [InvalidRequestError, ServiceUnavailableError] as const
const terminalErrors = [PtyNotFoundError, ServiceUnavailableError] as const

export const PersistentPtyGroup = HttpApiGroup.make("server.experimental")
  .add(
    HttpApiEndpoint.get("persistentPty.list", "/api/experimental/session/:sessionID/terminal", {
      params: { sessionID: Session.ID },
      success: Schema.Struct({ data: Schema.Array(PersistentPty.Info) }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("persistentPty.create", "/api/experimental/session/:sessionID/terminal", {
      params: { sessionID: Session.ID },
      payload: PersistentPty.CreateInput,
      success: Schema.Struct({ data: PersistentPty.Info }),
      error: errors,
    }),
  )
  .add(
    HttpApiEndpoint.post("persistentPty.shutdown", "/api/experimental/persistent-pty/shutdown", {
      success: HttpApiSchema.NoContent,
      error: [ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.get("persistentPty.get", "/api/experimental/persistent-pty/:ptyID", {
      params: { ptyID: Pty.ID },
      success: Schema.Struct({ data: PersistentPty.Info }),
      error: terminalErrors,
    }),
  )
  .add(
    HttpApiEndpoint.put("persistentPty.update", "/api/experimental/persistent-pty/:ptyID", {
      params: { ptyID: Pty.ID },
      payload: PersistentPty.UpdateInput,
      success: Schema.Struct({ data: PersistentPty.Info }),
      error: terminalErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("persistentPty.snapshot", "/api/experimental/persistent-pty/:ptyID/snapshot", {
      params: { ptyID: Pty.ID },
      success: Schema.Struct({ data: PersistentPty.Snapshot }),
      error: terminalErrors,
    }),
  )
  .add(
    HttpApiEndpoint.delete("persistentPty.remove", "/api/experimental/persistent-pty/:ptyID", {
      params: { ptyID: Pty.ID },
      success: HttpApiSchema.NoContent,
      error: terminalErrors,
    }),
  )
  .add(
    HttpApiEndpoint.post("persistentPty.connectToken", "/api/experimental/persistent-pty/:ptyID/connect-token", {
      params: { ptyID: Pty.ID },
      headers: Schema.Struct({ [PTY_CONNECT_TOKEN_HEADER]: Schema.optional(Schema.String) }),
      success: Schema.Struct({ data: PtyTicket.ConnectToken }),
      error: [ForbiddenError, PtyNotFoundError, ServiceUnavailableError],
    }),
  )
  .add(
    HttpApiEndpoint.get("persistentPty.connect", "/api/experimental/persistent-pty/:ptyID/connect", {
      params: { ptyID: Pty.ID },
      success: Schema.Boolean,
      error: [ForbiddenError, PtyNotFoundError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.persistentPty.connect",
        summary: "Connect to a persistent PTY",
        description: "Stream persistent PTY output through the OpenCode server.",
        transform: (operation) => ({
          ...operation,
          "x-websocket": true,
          parameters: [
            ...(operation.parameters ?? []),
            ...["cursor", "role", "attachment_id", "takeover", "input_protocol", PTY_CONNECT_TICKET_QUERY].map(
              (name) => ({ in: "query", name, schema: { type: "string" } }),
            ),
          ],
        }),
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "persistentPty", description: "Prototype persistent PTY routes." }))
