# Typed error migration

Plan for moving `packages/opencode` from temporary defect/`NamedError`
compatibility toward typed Effect service errors and explicit HTTP error
contracts.

## Goal

- Expected service failures live on the Effect error channel.
- Service interfaces expose those failures in their return types.
- Domain errors are authored with Effect Schema so they are reusable by services,
  tests, HTTP routes, tools, and OpenAPI generation.
- HTTP status codes and wire compatibility are handled at the HTTP boundary, not
  inside service modules.
- `Effect.die`, `throw`, `catchDefect`, and global cause inspection are reserved
  for defects, compatibility bridges, or final fallback behavior.

## Current State

- Many migrated services use Effect internally, but expected failures are still a
  mix of `NamedError.create(...)`, `namedSchemaError(...)`, `class extends Error`,
  `throw`, and `Effect.die(...)`.
- Some services already use `Schema.TaggedErrorClass`, for example `Account`,
  `Auth`, `Permission`, `Question`, `Installation`, and parts of
  `Workspace`.
- The temporary HttpApi compatibility middleware recognizes `NamedError`,
  `Session.BusyError`, and a few name-based cases, then emits the legacy
  `{ name, data }` JSON body.
- Effect `HttpApi` only knows how to encode errors that are declared on the
  endpoint, group, or middleware. Undeclared expected errors become defects and
  eventually fall through to generic HTTP handling.
- The temporary HttpApi error middleware catches defect-wrapped legacy errors to
  preserve runtime behavior, but it is intentionally a bridge rather than the
  final model.

## End State

Service modules own domain failures.

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

HTTP modules own transport mapping.

```ts
const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
  return yield* session
    .get(ctx.params.sessionID)
    .pipe(
      Effect.catchTag("StorageNotFoundError", () => new SessionNotFoundHttpError({ sessionID: ctx.params.sessionID })),
    )
})
```

HTTP-visible error schemas carry their own response status through Effect
HttpApi's `httpApiStatus` annotation. Prefer `HttpApiSchema.status(...)`, or the
equivalent declaration annotation, instead of maintaining a parallel status map.

```ts
export class SessionNotFoundHttpError extends Schema.TaggedErrorClass<SessionNotFoundHttpError>()(
  "SessionNotFoundHttpError",
  {
    sessionID: SessionID,
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}
```

Endpoint definitions still declare which HTTP-visible error schemas can be
emitted. The status annotation is only used if the error is part of the endpoint,
group, or middleware error schema and the handler fails with that error on the
typed error channel.

```ts
HttpApiEndpoint.get("get", SessionPaths.get, {
  success: Session.Info,
  error: [SessionNotFoundHttpError, SessionBusyHttpError],
})
```

The service error and HTTP error may be the same class when the wire shape is a
deliberate public contract. They should be different classes when the service
error contains internals, low-level causes, retry hints, or anything that should
not be exposed to API clients.

## Rules

- Use `Schema.TaggedErrorClass` for new expected domain errors.
- Include `cause: Schema.optional(Schema.Defect)` only when preserving an
  underlying unknown failure is useful for logs or callers.
- Export a domain-level error union from each service module, for example
  `export type Error = NotFoundError | BusyError | Storage.Error`.
- Put expected errors in service method signatures, for example
  `Effect.Effect<Result, Service.Error, R>`.
- Use `yield* new DomainError(...)` for direct early failures inside
  `Effect.gen` / `Effect.fn`.
- Use `Effect.try({ try, catch })`, `Effect.mapError`, or `Effect.catchTag` to
  convert external exceptions into domain errors.
- Use `HttpApiSchema.status(...)` or `{ httpApiStatus: code }` on HTTP-visible
  error schemas so Effect `HttpApiBuilder` and OpenAPI generation get the status
  from the schema itself.
- Do not use `Effect.die(...)` for user, IO, validation, missing-resource, auth,
  provider, worktree, or busy-state failures.
- Do not use `catchDefect` to recover expected domain errors. If recovery is
  needed, the upstream effect should fail with a typed error instead.
