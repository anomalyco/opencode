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

## Proposed first steps

- [ ] add one small spike that defines an `HttpApi` group for a simple JSON route set
- [ ] use Effect Schema request / response types for that slice
- [ ] keep the underlying service calls identical to the current handlers
- [ ] compare generated OpenAPI against the current Hono/OpenAPI setup
- [ ] document how auth, instance lookup, and error mapping would compose in the new stack
- [ ] decide after the spike whether `HttpApi` should stay parallel, replace only some groups, or become the long-term default

## Rule of thumb

Do not start with the hardest route file.

If `HttpApi` is adopted here, it should arrive after the handler body is already Effect-native and after the relevant request / response models have moved to Effect Schema.
