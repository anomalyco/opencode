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

### 4. Run in parallel before replacing

Prefer mounting an experimental `HttpApi` surface alongside the existing Hono routes first. That lowers migration risk and lets us compare:

- handler ergonomics
- OpenAPI output
- auth and middleware integration
- test ergonomics

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

- `src/server/instance/httpapi/question.ts`
- `src/server/instance/httpapi/index.ts`
- `test/server/question-httpapi.test.ts`
- `test/server/question-httpapi-openapi.test.ts`

Suggested responsibilities:

- `question.ts` defines the `HttpApi` contract and `HttpApiBuilder.group(...)` handlers for the experimental slice
- `index.ts` combines experimental `HttpApi` groups and exposes the mounted handler or layer
- `question-httpapi.test.ts` proves the route works end-to-end against the real service
- `question-httpapi-openapi.test.ts` proves the generated OpenAPI is acceptable for the migrated endpoints

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

### 3. Mounting

- mount under an experimental prefix such as `/experimental/httpapi`
- keep existing Hono routes unchanged
- expose separate OpenAPI output for the experimental slice first

### 4. Verification

- seed real state through the existing service
- call the experimental endpoints
- assert that the service behavior is unchanged
- assert that the generated OpenAPI contains the migrated paths and schemas

## Boundary composition

The first slices should keep the existing outer server composition and only replace the route contract and handler layer.

### Auth

- keep `AuthMiddleware` at the outer Hono app level
- do not duplicate auth checks inside each `HttpApi` group for the first parallel slices
- treat auth as an already-satisfied transport concern before the request reaches the `HttpApi` handler

Practical rule:

- if a route is currently protected by the shared server middleware stack, the experimental `HttpApi` route should stay mounted behind that same stack

### Instance and workspace lookup

- keep `WorkspaceRouterMiddleware` as the source of truth for resolving `directory`, `workspace`, and session-derived workspace context
- let that middleware provide `Instance.current` and `WorkspaceContext` before the request reaches the `HttpApi` handler
- keep the `HttpApi` handlers unaware of path-to-instance lookup details when the existing Hono middleware already handles them

Practical rule:

- `HttpApi` handlers should yield services from context and assume the correct instance has already been provided
- only move instance lookup into the `HttpApi` layer if we later decide to migrate the outer middleware boundary itself

### Error mapping

- keep domain and service errors typed in the service layer
- declare typed transport errors on the endpoint only when the route can actually return them intentionally
- prefer explicit endpoint-level error schemas over relying on the outer Hono `ErrorMiddleware` for expected route behavior

Practical rule:

- request decoding failures should remain transport-level `400`s
- storage or lookup failures that are part of the route contract should be declared as typed endpoint errors
- unexpected defects can still fall through to the outer error middleware while the slice is experimental

For the current parallel slices, this means:

- auth still composes outside `HttpApi`
- instance selection still composes outside `HttpApi`
- success payloads should be schema-defined from canonical Effect schemas
- known route errors should be modeled at the endpoint boundary incrementally instead of all at once

## Exit criteria for the spike

The first slice is successful if:

- the endpoints run in parallel with the current Hono routes
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
- the experimental slice should stay mounted in parallel and keep calling the existing service layer unchanged.
- compare generated OpenAPI semantically at the route and schema level; in the current setup the exported OpenAPI paths do not include the outer Hono mount prefix.

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
