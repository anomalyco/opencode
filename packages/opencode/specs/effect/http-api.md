# HttpApi migration

Practical notes for an eventual migration of `packages/opencode` server routes from the current Hono handlers to Effect `HttpApi`, either as a full replacement or as a parallel surface.

## Goal

Use Effect `HttpApi` where it gives us a better typed contract for:

- route definition
- request decoding and validation
- typed success and error responses
- OpenAPI generation
- handler composition inside Effect

This should be treated as a later-stage HTTP boundary migration, not a prerequisite for ongoing service, route-handler, or schema work.

## Core model

`HttpApi` is definition-first.

- `HttpApi` is the root API
- `HttpApiGroup` groups related endpoints
- `HttpApiEndpoint` defines a single route and its request / response schemas
- handlers are implemented separately from the contract

This is a better fit once route inputs and outputs are already moving toward Effect Schema-first models.

## Why it is relevant here

The current route-effectification work is already pushing handlers toward:

- one `AppRuntime.runPromise(Effect.gen(...))` body
- yielding services from context
- using typed Effect errors instead of Promise wrappers

That work is a good prerequisite for `HttpApi`. Once the handler body is already a composed Effect, the remaining migration is mostly about replacing the Hono route declaration and validator layer.

## What HttpApi gives us

### Contracts

Request params, query, payload, success payloads, and typed error payloads are declared in one place using Effect Schema.

### Validation and decoding

Incoming data is decoded through Effect Schema instead of hand-maintained Zod validators per route.

### OpenAPI

`HttpApi` can derive OpenAPI from the API definition, which overlaps with the current `describeRoute(...)` and `resolver(...)` pattern.

### Typed errors

`Schema.TaggedErrorClass` maps naturally to endpoint error contracts.

## Likely fit for opencode

Best fit first:

- JSON request / response endpoints
- route groups that already mostly delegate into services
- endpoints whose request and response models can be defined with Effect Schema

Harder / later fit:

- SSE endpoints
- websocket endpoints
- streaming handlers
- routes with heavy Hono-specific middleware assumptions

## Current blockers and gaps

### Schema split

Many route boundaries still use Zod-first validators. That does not block all experimentation, but full `HttpApi` adoption is easier after the domain and boundary types are more consistently Schema-first with `.zod` compatibility only where needed.

### Mixed handler styles

Many current `server/routes/instance/*.ts` handlers still mix composed Effect code with smaller Promise- or ALS-backed seams. Migrating those to consistent `Effect.gen(...)` handlers is the low-risk step to do first.

### Non-JSON routes

The server currently includes SSE, websocket, and streaming-style endpoints. Those should not be the first `HttpApi` targets.

### Existing Hono integration

The current server composition, middleware, and docs flow are Hono-centered today. That suggests a parallel or incremental adoption plan is safer than a flag day rewrite.

## Recommended strategy

### 1. Finish the prerequisites first

- continue route-handler effectification in `server/routes/instance/*.ts`
- continue schema migration toward Effect Schema-first DTOs and errors
- keep removing service facades

### 2. Start with one parallel group

Introduce one small `HttpApi` group for plain JSON endpoints only. Good initial candidates are the least stateful endpoints in:

- `server/routes/instance/question.ts`
- `server/routes/instance/provider.ts`
- `server/routes/instance/permission.ts`

Avoid `session.ts`, SSE, websocket, and TUI-facing routes first.

Recommended first slice:

- start with `question`
- start with `GET /question`
- start with `POST /question/:requestID/reply`

Why `question` first:

- already JSON-only
- already delegates into an Effect service
- proves list + mutation + params + payload + OpenAPI in one small slice
- avoids the harder streaming and middleware cases

### 3. Reuse existing services

Do not re-architect business logic during the HTTP migration. `HttpApi` handlers should call the same Effect services already used by the Hono handlers.

### 4. Bridge into Hono behind a feature flag