- Do not make service modules import `HttpApiError`, `HttpServerResponse`, HTTP
  status codes, or route-specific error schemas.
- Keep raw `HttpRouter` routes free to use `HttpServerRespondable` when that is
  the right transport abstraction, but prefer declared `HttpApi` errors for
  normal JSON API endpoints.

## HTTP Boundary Shape

Create an HttpApi-local error module, likely
`src/server/routes/instance/httpapi/errors.ts`.

That module should provide:

- Legacy-compatible public schemas for `{ name, data }` error bodies that must
  remain SDK-compatible while route groups declare typed errors.
- Small constructors or mapping helpers for common API errors such as not found,
  bad request, conflict, and unknown internal errors.
- Route-group-specific adapters only when they encode domain-specific public
  data.
- A single place to document which public error shape is legacy-compatible and
  which shape is new Effect-native API surface.

Avoid one giant `unknown -> status` mapper. Prefer small, explicit mappers close
to the handler or route group.

```ts
const mapSessionError = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchTag("StorageNotFoundError", (error) => new SessionNotFoundHttpError({ message: error.message })),
    Effect.catchTag("SessionBusyError", (error) => new SessionBusyHttpError({ message: error.message })),
  )
```

Use built-in `HttpApiError.BadRequest`, `HttpApiError.NotFound`, and related
types only when their generated response body and SDK surface are intentionally
acceptable. Use a custom schema-backed error when clients need the legacy
`{ name, data }` body or a domain-specific error payload.

## Migration Phases

### 1. Stabilize The Bridge

Keep the temporary HttpApi error middleware only as a compatibility bridge while
typed errors are introduced.

- Add tests that prove the bridge catches legacy `NamedError` defects.
- Add tests that prove declared HttpApi errors still use the declared endpoint
  contract.
- Stop returning stack traces in unknown HTTP `500` responses; log the full
  `Cause.pretty(cause)` server-side instead.
- Add a comment or TODO that names this plan and states the bridge must shrink
  as route groups migrate.

### 2. Define The Shared HTTP Error Helpers

Add the `httpapi/errors.ts` module before converting route groups.

- Define a legacy `{ name, data }` body helper for SDK-compatible errors.
- Define `UnknownError` for generic internal failures with a safe public message.
- Define `BadRequestError` and `NotFoundError` equivalents only if the actual
  wire body must match the existing SDK surface.
- Put the HTTP status on the public schema with `HttpApiSchema.status(...)` or
  `{ httpApiStatus: code }`; do not keep a separate name-to-status table.
- Keep conversion helpers pure and small. They should not inspect `Cause` or
  accept `unknown` unless they are final fallback helpers.

### 3. Convert One Vertical Slice

Start with session read routes because they already have local `mapNotFound`
logic and are heavily covered by existing HttpApi tests.

- Convert `Session.BusyError` from a plain `Error` to a typed service error, or
  add a typed wrapper while preserving the old constructor until callers are
  migrated.
- Replace `catchDefect` in `httpapi/handlers/session.ts` with typed error
  mapping.
- Add endpoint error schemas for the affected session endpoints.
- Prove behavior with focused tests in `test/server/httpapi-session.test.ts`.
- Remove the migrated cases from the global compatibility middleware.

### 4. Convert Legacy NamedError Domains

Move legacy `NamedError.create(...)` services to Effect Schema-backed errors in
small domain PRs.

Priority order:

1. `storage/storage.ts` and `storage/db.ts` not-found errors.
2. `worktree/index.ts` `Worktree*` errors.
3. `provider/auth.ts` validation failures and `provider/provider.ts` model-not-found errors.
4. `mcp/index.ts`, `skill/index.ts`, `lsp/client.ts`, and `ide/index.ts` service errors.
5. Config and CLI-only errors after HTTP-facing domains are stable.

For each domain:

- Replace `NamedError.create(...)` with `Schema.TaggedErrorClass` when the error
  is primarily a service error.
- Keep or add a separate HTTP error schema when the legacy `{ name, data }` wire
  shape must remain stable.
