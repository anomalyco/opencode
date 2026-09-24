import { Effect } from "effect"
import { Endpoint } from "./route/endpoint.js"
import { invalidRequest } from "./route/errors.js"
import { MediaRoute } from "./route/media.js"
import type { MediaProtocol } from "./route/media-protocol.js"
import { type AIError, HttpOptions, ModelID, ProviderID } from "./schema/index.js"

/**
 * What every media model carries: ids, the configured route, and deployment `http` overlays. Modality classes
 * (`ImageModel`, `VideoModel`, `SpeechModel`) extend it with their route type and a nominal marker so one cannot stand
 * in for the other in requests.
 */
export class MediaModel<Route, Options> {
  declare protected readonly _Options: (options: Options) => Options
  readonly id: ModelID
  readonly provider: ProviderID
  readonly route: Route
  readonly http?: HttpOptions

  constructor(input: MediaModel.Input<Route>) {
    this.id = ModelID.make(input.id)
    this.provider = ProviderID.make(input.provider)
    this.route = input.route
    this.http = input.http
  }
}

export namespace MediaModel {
  export interface Input<Route> {
    readonly id: string | ModelID
    readonly provider: string | ProviderID
    readonly route: Route
    readonly http?: HttpOptions
  }

  /** A protocol plus its canonical start path; `ModelInput.baseURL` overrides `baseURL` per deployment. */
  export interface RouteInput<Request extends MediaRoute.MediaRequest, Protocol> {
    readonly protocol: Protocol
    readonly path: Endpoint.EndpointPart<MediaProtocol.Body, Request>
    readonly baseURL?: string
    /** Headers the protocol requires on every call, such as a pinned API version; deployment headers win. */
    readonly headers?: Record<string, string>
  }

  export type AnyRouteInput<Request extends MediaRoute.MediaRequest, Event, Response, Frame, State, Token> =
    | RouteInput<Request, MediaProtocol.Inline<Request, Response>>
    | RouteInput<MediaProtocol.Addressed<Request>, MediaProtocol.Streamed<Request, Event, Frame, State>>
    | RouteInput<Request, MediaProtocol.Queued<Request, Response, Token>>
}

/** Compose a protocol route input with one deployment through `MediaRoute.inline`, `queued`, or `stream`. */
export const composeRoute = <Request extends MediaRoute.MediaRequest, Protocol, Route>(
  compose: (input: MediaRoute.Composition<Request> & { readonly protocol: Protocol }) => Route,
  route: MediaModel.RouteInput<Request, Protocol>,
  input: MediaRoute.ModelInput,
): Route =>
  compose({
    protocol: route.protocol,
    endpoint: Endpoint.path(route.path, { baseURL: input.baseURL ?? route.baseURL }),
    auth: input.auth,
    headers:
      route.headers === undefined && input.headers === undefined ? undefined : { ...route.headers, ...input.headers },
  })

export const composeAnyRoute = <Request extends MediaRoute.MediaRequest, Event, Response, Frame, State, Token>(
  route: MediaModel.AnyRouteInput<Request, Event, Response, Frame, State, Token>,
  input: MediaRoute.ModelInput,
  collect: (events: ReadonlyArray<Event>) => Effect.Effect<Response, AIError>,
): MediaRoute.AnyRoute<Request, Event, Response> => {
  if (isStreamInput(route))
    return composeRoute((composition) => MediaRoute.stream({ ...composition, collect }), route, input)
  if (isQueuedInput(route)) return composeRoute(MediaRoute.queued, route, input)
  return composeRoute(MediaRoute.inline, route, input)
}

const isStreamInput = <Request extends MediaRoute.MediaRequest, Event, Response, Frame, State, Token>(
  route: MediaModel.AnyRouteInput<Request, Event, Response, Frame, State, Token>,
): route is MediaModel.RouteInput<
  MediaProtocol.Addressed<Request>,
  MediaProtocol.Streamed<Request, Event, Frame, State>
> => route.protocol.kind === "stream"

const isQueuedInput = <Request extends MediaRoute.MediaRequest, Event, Response, Frame, State, Token>(
  route: MediaModel.AnyRouteInput<Request, Event, Response, Frame, State, Token>,
): route is MediaModel.RouteInput<Request, MediaProtocol.Queued<Request, Response, Token>> =>
  route.protocol.kind === "queued"

/** Lift a synchronous Schema-class constructor into a typed `InvalidRequest` failure. */
export const tryRequest = <A>(make: () => A): Effect.Effect<A, AIError> =>
  Effect.try({
    try: make,
    catch: (error) => invalidRequest(error instanceof Error ? error.message : String(error), error),
  })
