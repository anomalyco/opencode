import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { described } from "./metadata"

const root = "/connector"

/**
 * GitHub connector HTTP surface.
 *
 * The web app cannot talk to GitHub's device-flow endpoints directly (they
 * don't allow CORS), so the Jarvis server proxies the flow here. The access
 * token is stored in the server Credential store (like provider credentials)
 * and is never exposed to the browser.
 */

export const GitHubUser = Schema.Struct({
  login: Schema.String,
  avatar: Schema.String,
  name: Schema.optional(Schema.String),
})
export type GitHubUser = Schema.Schema.Type<typeof GitHubUser>

export const GitHubConnectorStatus = Schema.Struct({
  enabled: Schema.Boolean,
  connected: Schema.Boolean,
  user: Schema.optional(GitHubUser),
})
export type GitHubConnectorStatus = Schema.Schema.Type<typeof GitHubConnectorStatus>

export const DeviceFlowStart = Schema.Struct({
  sessionId: Schema.String,
  userCode: Schema.String,
  verificationUri: Schema.String,
  interval: Schema.Number,
  expiresIn: Schema.Number,
})
export type DeviceFlowStart = Schema.Schema.Type<typeof DeviceFlowStart>

export const DeviceFlowPoll = Schema.Union([
  Schema.Struct({ status: Schema.Literal("success"), user: GitHubUser }),
  Schema.Struct({ status: Schema.Literal("pending"), slowDown: Schema.optional(Schema.Boolean) }),
  Schema.Struct({ status: Schema.Literal("expired") }),
  Schema.Struct({ status: Schema.Literal("denied") }),
  Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
]).pipe(Schema.toTaggedUnion("status"))
export type DeviceFlowPoll = Schema.Schema.Type<typeof DeviceFlowPoll>

export class ConnectorApiError extends Schema.ErrorClass<ConnectorApiError>("ConnectorApiError")({
  name: Schema.Literal("BadRequest"),
  data: Schema.Struct({
    message: Schema.optional(Schema.String),
  }),
}, { httpApiStatus: 400 }) {}

export const ConnectorApi = HttpApi.make("connector")
  .add(
    HttpApiGroup.make("connector")
      .add(
        HttpApiEndpoint.get("status", `${root}/github/status`, {
          success: described(GitHubConnectorStatus, "GitHub connector status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "connector.github.status",
            summary: "Get GitHub connector status",
            description: "Whether the GitHub connector is enabled and connected, and which user is linked.",
          }),
        ),
        HttpApiEndpoint.post("setEnabled", `${root}/github/set-enabled`, {
          payload: Schema.Struct({ enabled: Schema.Boolean }),
          success: described(GitHubConnectorStatus, "GitHub connector status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "connector.github.setEnabled",
            summary: "Enable or disable the GitHub connector",
            description: "Toggles the connector Switch. Disabling keeps the stored token (re-enabling is instant).",
          }),
        ),
        HttpApiEndpoint.post("device", `${root}/github/device`, {
          success: described(DeviceFlowStart, "Device-flow authorization start"),
          error: ConnectorApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "connector.github.device",
            summary: "Start a GitHub device-flow authorization",
            description: "Starts RFC 8628 device flow and returns the user code to display. The device_code stays server-side.",
          }),
        ),
        HttpApiEndpoint.post("poll", `${root}/github/poll`, {
          payload: Schema.Struct({ sessionId: Schema.String }),
          success: described(DeviceFlowPoll, "Device-flow poll result"),
          error: ConnectorApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "connector.github.poll",
            summary: "Poll the GitHub device-flow attempt",
            description: "Polls until the user authorizes. On success the server stores the token and returns the linked user.",
          }),
        ),
        HttpApiEndpoint.post("disconnect", `${root}/github/disconnect`, {
          success: described(GitHubConnectorStatus, "GitHub connector status"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "connector.github.disconnect",
            summary: "Disconnect the GitHub connector",
            description: "Removes the stored token and disconnects the account. The connector resets to disabled (the token is the single source of truth server-side).",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "connector",
          description: "External service connectors proxied through the Jarvis server (web support).",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "connector",
      version: "0.0.1",
      description: "External service connectors proxied through the Jarvis server.",
    }),
  )
