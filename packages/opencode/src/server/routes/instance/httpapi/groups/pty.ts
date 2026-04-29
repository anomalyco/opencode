import { Pty } from "@/pty"
import { PtyID } from "@/pty/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../auth"
import { InstanceContextMiddleware } from "../instance-context"

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
        HttpApiEndpoint.get("shells", PtyPaths.shells, { success: Schema.Array(ShellItem) }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.shells",
            summary: "List available shells",
            description: "Get a list of available shells on the system.",
          }),
        ),
        HttpApiEndpoint.get("list", PtyPaths.list, { success: Schema.Array(Pty.Info) }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.list",
            summary: "List PTY sessions",
            description: "Get a list of all active pseudo-terminal (PTY) sessions managed by OpenCode.",
          }),
        ),
        HttpApiEndpoint.post("create", PtyPaths.create, { payload: Pty.CreateInput, success: Pty.Info }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.create",
            summary: "Create PTY session",
            description: "Create a new pseudo-terminal (PTY) session for running shell commands and processes.",
          }),
        ),
        HttpApiEndpoint.get("get", PtyPaths.get, {
          params: { ptyID: PtyID },
          success: Pty.Info,
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
          success: Pty.Info,
          error: HttpApiError.NotFound,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "pty.update",
            summary: "Update PTY session",
            description: "Update properties of an existing pseudo-terminal (PTY) session.",
          }),
        ),
        HttpApiEndpoint.delete("remove", PtyPaths.remove, {
          params: { ptyID: PtyID },
          success: Schema.Boolean,
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
      HttpApiEndpoint.get("connect", PtyPaths.connect, { params: Params, success: Schema.Boolean }).annotateMerge(
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
