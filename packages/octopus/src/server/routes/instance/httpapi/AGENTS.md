# HttpApi Route Patterns

Use `HttpApiBuilder.group(...)` for normal HTTP endpoints, including streaming HTTP responses such as server-sent events. Handlers should yield stable services once while building the handler layer, then close over those services in endpoint implementations.

```ts
export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service

    return handlers.handle("list", () => session.list())
  }),
)
```

For SSE endpoints, stay in `HttpApiBuilder.group(...)` and return `HttpServerResponse.stream(...)` from the handler. Annotate the endpoint success schema with `HttpApiSchema.asText({ contentType: "text/event-stream" })` so OpenAPI documents the stream content type.

Use raw `HttpRouter.use(...)` only for routes that do not fit the request/response HttpApi model, such as WebSocket upgrade routes or catch-all fallback routes. Yield stable services at route-layer construction and close over them in `router.add(...)` callbacks.

```ts
export const rawRoute = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const pty = yield* Pty.Service

    yield* router.add("GET", PtyPaths.connect, (request) => connectPty(request, pty))
  }),
)
```

Avoid `Effect.provide(SomeLayer)` inside request handlers or raw route callbacks. Stable layers should be provided once at the application/layer boundary, not rebuilt or scoped per request.

Avoid `HttpRouter.provideRequest(...)` unless the dependency is intentionally request-level. Prefer `HttpRouter.use(...)` for stable app services.

Use `Effect.provideService(...)` in middleware only for request-derived context, such as `WorkspaceRouteContext`, `InstanceRef`, or `WorkspaceRef`. Do not use it to smuggle stable services through request effects when they can be yielded at layer construction.

Public JSON errors should be explicit `Schema.ErrorClass` contracts declared on each endpoint. Use built-in `HttpApiError.*` classes only when their empty/tagged body is the intended wire shape; for SDK-visible errors with messages, define an API error schema such as `ApiNotFoundError` and fail with that exact declared error. Keep domain and storage services free of HttpApi types, and translate expected domain errors at the handler boundary.

When adding middleware, compose it at the layer boundary and keep the route tree explicit in `server.ts`. Shared router middleware such as auth, workspace routing, and instance context should stay visible where routes are assembled.
