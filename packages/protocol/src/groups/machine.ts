import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, InvalidRequestError, MachineNotFoundError } from "../errors.js"

export const MACHINE_LINK_PATH = "/api/experimental/machine/link"

const EXPERIMENTAL = "Behind the machines flag. Experimental: may change without compatibility guarantees."

const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.machine.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

export const MachineInfo = Schema.Struct({
  id: Schema.String,
  online: Schema.Boolean,
  paired: Schema.Boolean,
  os: Schema.optionalKey(Schema.String),
  arch: Schema.optionalKey(Schema.String),
  connection: Schema.optionalKey(
    Schema.Struct({
      kind: Schema.Literals(["websocket", "iroh"]),
      path: Schema.optionalKey(Schema.Literals(["direct", "relayed"])),
      /** Round-trip time in milliseconds. */
      rtt: Schema.optionalKey(Schema.Number),
    }),
  ),
  /** The machine's last connection was refused after it proved its key, and it has not connected since. */
  refused: Schema.optionalKey(
    Schema.Struct({
      /** Milliseconds since the epoch. */
      at: Schema.Int,
      reason: Schema.Union([
        /** The worker speaks a different link protocol than this server: update whichever is older. */
        Schema.Struct({ type: Schema.Literal("protocol-mismatch"), worker: Schema.Int, home: Schema.Int }),
        Schema.Struct({ type: Schema.Literal("invalid-hello"), issue: Schema.String }),
      ]),
    }),
  ),
}).annotate({ identifier: "Machine.Info" })
export type MachineInfo = typeof MachineInfo.Type

export const MachineReach = Schema.Struct({
  type: Schema.Literal("url"),
  url: Schema.String,
}).annotate({ identifier: "Machine.Reach" })
export type MachineReach = typeof MachineReach.Type

export const MachineAddPayload = Schema.Struct({
  name: Schema.String,
  reach: Schema.Array(MachineReach),
  replace: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "Machine.AddPayload" })
export type MachineAddPayload = typeof MachineAddPayload.Type

export const MachineInvite = Schema.Struct({
  name: Schema.String,
  join: Schema.String,
  expires: Schema.Int,
  reach: Schema.Array(Schema.Union([MachineReach, Schema.Struct({ type: Schema.Literal("iroh") })])),
}).annotate({ identifier: "Machine.Invite" })
export type MachineInvite = typeof MachineInvite.Type

/**
 * Whether a request asks to become a WebSocket, the one request the machine link serves and the one the server lets in
 * without its password: a GET with `Upgrade: websocket` and `upgrade` among its `Connection` tokens.
 */
export function isWebSocketUpgrade(request: {
  readonly method: string
  readonly headers: Readonly<Record<string, string | undefined>>
}) {
  return (
    request.method === "GET" &&
    request.headers.upgrade?.toLowerCase() === "websocket" &&
    (request.headers.connection ?? "").split(",").some((token) => token.trim().toLowerCase() === "upgrade")
  )
}

/**
 * The same, for code that runs before the router has matched a route: the path is the request's own, up to its query,
 * compared as it was sent. A URL parser would resolve `..` and a leading `//host` to this path, and the router would not.
 */
export function isMachineLinkUpgrade(request: {
  readonly method: string
  readonly url: string
  readonly headers: Readonly<Record<string, string | undefined>>
}) {
  return request.url.split("?", 1)[0] === MACHINE_LINK_PATH && isWebSocketUpgrade(request)
}

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const MachineLinkEndpoint = HttpApiEndpoint.get("machine.link", MACHINE_LINK_PATH, {
  success: Schema.Boolean,
}).annotateMerge(
  OpenApi.annotations({
    identifier: "experimental.machine.link",
    summary: "Connect a machine",
    description:
      "Upgrade to a WebSocket that carries a machine's link to this server: binary messages only, each at most 65,535 bytes. It takes no server password. The link's own handshake, which starts with the machine's first message, is the only way in: it admits a key this server has paired or a valid join string, and closes the socket on anything else without saying why. Behind the machines flag; without it the route does not exist. Experimental: may change without compatibility guarantees.",
    transform: (operation) => ({ ...operation, "x-websocket": true, tags: ["experimental"] }),
  }),
)

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const MachineEndpoints = [
  MachineLinkEndpoint,
  HttpApiEndpoint.get("machine.list", "/api/experimental/machine", {
    success: Schema.Struct({ data: Schema.Array(MachineInfo) }),
    error: [ForbiddenError],
  }).annotateMerge(annotations("list", "List machines", "List known machines and whether each is paired and online.")),
  HttpApiEndpoint.post("machine.add", "/api/experimental/machine", {
    payload: MachineAddPayload,
    success: Schema.Struct({ data: MachineInvite }),
    error: [InvalidRequestError, ForbiddenError, MachineNotFoundError, ConflictError],
  }).annotateMerge(
    annotations(
      "add",
      "Add or invite a machine",
      "Add a machine by name if it does not exist, then create a single-use join string carrying the given reach addresses.",
    ),
  ),
  HttpApiEndpoint.delete("machine.remove", "/api/experimental/machine/:name", {
    params: { name: Schema.String },
    success: HttpApiSchema.NoContent,
    error: [ForbiddenError, MachineNotFoundError],
  }).annotateMerge(
    annotations("remove", "Remove a machine", "Forget a machine by name, closing any live link and revoking its key."),
  ),
] as const
