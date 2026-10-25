import { type Context, Effect, Layer, Stream } from "effect"
import { resultEvents, type AwaitOptions, type Generation, type Observation } from "./generation.js"
import { RequestExecutor } from "./route/executor.js"
import type { MediaRoute } from "./route/media.js"
import { AIError, UnsupportedOperationError } from "./schema/index.js"

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

/** One modality's layer and service accessors, dispatching each request on its route's `kind`. */
export const make = <Self, Req extends RoutedRequest<Req, Event, Response>, Event, Response>(
  service: Context.Service<Self, Interface<Req, Event, Response>>,
  input: {
    readonly modality: string
    /** A completed response expanded into the streaming event shape. */
    readonly responseEvents: (response: Response) => ReadonlyArray<Event>
  },
) => ({
  layer: Layer.effect(
    service,
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      const notQueued = (route: MediaRoute.AnyRoute<Req, Event, Response>, operation: string) =>
        new AIError({
          reason: new UnsupportedOperationError({
            operation: `${input.modality}.${operation}`,
            provider: route.provider,
            route: route.id,
            message: `${route.provider}/${route.id} is not a queued route; use generate or stream`,
          }),
        })
      const start = (request: Req) => {
        const route = request.model.route
        if (route.kind !== "queued") return Effect.fail(notQueued(route, "start"))
        return route.start(request, executor.execute)
      }
      return service.of({
        start,
        resume: (model, token) => {
          if (model.route.kind !== "queued") return Effect.fail(notQueued(model.route, "resume"))
          return model.route.resume(model, token, executor.execute)
        },
        generate: (request, options) => {
          const route = request.model.route
          if (route.kind !== "queued") return route.generate(request, executor.execute)
          return start(request).pipe(Effect.flatMap((generation) => generation.await(options)))
        },
        stream: (request, options) => {
          const route = request.model.route
          if (route.kind === "stream") return route.stream(request, executor.execute)
          if (route.kind === "queued")
            return Stream.unwrap(
              start(request).pipe(Effect.map((generation) => resultEvents(generation, input.responseEvents, options))),
            )
          return Stream.fromIterableEffect(Effect.map(route.generate(request, executor.execute), input.responseEvents))
        },
      })
    }),
  ),
  generate: (request: Req, options?: AwaitOptions) => service.use((client) => client.generate(request, options)),
  stream: (request: Req, options?: AwaitOptions) =>
    Stream.unwrap(service.useSync((client) => client.stream(request, options))),
  start: (request: Req) => service.use((client) => client.start(request)),
  resume: (model: Req["model"], token: unknown) => service.use((client) => client.resume(model, token)),
})

export * as MediaClient from "./media-client.js"