The `HttpApi` routes are bridged into the Hono server via `HttpRouter.toWebHandler` with a shared `memoMap`. This means:

- one process, one port — no separate server
- the Effect handler shares layer instances with `AppRuntime` (same `Question.Service`, etc.)
- Effect middleware handles auth and instance lookup independently from Hono middleware
- Hono's `.all()` catch-all intercepts matching paths before the Hono route handlers

The bridge is gated behind `OPENCODE_EXPERIMENTAL_HTTPAPI` (or `OPENCODE_EXPERIMENTAL`). When the flag is off (default), all requests go through the original Hono handlers unchanged.

```ts
// in instance/index.ts
if (Flag.OPENCODE_EXPERIMENTAL_HTTPAPI) {
  const handler = ExperimentalHttpApiServer.webHandler().handler
  app.all("/question", (c) => handler(c.req.raw)).all("/question/*", (c) => handler(c.req.raw))
}
```

The Hono route handlers are always registered (after the bridge) so `hono-openapi` generates the OpenAPI spec entries that feed SDK codegen. When the flag is on, these handlers are dead code — the `.all()` bridge matches first.

### 5. Observability

The `webHandler` provides `Observability.layer` via `Layer.provideMerge`. Since the `memoMap` is shared with `AppRuntime`, the tracing provider is deduplicated — no extra initialization cost.

This gives:

- **spans**: `Effect.fn("QuestionHttpApi.list")` etc. appear in traces alongside service-layer spans
- **HTTP logs**: `HttpMiddleware.logger` emits structured `Effect.log` entries with `http.method`, `http.url`, `http.status` annotations, flowing to motel via `OtlpLogger`

### 6. Migrate JSON route groups gradually

As each route group is ported to `HttpApi`:

1. add `.get(...)` / `.post(...)` bridge entries to the flag block in `server/routes/instance/index.ts`
2. for partial ports (e.g. only `GET /provider/auth`), bridge only the specific path
3. keep the legacy Hono route registered behind it for OpenAPI / SDK generation until the spec pipeline changes
4. verify SDK output is unchanged

Leave streaming-style endpoints on Hono until there is a clear reason to move them.

## Schema rule for HttpApi work

Every `HttpApi` slice should follow `specs/effect/schema.md` and the Schema -> Zod interop rule in `specs/effect/migration.md`.

Default rule:

- Effect Schema owns the type
- `.zod` exists only as a compatibility surface
- do not introduce a new hand-written Zod schema for a type that is already migrating to Effect Schema

Practical implication for `HttpApi` migration:

- if a route boundary already depends on a shared DTO, ID, input, output, or tagged error, migrate that model to Effect Schema first or in the same change
- if an existing Hono route or tool still needs Zod, derive it with `@/util/effect-zod`
- avoid maintaining parallel Zod and Effect definitions for the same request or response type

Ordering for a route-group migration:

1. move implicated shared `schema.ts` leaf types to Effect Schema first
2. move exported `Info` / `Input` / `Output` route DTOs to Effect Schema
3. move tagged route-facing errors to `Schema.TaggedErrorClass` where needed
4. switch existing Zod boundary validators to derived `.zod`
5. define the `HttpApi` contract from the canonical Effect schemas
6. regenerate the SDK (`./packages/sdk/js/script/build.ts`) and verify zero diff against `dev`

SDK shape rule:

- every schema migration must preserve the generated SDK output byte-for-byte **unless the new ref is intentional** (see Schema.Class vs Schema.Struct below)
- if an unintended diff appears in `packages/sdk/js/src/v2/gen/types.gen.ts`, the migration introduced an unintended API surface change — fix it before merging

### Schema.Class vs Schema.Struct

The pattern choice determines whether a schema becomes a **named** export in the SDK or stays **anonymous inline**.

**Schema.Class** emits a named `$ref` in OpenAPI via its identifier → produces a named `export type Foo = ...` in `types.gen.ts`:

