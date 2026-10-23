import { defaultPort } from "./relay-helpers.ts"
import { NodeHttpClient } from "@effect/platform-node"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import {
  type AuthProfileRequest,
  type AuthenticatedJsonRequest,
  AuthenticatedJsonOutcome,
  AuthProfileSummary,
  type AuthRefreshRequest,
  type AuthRunRequest,
  AuthRunResponse,
  ErrorEnvelope,
  type ExecuteRequest,
  ExecuteResponse,
  ExtensionStatus,
  FlightRecorderCancelResponse,
  type FlightRecorderSaveRequest,
  FlightRecorderSaveResponse,
  type FlightRecorderStartRequest,
  FlightRecorderStatusResponse,
  NetworkCancelResponse,
  type NetworkSessionRequest,
  type NetworkStartRequest,
  NetworkStatusResponse,
  type NetworkStopRequest,
  NetworkStopResponse,
  RecordingCancelResponse,
  TabsCleanupResponse,
  type RecordingStartRequest,
  RecordingStartResponse,
  RecordingStatusResponse,
  RecordingStopResponse,
  type RecordingTargetRequest,
  RelayErrorCode,
  type RelayShutdownRequest,
  RelayShutdownResponse,
  RelayVersion,
  SessionAdoptResponse,
  SessionContainer,
  SessionDeleted,
  SessionsContainer,
  TargetSummaries,
  type SessionAdoptRequest,
  type SessionSummary,
  type TargetSummary,
} from "./relay-schema.ts"

/**
 * RelayClient is the single typed client for the relay HTTP API, shared by the
 * CLI and the MCP server. All responses are decoded against the shared wire
 * schemas in `src/relay-schema.ts`, and failures are tagged errors that keep
 * the relay's own error message as the top-level message.
 */

export const portConfig = Config.Int("OPENCODE_BROWSER_PORT").pipe(Config.withDefault(defaultPort))

/**
 * Extra `chrome-extension://<id>` origins to allowlist for the extension
 * WebSocket, comma- or whitespace-separated. This supports same-host unpacked
 * installs whose path-derived id cannot match the relay's bundled path. Parsed
 * by `parseAdditionalExtensionOrigins`.
 */
export const extensionOriginsConfig = Config.String("OPENCODE_BROWSER_EXTENSION_ORIGINS").pipe(Config.withDefault(""))

export const endpointForPort = (port: number): string => `http://127.0.0.1:${port}`