- Update service interface return types to include the new error union.
- Replace `throw new X(...)` inside `Effect.fn` with `yield* new X(...)`.
- Replace async exceptions with `Effect.try({ catch })` or explicit `mapError`.
- Add service-level tests that assert the error tag and data, not just the HTTP
  status.

### 5. Declare HttpApi Errors Group By Group

For each HttpApi group:

- Inventory every service call and the typed errors it can return.
- Add only the public error schemas that endpoint can actually emit.
- Map service errors to HTTP errors in the handler file.
- Keep built-in `HttpApiError` only for generic request/validation failures where
  the generated contract is accepted.
- Update `httpapi/public.ts` compatibility transforms only when the generated
  spec cannot represent the desired source shape directly.
- Regenerate the SDK after OpenAPI-visible changes and verify the diff is
  intentional.

Suggested route order:

1. `session` not-found and busy-state reads.
2. `experimental` worktree mutations.
3. `provider` auth and model selection errors.
4. `mcp` OAuth and connection errors.
5. Remaining route groups as typed error contracts are declared.

### 6. Remove Defect Recovery

After enough route groups declare their expected errors:

- Delete `catchDefect` recovery for domain errors.
- Delete name-prefix checks such as `error.name.startsWith("Worktree")` from
  HTTP middleware.
- Delete `NamedError` branches from the Effect HttpApi compatibility middleware
  once no Effect route depends on them.
- Leave one final unknown-defect fallback that logs server-side and returns a
  safe generic `500` body.

## Inventory Checklist

Use this checklist when touching a service or route group.

- [ ] Does the service interface expose every expected failure in the Effect
      error type?
- [ ] Are user-caused, provider-caused, IO, auth, missing-resource, and busy-state
      failures modeled as typed errors instead of defects?
- [ ] Does the service avoid importing HTTP status, `HttpApiError`, or response
      classes?
- [ ] Does the handler map each service error into a declared endpoint error?
- [ ] Does the endpoint `error` field include every public error the handler can
      emit?
- [ ] Does OpenAPI/SDK output either stay byte-identical or have an explicitly
      reviewed diff?
- [ ] Do tests cover both service-level error typing and HTTP-level status/body?
- [ ] Did the PR remove any now-unneeded case from the temporary compatibility
      middleware?

## Testing Requirements

For service conversions:

- Test the service method directly with `testEffect(...)`.
- Assert on `_tag` or class identity and the structured fields.
- Avoid testing by string-matching `Cause.pretty(...)`.

For HttpApi conversions:

- Add or update the focused `test/server/httpapi-*.test.ts` file.
- Assert status code, content type, and exact JSON body for declared public
  errors.
- Add a regression test that the temporary middleware is no longer needed for the
  migrated route.
- Keep compatibility tests aligned with the existing SDK contract until the
  public error shape intentionally changes.

## Verification Commands

Run from `packages/opencode` unless noted otherwise.

```bash
bun run prettier --write <changed files>
bunx oxlint <changed files>
bun typecheck
bun run test -- test/server/httpapi-session.test.ts
```

Run SDK generation from the repo root when schemas or OpenAPI-visible errors
change.

```bash
./packages/sdk/js/script/build.ts
```

## Open Questions

- Should legacy V1 routes keep `{ name, data }` forever while V2 routes expose a
  more Effect-native tagged error body?
- Should storage not-found remain generic, or should callers map it to
  domain-specific not-found errors before crossing service boundaries?
- Should `namedSchemaError(...)` stay as a long-term public-wire helper, or only
  as a migration bridge for old `NamedError` contracts?
- Which SDK version boundary lets us stop remapping built-in Effect HttpApi error
  schemas in `httpapi/public.ts`?

## Success Criteria

- New service code no longer uses `die` for expected failures.
- A route reviewer can read an endpoint definition and see every public error it
  can return.
- The temporary HttpApi error middleware shrinks over time instead of gaining new
  name-based cases.
- Service tests prove domain error types without going through HTTP.
- HTTP tests prove status/body contracts without relying on defect recovery.