```ts
export class Info extends Schema.Class<Info>("FooConfig")({ ... }) {
  static readonly zod = zod(this)
}
```

**Schema.Struct** stays anonymous and is inlined everywhere it is referenced:

```ts
export const Info = Schema.Struct({ ... }).pipe(
  withStatics((s) => ({ zod: zod(s) })),
)
export type Info = Schema.Schema.Type<typeof Info>
```

When to use each:

- Use **Schema.Class** when:
  - the original Zod had `.meta({ ref: ... })` (preserve the existing named SDK type byte-for-byte)
  - the schema is a top-level endpoint request or response (SDK consumers benefit from a stable importable name)
- Use **Schema.Struct** when:
  - the type is only used as a nested field inside another named schema
  - the original Zod was anonymous and promoting it would bloat SDK types with no import value

Promoting a previously-anonymous schema to Schema.Class is acceptable when it is top-level or endpoint-facing, but call it out in the PR — it is an additive SDK change (`export type Foo = ...` newly appears) even if it preserves the JSON shape.

Schemas that are **not** pure objects (enums, unions, records, tuples) cannot use Schema.Class. For those, add `.annotate({ identifier: "FooName" })` to get the same named-ref behavior:

```ts
export const Action = Schema.Literals(["ask", "allow", "deny"]).annotate({ identifier: "PermissionActionConfig" })
```

Temporary exception:

- it is acceptable to keep a route-local Zod schema for the first spike only when the type is boundary-local and migrating it would create unrelated churn
- if that happens, leave a short note so the type does not become a permanent second source of truth

## First vertical slice

The first `HttpApi` spike should be intentionally small and repeatable.

Chosen slice:

- group: `question`
- endpoints: `GET /question` and `POST /question/:requestID/reply`

Non-goals:

- no `session` routes
- no SSE or websocket routes
- no auth redesign
- no broad service refactor

Behavior rule:

- preserve current runtime behavior first
- treat semantic changes such as introducing new `404` behavior as a separate follow-up unless they are required to make the contract honest

Add `POST /question/:requestID/reject` only after the first two endpoints work cleanly.

## Repeatable slice template

Use the same sequence for each route group.

1. Pick one JSON-only route group that already mostly delegates into services.
2. Identify the shared DTOs, IDs, and errors implicated by that slice.
3. Apply the schema migration ordering above so those types are Effect Schema-first.
4. Define the `HttpApi` contract separately from the handlers.
5. Implement handlers by yielding the existing service from context.
6. Mount the new surface in parallel behind the `OPENCODE_EXPERIMENTAL_HTTPAPI` bridge.
7. Regenerate the SDK and verify zero diff against `dev` (see SDK shape rule above).
8. Add one end-to-end test and one OpenAPI-focused test.
9. Compare ergonomics before migrating the next endpoint.

Rule of thumb:

- migrate one route group at a time
- migrate one or two endpoints first, not the whole file
- keep business logic in the existing service
- keep the first spike easy to delete if the experiment is not worth continuing

## Example structure

Placement rule:

- keep `HttpApi` code under `src/server`, not `src/effect`
- `src/effect` should stay focused on runtimes, layers, instance state, and shared Effect plumbing
- place each `HttpApi` slice next to the HTTP boundary it serves
- for instance-scoped routes, prefer `src/server/routes/instance/httpapi/*`
- if control-plane routes ever migrate, prefer `src/server/routes/control/httpapi/*`

Suggested file layout for a repeatable spike:

- `src/server/routes/instance/httpapi/question.ts` — contract and handler layer for one route group
- `src/server/routes/instance/httpapi/server.ts` — bridged Effect HTTP layer that composes all groups
- route or OpenAPI verification should live alongside the existing server tests; there is no dedicated `question-httpapi` test file on this branch

Suggested responsibilities:

- `question.ts` defines the `HttpApi` contract and `HttpApiBuilder.group(...)` handlers
- `server.ts` composes all route groups into one `HttpRouter.toWebHandler(...)` bridge with shared middleware (auth, instance lookup)
- tests should verify the bridged routes through the normal server surface

## Example migration shape

Each route-group spike should follow the same shape.

### 1. Contract

- define an experimental `HttpApi`
- define one `HttpApiGroup`
- define endpoint params, payload, success, and error schemas from canonical Effect schemas
- annotate summary, description, and operation ids explicitly so generated docs are stable

### 2. Handler layer

- implement with `HttpApiBuilder.group(api, groupName, ...)`
- yield the existing Effect service from context
- keep handler bodies thin
- keep transport mapping at the HTTP boundary only

### 3. Bridged server

- the Effect HTTP layer is composed in `httpapi/server.ts`
- it is mounted into the Hono app via `HttpRouter.toWebHandler(...)`
- routes keep their normal instance paths and are gated by the `OPENCODE_EXPERIMENTAL_HTTPAPI` flag
- the legacy Hono handlers stay registered after the bridge so current OpenAPI / SDK generation still works

### 4. Verification

- seed real state through the existing service
- call the bridged endpoints with the flag enabled
- assert that the service behavior is unchanged
- assert that the generated OpenAPI contains the migrated paths and schemas

## Boundary composition

The Effect `HttpApi` layer owns its own auth and instance middleware, but it is currently mounted inside the existing Hono server.

### Auth

- the bridged `HttpApi` layer implements auth as an `HttpApiMiddleware.Service` using `HttpApiSecurity.basic`
- each route group's `HttpApi` is wrapped with `.middleware(Authorization)` before being served
- this is independent of the Hono auth layer; the current bridge keeps the responsibility local to the `HttpApi` slice

### Instance and workspace lookup

- the bridged `HttpApi` layer resolves instance context via an `HttpRouter.middleware` that reads `x-opencode-directory` headers and `directory` query params
- this is the Effect equivalent of the Hono `WorkspaceRouterMiddleware`
- `HttpApi` handlers yield services from context and assume the correct instance has already been provided

### Error mapping

- keep domain and service errors typed in the service layer
- declare typed transport errors on the endpoint only when the route can actually return them intentionally
- request decoding failures are transport-level `400`s handled by Effect `HttpApi` automatically
- storage or lookup failures that are part of the route contract should be declared as typed endpoint errors

## Exit criteria for the spike

The first slice is successful if:

- the bridged endpoints serve correctly through the existing Hono host when the flag is enabled
- the handlers reuse the existing Effect service
- request decoding and response shapes are schema-defined from canonical Effect schemas
- any remaining Zod boundary usage is derived from `.zod` or clearly temporary
- OpenAPI is generated from the `HttpApi` contract
- the tests are straightforward enough that the next slice feels mechanical

## Learnings

### Schema

- `Schema.Class` works well for route DTOs such as `Question.Request`, `Question.Info`, and `Question.Reply`.
- scalar or collection schemas such as `Question.Answer` should stay as schemas and use helpers like `withStatics(...)` instead of being forced into classes.
- if an `HttpApi` success schema uses `Schema.Class`, the handler or underlying service needs to return real schema instances rather than plain objects.
- internal event payloads can stay anonymous when we want to avoid adding extra named OpenAPI component churn for non-route shapes.
- `Schema.Class` emits named `$ref` in OpenAPI — only use it for types that already had `.meta({ ref })` in the old Zod schema. Inner/nested types should stay as `Schema.Struct` to avoid SDK shape changes.

### Integration