export class RelayUnreachable extends Schema.TaggedError<RelayUnreachable>()(
  "RelayClient.RelayUnreachable",
  {
    message: Schema.String,
    endpoint: Schema.String,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class RelayRejected extends Schema.TaggedError<RelayRejected>()(
  "RelayClient.RelayRejected",
  {
    message: Schema.String,
    status: Schema.Number,
    path: Schema.String,
    code: Schema.optionalKey(RelayErrorCode),
  },
) {}

export class RelayDecodeFailed extends Schema.TaggedError<RelayDecodeFailed>()(
  "RelayClient.RelayDecodeFailed",
  {
    message: Schema.String,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {}

class RelayEncodeFailed extends Schema.TaggedError<RelayEncodeFailed>()(
  "RelayClient.RelayEncodeFailed",
  {
    message: Schema.String,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class RelayConfigInvalid extends Schema.TaggedError<RelayConfigInvalid>()(
  "RelayClient.RelayConfigInvalid",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type RelayClientError = RelayUnreachable | RelayRejected | RelayDecodeFailed | RelayEncodeFailed

export interface Interface {
  readonly endpoint: string
  readonly version: Effect.Effect<RelayVersion, RelayClientError>
  readonly shutdown: (request: RelayShutdownRequest) => Effect.Effect<RelayShutdownResponse, RelayClientError>
  readonly extensionStatus: Effect.Effect<ExtensionStatus, RelayClientError>
  readonly targets: Effect.Effect<readonly TargetSummary[], RelayClientError>
  readonly sessions: Effect.Effect<readonly SessionSummary[], RelayClientError>
  readonly sessionNew: (id?: string | undefined, options?: { readonly readOnly?: boolean }) => Effect.Effect<SessionSummary, RelayClientError>
  readonly sessionEnsure: (id: string, options?: { readonly readOnly?: boolean }) => Effect.Effect<SessionSummary, RelayClientError>
  readonly sessionReset: (id: string) => Effect.Effect<SessionSummary, RelayClientError>
  readonly sessionAdopt: (request: SessionAdoptRequest) => Effect.Effect<SessionAdoptResponse, RelayClientError>
  readonly sessionDelete: (id: string) => Effect.Effect<SessionDeleted, RelayClientError>
  readonly execute: (request: ExecuteRequest) => Effect.Effect<ExecuteResponse, RelayClientError>
  readonly authenticatedJson: (request: AuthenticatedJsonRequest) => Effect.Effect<AuthenticatedJsonOutcome, RelayClientError>
  readonly networkStart: (request: NetworkStartRequest) => Effect.Effect<NetworkStatusResponse, RelayClientError>
  readonly networkStatus: (request: NetworkSessionRequest) => Effect.Effect<NetworkStatusResponse, RelayClientError>
  readonly networkStop: (request: NetworkStopRequest) => Effect.Effect<NetworkStopResponse, RelayClientError>
  readonly networkCancel: (request: NetworkSessionRequest) => Effect.Effect<NetworkCancelResponse, RelayClientError>
  readonly authStatus: (request: AuthProfileRequest) => Effect.Effect<AuthProfileSummary, RelayClientError>
  readonly authRefresh: (request: AuthRefreshRequest) => Effect.Effect<NetworkStopResponse, RelayClientError>
  readonly authRun: (request: AuthRunRequest) => Effect.Effect<AuthRunResponse, RelayClientError>
  readonly recordingStart: (request: RecordingStartRequest) => Effect.Effect<RecordingStartResponse, RelayClientError>
  readonly recordingStop: (target: RecordingTargetRequest) => Effect.Effect<RecordingStopResponse, RelayClientError>
  readonly recordingStatus: (target: RecordingTargetRequest) => Effect.Effect<RecordingStatusResponse, RelayClientError>
  readonly recordingCancel: (target: RecordingTargetRequest) => Effect.Effect<RecordingCancelResponse, RelayClientError>
  readonly tabsCleanup: (idleMinutes?: number) => Effect.Effect<TabsCleanupResponse, RelayClientError>
  readonly flightRecorderStart: (request: FlightRecorderStartRequest) => Effect.Effect<FlightRecorderStatusResponse, RelayClientError>
  readonly flightRecorderStatus: (target: RecordingTargetRequest) => Effect.Effect<FlightRecorderStatusResponse, RelayClientError>
  readonly flightRecorderSaveLast: (request: FlightRecorderSaveRequest) => Effect.Effect<FlightRecorderSaveResponse, RelayClientError>
  readonly flightRecorderCancel: (target: RecordingTargetRequest) => Effect.Effect<FlightRecorderCancelResponse, RelayClientError>
}

export class Service extends Context.Service<Service, Interface>()("opencode-browser-cli/RelayClient") {}

const decodeErrorEnvelope = Schema.decodeUnknownOption(ErrorEnvelope)
const decodeErrorMessage = Schema.decodeUnknownOption(Schema.Struct({ error: Schema.String }))

export const make = Effect.fn("RelayClient.make")(function* (options?: { readonly endpoint?: string }) {
  const port = yield* portConfig.pipe(
    Effect.mapError((cause) => new RelayConfigInvalid({
      message: `Invalid OPENCODE_BROWSER_PORT configuration: ${cause.message}`,
      cause,
    })),
  )
  const endpoint = options?.endpoint ?? endpointForPort(port)
  const httpClient = yield* HttpClient.HttpClient

  const readBody = (
    response: HttpClientResponse.HttpClientResponse,
    path: string,
  ): Effect.Effect<unknown, RelayDecodeFailed> =>
    response.json.pipe(
      Effect.mapError((cause) =>
        new RelayDecodeFailed({
          message: `Relay returned an unreadable response for ${path}`,
          path,
          cause,
        })
      ),
    )

  const handleResponse = <A>(
    response: HttpClientResponse.HttpClientResponse,
    path: string,
    schema: Schema.ConstraintDecoder<A>,
  ): Effect.Effect<A, RelayClientError> =>
    readBody(response, path).pipe(
      Effect.flatMap((body): Effect.Effect<A, RelayClientError> => {
        if (response.status < 200 || response.status >= 300) {
          const envelope = decodeErrorEnvelope(body)
          const message = Option.isSome(envelope)
            ? envelope.value.error
            : Option.getOrElse(Option.map(decodeErrorMessage(body), (value) => value.error), () => `Relay responded with HTTP ${response.status} for ${path}`)
          return Effect.fail(new RelayRejected({
            message,
            status: response.status,
            path,
            ...(Option.isSome(envelope) && envelope.value.code ? { code: envelope.value.code } : {}),
          }))
        }
        return Schema.decodeUnknownEffect(schema)(body).pipe(
          Effect.mapError((cause) =>
            new RelayDecodeFailed({
              message: `Relay response for ${path} did not match the expected shape: ${cause.message}`,
              path,
              cause,
            })
          ),
        )
      }),
    )

  const transportError = (path: string) => (cause: unknown) =>
    new RelayUnreachable({
      message: `OpenCode Browser relay is not reachable at ${endpoint}. Relay-backed CLI commands start it automatically; use \`opencode-browser serve\` only for foreground debugging.`,
      endpoint,
      path,
      cause,
    })

  const getJson = <A>(path: string, schema: Schema.ConstraintDecoder<A>): Effect.Effect<A, RelayClientError> =>
    httpClient.get(new URL(path, endpoint)).pipe(
      Effect.mapError(transportError(path)),
      Effect.flatMap((response) => handleResponse(response, path, schema)),
    )

  const postJson = <A>(
    path: string,
    body: Record<string, unknown>,
    schema: Schema.ConstraintDecoder<A>,
  ): Effect.Effect<A, RelayClientError> => HttpClientRequest.post(new URL(path, endpoint)).pipe(
    HttpClientRequest.bodyJson(body),
    Effect.mapError((cause) => new RelayEncodeFailed({
      message: `Could not encode relay request for ${path}`,
      path,
      cause,
    })),
    Effect.flatMap((request) => httpClient.execute(request).pipe(
      Effect.mapError(transportError(path)),
      Effect.flatMap((response) => handleResponse(response, path, schema)),
    )),
  )

  const recordingTargetBody = (target: { readonly sessionId?: string | undefined; readonly tabId?: number | undefined }): Record<string, unknown> => ({
    ...(target.sessionId ? { sessionId: target.sessionId } : {}),
    ...(target.tabId === undefined ? {} : { tabId: target.tabId }),
  })

  const recordingTargetQuery = (target: RecordingTargetRequest): string => {
    const searchParams = new URLSearchParams()
    if (target.sessionId) {
      searchParams.set("sessionId", target.sessionId)
    }
    if (target.tabId !== undefined) {
      searchParams.set("tabId", String(target.tabId))
    }
    const text = searchParams.toString()
    return text ? `?${text}` : ""
  }

  return Service.of({
    endpoint,
    version: getJson("/version", RelayVersion),
    shutdown: (request) => postJson("/shutdown", { ...request }, RelayShutdownResponse),
    extensionStatus: getJson("/extension/status", ExtensionStatus),
    targets: getJson("/json/list", TargetSummaries),
    sessions: getJson("/cli/sessions", SessionsContainer).pipe(Effect.map((container) => container.sessions)),
    sessionNew: (id, options) =>
      postJson("/cli/session/new", {
        ...(id ? { id } : {}),
        ...(options?.readOnly ? { readOnly: true } : {}),
      }, SessionContainer).pipe(Effect.map((container) => container.session)),
    sessionEnsure: (id, options) =>
      postJson("/v1/sessions/ensure", {
        id,
        ...(options?.readOnly === undefined ? {} : { readOnly: options.readOnly }),
      }, SessionContainer).pipe(Effect.map((container) => container.session)),
    sessionReset: (id) =>
      postJson("/cli/session/reset", { id }, SessionContainer).pipe(Effect.map((container) => container.session)),
    sessionAdopt: ({ sessionId, ...request }) =>
      postJson("/cli/session/adopt", {
        ...request,
        ...(sessionId ? { sessionId } : {}),
      }, SessionAdoptResponse),
    sessionDelete: (id) => postJson("/cli/session/delete", { id }, SessionDeleted),
    execute: ({ sessionId, ...request }) =>
      postJson("/cli/execute", {
        ...request,
        ...(sessionId ? { sessionId } : {}),
      }, ExecuteResponse),
    authenticatedJson: (request) => postJson("/v1/authenticated-origin/json", { ...request }, AuthenticatedJsonOutcome),
    networkStart: (request) => postJson("/network/start", { ...request }, NetworkStatusResponse),
    networkStatus: (request) => postJson("/network/status", { ...request }, NetworkStatusResponse),
    networkStop: (request) => postJson("/network/stop", { ...request }, NetworkStopResponse),
    networkCancel: (request) => postJson("/network/cancel", { ...request }, NetworkCancelResponse),
    authStatus: (request) => postJson("/auth/status", { ...request }, AuthProfileSummary),
    authRefresh: (request) => postJson("/auth/refresh", { ...request }, NetworkStopResponse),
    authRun: (request) => postJson("/auth/run", { ...request }, AuthRunResponse),
    recordingStart: ({ sessionId, tabId, ...request }) =>
      postJson("/recording/start", { ...recordingTargetBody({ sessionId, tabId }), ...request }, RecordingStartResponse),
    recordingStop: (target) => postJson("/recording/stop", recordingTargetBody(target), RecordingStopResponse),
    recordingStatus: (target) => getJson(`/recording/status${recordingTargetQuery(target)}`, RecordingStatusResponse),
    recordingCancel: (target) => postJson("/recording/cancel", recordingTargetBody(target), RecordingCancelResponse),
    tabsCleanup: (idleMinutes) => postJson("/tabs/cleanup", idleMinutes === undefined ? {} : { idleMinutes }, TabsCleanupResponse),
    flightRecorderStart: ({ sessionId, tabId, ...request }) =>
      postJson("/flight-recorder/start", { ...recordingTargetBody({ sessionId, tabId }), ...request }, FlightRecorderStatusResponse),
    flightRecorderStatus: (target) => getJson(`/flight-recorder/status${recordingTargetQuery(target)}`, FlightRecorderStatusResponse),
    flightRecorderSaveLast: ({ sessionId, tabId, ...request }) =>
      postJson("/flight-recorder/save-last", { ...recordingTargetBody({ sessionId, tabId }), ...request }, FlightRecorderSaveResponse),
    flightRecorderCancel: (target) => postJson("/flight-recorder/cancel", recordingTargetBody(target), FlightRecorderCancelResponse),
  })
})

const layer: Layer.Layer<Service, RelayConfigInvalid, HttpClient.HttpClient> = Layer.effect(Service, make())

/** RelayClient backed by `node:http` (avoiding undici's 5-minute headersTimeout on long handoffs/commands), for standalone CLI/MCP wiring. */
export const layerFetch: Layer.Layer<Service, RelayConfigInvalid> = layer.pipe(Layer.provide(NodeHttpClient.layerNodeHttp))
