# Typed Error Migration

This note expands the `ERR`, `RENDER`, and `HTTP` tracks from
[`todo.md`](./todo.md). It is the current reference for expected failures,
typed service errors, and HTTP error boundaries.

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

The service error and HTTP error may be the same class only when the wire
shape is intentionally public. Use separate HTTP error schemas when the
service error contains internals, low-level causes, retry hints, or data
that should not be exposed to API clients.

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

## Middleware Guidance

HTTP middleware should be cross-cutting: auth, context, schema decode
formatting, routing, and final unknown-defect fallback.

The current compatibility middleware still knows about some legacy domain
errors. As route groups declare expected errors and handlers map them, that
middleware should shrink. It should not gain new name checks.

Unknown `500` responses should log full details server-side with
`Cause.pretty(cause)` and return a safe public body.

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

## Checklist For A PR

- [ ] Expected failures are typed errors, not defects.
- [ ] Service method signatures expose the expected error union.
- [ ] HTTP handlers translate domain errors at the boundary.
- [ ] Public HTTP error bodies preserve existing wire contracts.
- [ ] Generic middleware gets smaller or stays unchanged.
- [ ] Focused tests cover the service error and any public HTTP response.