- `HttpRouter.toWebHandler` with the shared `memoMap` from `run-service.ts` cleanly bridges Effect routes into Hono — one process, one port, shared layer instances.
- `Observability.layer` must be explicitly provided via `Layer.provideMerge` in the routes layer for OTEL spans and HTTP logs to flow. The `memoMap` deduplicates it with `AppRuntime` — no extra cost.
- `HttpMiddleware.logger` (enabled by default when `disableLogger` is not set) emits structured `Effect.log` entries with `http.method`, `http.url`, `http.status` — these flow through `OtlpLogger` to motel.
- Hono OpenAPI stubs must remain registered for SDK codegen until the SDK pipeline reads from the Effect OpenAPI spec instead.
- the `OPENCODE_EXPERIMENTAL_HTTPAPI` flag gates the bridge at the Hono router level — default off, no behavior change unless opted in.

## Route inventory

Status legend:

- `bridged` - Effect HttpApi slice exists and is bridged into Hono behind the flag
- `done` - Effect HttpApi slice exists but not yet bridged
- `next` - good near-term candidate
- `later` - possible, but not first wave
- `defer` - not a good early `HttpApi` target

Current instance route inventory:

- `question` - `bridged`
  endpoints: `GET /question`, `POST /question/:requestID/reply`, `POST /question/:requestID/reject`
- `permission` - `bridged`
  endpoints: `GET /permission`, `POST /permission/:requestID/reply`
- `provider` - `bridged`
  endpoints: `GET /provider`, `GET /provider/auth`, `POST /provider/:providerID/oauth/authorize`, `POST /provider/:providerID/oauth/callback`
- `config` - `bridged` (partial)
  bridged endpoint: `GET /config/providers`
  later endpoint: `GET /config`
  defer `PATCH /config` for now
- `project` - `bridged` (partial)
  bridged endpoints: `GET /project`, `GET /project/current`
  defer git-init mutation first
- `workspace` - `next`
  best small reads: `GET /experimental/workspace/adaptor`, `GET /experimental/workspace`, `GET /experimental/workspace/status`
  defer create/remove mutations first
- `file` - `later`
  good JSON-only candidate set, but larger than the current first-wave slices
- `mcp` - `later`
  has JSON-only endpoints, but interactive OAuth/auth flows make it a worse early fit
- `session` - `defer`
  large, stateful, mixes CRUD with prompt/shell/command/share/revert flows and a streaming route
- `event` - `defer`
  SSE only
- `global` - `defer`
  mixed bag with SSE and process-level side effects
- `pty` - `defer`
  websocket-heavy route surface
- `tui` - `defer`
  queue-style UI bridge, weak early `HttpApi` fit

Recommended near-term sequence:

1. `workspace` read endpoints (`GET /experimental/workspace/adaptor`, `GET /experimental/workspace`, `GET /experimental/workspace/status`)
2. `config` full read endpoint (`GET /config`)
3. `file` JSON read endpoints
4. `mcp` JSON read endpoints

## Checklist

- [x] add one small spike that defines an `HttpApi` group for a simple JSON route set
- [x] use Effect Schema request / response types for that slice
- [x] keep the underlying service calls identical to the current handlers
- [x] compare generated OpenAPI against the current Hono/OpenAPI setup
- [x] document how auth, instance lookup, and error mapping would compose in the new stack
- [x] bridge Effect routes into Hono via `toWebHandler` with shared `memoMap`
- [x] gate behind `OPENCODE_EXPERIMENTAL_HTTPAPI` flag
- [x] verify OTEL spans and HTTP logs flow to motel
- [x] bridge question, permission, and provider auth routes
- [x] port remaining provider endpoints (`GET /provider`, OAuth mutations)
- [x] port `config` providers read endpoint
- [x] port `project` read endpoints (`GET /project`, `GET /project/current`)
- [ ] port `workspace` read endpoints
- [ ] port `GET /config` full read endpoint
- [ ] port `file` JSON read endpoints
- [ ] decide when to remove the flag and make Effect routes the default

## Rule of thumb

Do not start with the hardest route file.

If `HttpApi` is adopted here, it should arrive after the handler body is already Effect-native and after the relevant request / response models have moved to Effect Schema.
