import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, ServiceUnavailableError } from "../errors.js"
import { BrowserControlProtocol } from "../browser-control.js"
import { BrowserTunnelProtocol } from "../browser-tunnel.js"
import { HeaderOnlyAuthorization } from "../middleware/authorization.js"

const websocket = (identifier: string, summary: string, description: string, subprotocol: string) =>
  OpenApi.annotations({
    identifier,
    summary,
    description,
    transform: (operation) => ({
      ...operation,
      "x-websocket": true,
      "x-websocket-subprotocol": subprotocol,
      responses: {
        ...operation.responses,
        403: { description: "WebSocket Origin is not allowed." },
        426: { description: `WebSocket subprotocol ${subprotocol} is required.` },
      },
    }),
  })

export const BrowserGroup = HttpApiGroup.make("server.browser")
  .add(
    HttpApiEndpoint.get("browser.control.connect", BrowserControlProtocol.Path, {
      success: Schema.Boolean,
      error: ConflictError,
    })
      .annotate(HeaderOnlyAuthorization, true)
      .annotate(OpenApi.Exclude, true)
      .annotateMerge(
        websocket(
          "v2.browser.control.connect",
          "Connect Session browser host",
          "Establish an authenticated WebSocket controlling the browser attachment for one Session.",
          BrowserControlProtocol.Subprotocol,
        ),
      ),
  )
  .add(
    HttpApiEndpoint.get("browser.tunnel.connect", BrowserTunnelProtocol.Path, {
      success: Schema.Boolean,
      error: ServiceUnavailableError,
    })
      .annotate(HeaderOnlyAuthorization, true)
      .annotate(OpenApi.Exclude, true)
      .annotateMerge(
        websocket(
          "v2.browser.tunnel.connect",
          "Open browser network tunnel",
          "Establish an authenticated WebSocket carrying one TCP stream dialed from the OpenCode server.",
          BrowserTunnelProtocol.Subprotocol,
        ),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "browser",
      description: "Desktop browser host control and server-network tunnel routes.",
    }),
  )
