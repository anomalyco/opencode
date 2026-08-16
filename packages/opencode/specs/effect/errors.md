# Typed Error Migration

This note expands the `ERR`, `RENDER`, and `HTTP` tracks from
[`todo.md`](./todo.md). It is the current reference for expected failures,
typed service errors, and HTTP error boundaries.

For the migration architecture and queue, see
[`error-boundaries-plan.md`](./error-boundaries-plan.md).

## Goal

- Expected service failures live on the Effect error channel.
- Service interfaces expose those failures in their return types.
- Domain errors are authored with `Schema.TaggedErrorClass`.
- `Effect.die(...)` is reserved for defects: bugs, impossible states,
  violated invariants, and final unknown-boundary fallbacks.
- HTTP status codes and public wire bodies are handled at HTTP route
  boundaries, not inside service modules.
- User-facing boundaries render useful structured error details instead of
  opaque `Error: SomeName` strings.

## Service Error Shape

```ts
export class SessionBusyError extends Schema.TaggedErrorClass<SessionBusyError>()("SessionBusyError", {
  sessionID: SessionID,
  message: Schema.String,
}) {}

export type Error = Storage.Error | SessionBusyError

export interface Interface {
  readonly get: (id: SessionID) => Effect.Effect<Info, Error>
}
```

Rules:

- Use `Schema.TaggedErrorClass` for expected domain failures.
- Export a domain-level `Error` union from each service module.
- Put expected errors in service method signatures.
- Use `yield* new DomainError(...)` for direct early failures in
  `Effect.gen` / `Effect.fn`.
- Use `Schema.Defect` for unknown cause fields when preserving the cause is
  useful for logs or callers.
- Use `Effect.try(...)`, `Effect.tryPromise(...)`, `Effect.mapError`,
  `Effect.catchTag`, and `Effect.catchTags` to translate external
  failures into domain errors.
- Do not use `throw`, `Effect.die(...)`, or `catchDefect` for expected
  user, IO, validation, missing-resource, auth, provider, worktree, or
  busy-state failures.

## HTTP Boundary Shape

Service modules stay transport-agnostic. They should not import HTTP
status codes, `HttpApiError`, `HttpServerResponse`, or route-specific
error schemas.

HTTP handlers translate service errors into public endpoint errors:

```ts
const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
  return yield* session
    .get(ctx.params.sessionID)
    .pipe(Effect.catchTag("StorageNotFoundError", () => notFound("Session not found")))
})
```

Endpoint definitions declare which public errors can be emitted. Public
HTTP error schemas carry their response status with `httpApiStatus` or the
equivalent HttpApi schema annotation.

Effect's own HttpApi examples follow this pattern:

```ts
export class Unauthorized extends Schema.TaggedErrorClass<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  {
    provides: CurrentUser
  }
>()("app/Authorization", {
  security: { bearer: HttpApiSecurity.bearer },
  error: Unauthorized,
}) {}
```

Endpoint-level errors use the same idea:

```ts
export class ConfigApiError extends Schema.ErrorClass<ConfigApiError>("ConfigApiError")(
  {
    name: Schema.Union(Schema.Literal("ConfigInvalidError"), Schema.Literal("ConfigJsonError")),
    data: Schema.Struct({ message: Schema.optional(Schema.String), path: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}

HttpApiEndpoint.get("get", "/config", {
  success: Config.Info,
  error: ConfigApiError,
})
```

The service error and HTTP error may be the same class only when the wire
shape is intentionally public. Use separate HTTP error schemas when the
service error contains internals, low-level causes, retry hints, or data
that should not be exposed to API clients.

Do not map every domain error into one universal HTTP error class. Prefer a
small public error vocabulary by route group: shared shapes like
`ApiNotFoundError`, route-specific shapes like `ConfigApiError`, and built-in
empty `HttpApiError.*` only when an empty/no-content body is the intended SDK
contract.

## Mapping Guidance

- Keep one-off translations inline in the handler.
- Extract tiny shared helpers when the same translation repeats across a
  route group.
- Do not create one giant `unknown -> status` mapper.
- Do not grow generic HTTP middleware into a registry of domain errors.
- Preserve existing public `{ name, data }` bodies until a deliberate
  breaking API change.
- Use built-in `HttpApiError.*` only when its generated body and SDK
  surface are intentionally the public contract.
- Prefer `Schema.ErrorClass` for public HTTP error bodies whose wire shape is
  not the same as the internal domain error shape.
- Prefer `Schema.TaggedErrorClass` for service/domain errors and middleware
  errors that are naturally tagged by `_tag`.
- If preserving a legacy `{ name, data }` body, model that shape explicitly in
  the public API error schema instead of relying on `NamedError.toObject()` in
  generic middleware.

## User-Facing Rendering

HTTP serialization and user rendering are separate boundaries. The server
should send structured public errors; CLI and TUI code should format those
structures through one shared formatter.

For SDK calls using `{ throwOnError: true }`, the generated client may wrap the
decoded response body in an `Error`. The original body should remain available
under `error.cause.body`; `FormatError` is the right place to unwrap and render
that body. TUI aggregation helpers should call `FormatError` first, then fall
back to generic `Error.message` / string rendering.

When several parallel startup requests fail from the same underlying issue,
group identical rendered messages and list the affected request names once.
For example:

```text
Configuration is invalid at /path/to/opencode.json
↳ Expected object, got "not-object" provider.bad.options
Affected startup requests: config.providers, provider.list, app.agents, config.get
```

## Middleware Guidance

HTTP middleware should be cross-cutting: auth, context, schema decode
formatting, routing, and final unknown-defect fallback.

The current compatibility middleware still knows about some legacy domain
errors. As route groups declare expected errors and handlers map them, that
middleware should shrink. It should not gain new name checks.

Unknown `500` responses should log full details server-side with
`Cause.pretty(cause)` and return a safe public body.

The config startup regression in #27056 is the failure mode this rule is meant
to avoid: a user-authored invalid `opencode.json` crossed the HttpApi boundary
as a defect, so middleware replaced a useful `ConfigInvalidError` with a safe
generic `UnknownError`. The compatibility fix is to preserve config parse and
validation errors as client-visible `400`s. The target architecture is better:
config loading should fail on the typed error channel, config HTTP handlers
should map those errors to declared `ConfigApiError` responses, and the generic
middleware should never see them.

## Migration Order

Prefer small vertical slices:

1. Fix rendering at one user-visible boundary.
2. Convert one service domain to `Schema.TaggedErrorClass` errors.
3. Map those errors at the affected HTTP handlers.
4. Remove the corresponding name-based middleware branch if possible.
5. Add or update focused tests for both service error tags and HTTP wire
   bodies.

Good early domains are storage not-found, worktree errors, and provider
auth validation errors because they currently drive HTTP behavior.

Config parse and validation errors are also a good early slice because they
are startup-blocking and must be rendered clearly in both CLI and TUI flows.

## Checklist For A PR

- [ ] Expected failures are typed errors, not defects.
- [ ] Service method signatures expose the expected error union.
- [ ] HTTP handlers translate domain errors at the boundary.
- [ ] Public HTTP error bodies preserve existing wire contracts.
- [ ] Generic middleware gets smaller or stays unchanged.
- [ ] Focused tests cover the service error and any public HTTP response.
