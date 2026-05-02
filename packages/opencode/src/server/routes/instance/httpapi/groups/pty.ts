import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/pty"
export const Params = Schema.Struct({ ptyID: PtyID })
export const CursorQuery = Schema.Struct({ cursor: Schema.optional(Schema.String) })
export const ShellItem = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  acceptable: Schema.Boolean,
})

export const PtyPaths = {
  shells: `${root}/shells`,
  list: root,
  create: root,
  get: `${root}/:ptyID`,
  update: `${root}/:ptyID`,
  remove: `${root}/:ptyID`,
  connect: `${root}/:ptyID/connect`,
} as const

export const PtyApi = HttpApi.make("pty")
  .add(
    HttpApiGroup.make("pty")
      .add(
        HttpApiEndpoint.get("shells", PtyPaths.shells, {
          success: described(Schema.Array(ShellItem), "List of shells"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.shells",
            summary: "List available shells",
            description: "Get a list of available shells on the system.",
          }),
        ),
        HttpApiEndpoint.get("list", PtyPaths.list, {
          success: described(Schema.Array(Pty.Info), "List of sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.list",
            summary: "List PTY sessions",
            description: "Get a list of all active pseudo-terminal (PTY) sessions managed by OpenCode.",
          }),
        ),
        HttpApiEndpoint.post("create", PtyPaths.create, {
          payload: Pty.CreateInput,
          success: described(Pty.Info, "Created session"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.create",
            summary: "Create PTY session",
            description: "Create a new pseudo-terminal (PTY) session for running shell commands and processes.",
          }),
        ),
        HttpApiEndpoint.get("get", PtyPaths.get, {
          params: { ptyID: PtyID },
          success: described(Pty.Info, "Session info"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.get",
            summary: "Get PTY session",
            description: "Retrieve detailed information about a specific pseudo-terminal (PTY) session.",
          }),
        ),
        HttpApiEndpoint.put("update", PtyPaths.update, {
          params: { ptyID: PtyID },
          payload: Pty.UpdateInput,
          success: described(Pty.Info, "Updated session"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.update",
            summary: "Update PTY session",
            description: "Update properties of an existing pseudo-terminal (PTY) session.",
          }),
        ),
        HttpApiEndpoint.delete("remove", PtyPaths.remove, {
          params: { ptyID: PtyID },
          success: described(Schema.Boolean, "Session removed"),
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.remove",
            summary: "Remove PTY session",
            description: "Remove and terminate a specific pseudo-terminal (PTY) session.",
          }),
        ),
      )
      .annotateMerge(OpenApi.annotations({ title: "pty", description: "Experimental HttpApi PTY routes." }))
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const PtyConnectApi = HttpApi.make("pty-connect").add(
  HttpApiGroup.make("pty-connect")
    .add(
      HttpApiEndpoint.get("connect", PtyPaths.connect, {
        params: Params,
        success: described(Schema.Boolean, "Connected session"),
        error: HttpApiError.NotFound,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "pty.connect",
          summary: "Connect to PTY session",
          description:
            "Establish a WebSocket connection to interact with a pseudo-terminal (PTY) session in real-time.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "pty", description: "PTY websocket route." })),
)
