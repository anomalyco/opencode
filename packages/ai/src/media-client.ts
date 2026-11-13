import { type Context, Effect, Layer, Stream } from "effect"
import { resultEvents, type AwaitOptions, type Generation, type Observation } from "./generation.js"
import { RequestExecutor } from "./route/executor.js"
import type { MediaRoute } from "./route/media.js"
import { AIError, UnsupportedOperationError, type ProviderID } from "./schema/index.js"

/** A media request whose model carries the route that executes it. */
export interface RoutedRequest<Self extends MediaRoute.MediaRequest, Event, Response> extends MediaRoute.MediaRequest {
  readonly model: MediaRoute.MediaRequest["model"] & { readonly route: MediaRoute.AnyRoute<Self, Event, Response> }
}

/** `start` and `resume` fail with `UnsupportedOperation` on inline and stream routes. */
export interface Interface<Req extends RoutedRequest<Req, Event, Response>, Event, Response> {
  readonly generate: (request: Req, options?: AwaitOptions) => Effect.Effect<Response, AIError>
  readonly stream: (request: Req, options?: AwaitOptions) => Stream.Stream<Event | Observation, AIError>
  readonly start: (request: Req) => Effect.Effect<Generation<Response>, AIError>
  readonly resume: (model: Req["model"], token: unknown) => Effect.Effect<Generation<Response>, AIError>
}

export interface Input<Event, Response> {
  readonly modality: string
  /** A completed response expanded into the streaming event shape. */
  readonly responseEvents: (response: Response) => ReadonlyArray<Event>
}

/** `${modality}.${operation}` on a route that is not queued. */
export const notQueued = (
  modality: string,
  route: { readonly provider: ProviderID; readonly id: string },
  operation: string,
) =>
  new AIError({
    reason: new UnsupportedOperationError({
      operation: `${modality}.${operation}`,
      provider: route.provider,
      route: route.id,
      message: `${route.provider}/${route.id} is not a queued route; use generate or stream`,
    }),
  })

/** One modality's operations over an executor, dispatching each request on its route's `kind`. */
export const operations = <Req extends RoutedRequest<Req, Event, Response>, Event, Response>(
  execute: MediaRoute.Execute,
  input: Input<Event, Response>,
): Interface<Req, Event, Response> => {
  const start = (request: Req) => {
    const route = request.model.route
    if (route.kind !== "queued") return Effect.fail(notQueued(input.modality, route, "start"))
    return route.start(request, execute)
  }
  return {
    start,
    resume: (model, token) => {
      if (model.route.kind !== "queued") return Effect.fail(notQueued(input.modality, model.route, "resume"))
      return model.route.resume(model, token, execute)
    },
    generate: (request, options) => {
      const route = request.model.route
      if (route.kind !== "queued") return route.generate(request, execute)
      return start(request).pipe(Effect.flatMap((generation) => generation.await(options)))
    },
    stream: (request, options) => {
      const route = request.model.route
      if (route.kind === "stream") return route.stream(request, execute)
      if (route.kind === "queued")
        return Stream.unwrap(
          start(request).pipe(Effect.map((generation) => resultEvents(generation, input.responseEvents, options))),
        )
      return Stream.fromIterableEffect(Effect.map(route.generate(request, execute), input.responseEvents))
    },
  }
}

/** One modality's layer and service accessors over `operations`. */
export const make = <Self, Req extends RoutedRequest<Req, Event, Response>, Event, Response>(
  service: Context.Service<Self, Interface<Req, Event, Response>>,
  input: Input<Event, Response>,
) => ({
  responseEvents: input.responseEvents,
  layer: Layer.effect(
    service,
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      return service.of(operations<Req, Event, Response>(executor.execute, input))
    }),
  ),
  generate: (request: Req, options?: AwaitOptions) => service.use((client) => client.generate(request, options)),
  stream: (request: Req, options?: AwaitOptions) =>
    Stream.unwrap(service.useSync((client) => client.stream(request, options))),
  start: (request: Req) => service.use((client) => client.start(request)),
  resume: (model: Req["model"], token: unknown) => service.use((client) => client.resume(model, token)),
})

export * as MediaClient from "./media-client.js"
