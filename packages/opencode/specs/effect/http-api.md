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

Many current `server/instance/*.ts` handlers still call async facades directly. Migrating those to composed `Effect.gen(...)` handlers is the low-risk step to do first.

### Non-JSON routes

The server currently includes SSE, websocket, and streaming-style endpoints. Those should not be the first `HttpApi` targets.

### Existing Hono integration

The current server composition, middleware, and docs flow are Hono-centered today. That suggests a parallel or incremental adoption plan is safer than a flag day rewrite.

## Recommended strategy

### 1. Finish the prerequisites first

- continue route-handler effectification in `server/instance/*.ts`
- continue schema migration toward Effect Schema-first DTOs and errors
- keep removing service facades

### 2. Start with one parallel group

Introduce one small `HttpApi` group for plain JSON endpoints only. Good initial candidates are the least stateful endpoints in:

- `server/instance/question.ts`
- `server/instance/provider.ts`
- `server/instance/permission.ts`

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

### 4. Build in parallel, do not bridge into Hono

The `HttpApi` implementation lives under `src/server/instance/httpapi/` as a standalone Effect HTTP server. It is **not mounted into the Hono app**. There is no `toWebHandler` bridge, no Hono `Handler` export, and no `.route()` call wiring it into `experimental.ts`.

The standalone server (`httpapi/server.ts`) can be started independently and proves the routes work. Tests exercise it via `HttpRouter.serve` with `NodeHttpServer.layerTest`.

The goal is to build enough route coverage in the Effect server that the Hono server can eventually be replaced entirely. Until then, the two implementations exist side by side but are completely separate processes.

### 5. Migrate JSON route groups gradually

If the parallel slice works well, migrate additional JSON route groups one at a time. Leave streaming-style endpoints on Hono until there is a clear reason to move them.

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
6. Mount the new surface in parallel under an experimental prefix.
7. Add one end-to-end test and one OpenAPI-focused test.
8. Compare ergonomics before migrating the next endpoint.

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
- for instance-scoped routes, prefer `src/server/instance/httpapi/*`
- if control-plane routes ever migrate, prefer `src/server/control/httpapi/*`

Suggested file layout for a repeatable spike:

- `src/server/instance/httpapi/question.ts` — contract and handler layer for one route group
- `src/server/instance/httpapi/server.ts` — standalone Effect HTTP server that composes all groups
- `test/server/question-httpapi.test.ts` — end-to-end test against the real service

Suggested responsibilities:

- `question.ts` defines the `HttpApi` contract and `HttpApiBuilder.group(...)` handlers
- `server.ts` composes all route groups into one `HttpRouter.serve` layer with shared middleware (auth, instance lookup)
- tests use `ExperimentalHttpApiServer.layerTest` to run against a real in-process HTTP server

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

### 3. Standalone server

- the Effect HTTP server is self-contained in `httpapi/server.ts`
- it is **not** mounted into the Hono app — no bridge, no `toWebHandler`
- route paths use the `/experimental/httpapi` prefix so they match the eventual cutover
- each route group exposes its own OpenAPI doc endpoint

### 4. Verification

- seed real state through the existing service
- call the experimental endpoints
- assert that the service behavior is unchanged
- assert that the generated OpenAPI contains the migrated paths and schemas

## Boundary composition

The standalone Effect server owns its own middleware stack. It does not share middleware with the Hono server.

### Auth

- the standalone server implements auth as an `HttpApiMiddleware.Service` using `HttpApiSecurity.basic`
- each route group's `HttpApi` is wrapped with `.middleware(Authorization)` before being served
- this is independent of the Hono `AuthMiddleware` — when the Effect server eventually replaces Hono, this becomes the only auth layer

### Instance and workspace lookup

- the standalone server resolves instance context via an `HttpRouter.middleware` that reads `x-opencode-directory` headers and `directory` query params
- this is the Effect equivalent of the Hono `WorkspaceRouterMiddleware`
- `HttpApi` handlers yield services from context and assume the correct instance has already been provided

### Error mapping

- keep domain and service errors typed in the service layer
- declare typed transport errors on the endpoint only when the route can actually return them intentionally
- request decoding failures are transport-level `400`s handled by Effect `HttpApi` automatically
- storage or lookup failures that are part of the route contract should be declared as typed endpoint errors

## Exit criteria for the spike

The first slice is successful if:

- the standalone Effect server starts and serves the endpoints independently of the Hono server
- the handlers reuse the existing Effect service
- request decoding and response shapes are schema-defined from canonical Effect schemas
- any remaining Zod boundary usage is derived from `.zod` or clearly temporary
- OpenAPI is generated from the `HttpApi` contract
- the tests are straightforward enough that the next slice feels mechanical

## Learnings from the question slice

The first parallel `question` spike gave us a concrete pattern to reuse.

- `Schema.Class` works well for route DTOs such as `Question.Request`, `Question.Info`, and `Question.Reply`.
- scalar or collection schemas such as `Question.Answer` should stay as schemas and use helpers like `withStatics(...)` instead of being forced into classes.
- if an `HttpApi` success schema uses `Schema.Class`, the handler or underlying service needs to return real schema instances rather than plain objects.
- internal event payloads can stay anonymous when we want to avoid adding extra named OpenAPI component churn for non-route shapes.
- the experimental slice should stay as a standalone Effect server and keep calling the existing service layer unchanged.
- compare generated OpenAPI semantically at the route and schema level.

## Route inventory

Status legend:

- `done` - parallel `HttpApi` slice exists
- `next` - good near-term candidate
- `later` - possible, but not first wave
- `defer` - not a good early `HttpApi` target

Current instance route inventory:

- `question` - `done`
  endpoints in slice: `GET /question`, `POST /question/:requestID/reply`
- `permission` - `done`
  endpoints in slice: `GET /permission`, `POST /permission/:requestID/reply`
- `provider` - `next`
  best next endpoint: `GET /provider/auth`
  later endpoint: `GET /provider`
  defer first-wave OAuth mutations
- `config` - `next`
  best next endpoint: `GET /config/providers`
  later endpoint: `GET /config`
  defer `PATCH /config` for now
- `project` - `later`
  best small reads: `GET /project`, `GET /project/current`
  defer git-init mutation first
- `workspace` - `later`
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

Recommended near-term sequence after the first spike:

1. `provider` auth read endpoint
2. `config` providers read endpoint
3. `project` read endpoints
4. `workspace` read endpoints

## Checklist

- [x] add one small spike that defines an `HttpApi` group for a simple JSON route set
- [x] use Effect Schema request / response types for that slice
- [x] keep the underlying service calls identical to the current handlers
- [x] compare generated OpenAPI against the current Hono/OpenAPI setup
- [x] document how auth, instance lookup, and error mapping would compose in the new stack
- [ ] decide after the spike whether `HttpApi` should stay parallel, replace only some groups, or become the long-term default

## Rule of thumb

Do not start with the hardest route file.

If `HttpApi` is adopted here, it should arrive after the handler body is already Effect-native and after the relevant request / response models have moved to Effect Schema.
