# Server package extraction

Practical reference for extracting a future `packages/server` from the current `packages/opencode` monolith while `packages/core` is still being migrated to Effect.

This document is intentionally execution-oriented.

It should give an agent enough context to land one incremental PR at a time without needing to rediscover the package strategy, route migration rules, or current constraints.

## Goal

Create `packages/server` as the home for:

- HTTP contract definitions
- HTTP handler implementations
- OpenAPI generation
- eventual embeddable server APIs for Node apps

Do this without blocking on the full `packages/core` extraction.

## Future state

Target package layout:

- `packages/core` - all opencode services, Effect-first source of truth
- `packages/server` - opencode server, with separate contract and implementation, still producing `openapi.json`
- `packages/cli` - TUI + CLI entrypoints
- `packages/sdk` - generated from the server OpenAPI spec, may add higher-level wrappers
- `packages/plugin` - generated or semi-hand-rolled non-Effect package built from core plugin definitions

Desired user stories:

- import from `core` and build a custom agent or app-specific runtime
- import from `server` and embed the full opencode server into an existing Node app
- spawn the CLI and talk to the server through that boundary

## Current state

Everything still lives in `packages/opencode`.

Important current facts:

- there is no `packages/core` or `packages/cli` workspace yet
- there is no `packages/server` workspace yet on this branch
- the main host server is still Hono-based in `src/server/server.ts`
- current OpenAPI generation is Hono-based through `Server.openapi()` and `cli/cmd/generate.ts`
- the Effect runtime and app layer are centralized in `src/effect/app-runtime.ts` and `src/effect/run-service.ts`
- there are already bridged Effect `HttpApi` slices under `src/server/routes/instance/httpapi/*`
- those slices are mounted into the Hono server behind `OPENCODE_EXPERIMENTAL_HTTPAPI`
- the bridge currently covers `question`, `permission`, `provider`, partial `config`, and partial `project` routes

This means the package split should start from an extraction path, not from greenfield package ownership.

## Structural reference

Use `anomalyco/opentunnel` as the structural reference for `packages/server`.

The important pattern there is:

- `packages/core` owns services and domain schemas
- `packages/server/src/definition/*` owns pure `HttpApi` contracts
- `packages/server/src/api/*` owns `HttpApiBuilder.group(...)` implementations and server-side middleware wiring
- `packages/server/src/index.ts` becomes the composition root only after the server package really owns runtime hosting

Relevant `opentunnel` files:

- `packages/server/src/definition/index.ts`
- `packages/server/src/definition/tunnel.ts`
- `packages/server/src/api/index.ts`
- `packages/server/src/api/tunnel.ts`
- `packages/server/src/api/client.ts`
- `packages/server/src/index.ts`

The intended direction here is the same, but the current `opencode` package split is earlier in the migration.

That means:

- we should follow the same `definition` and `api` naming
- we should keep contract and implementation as separate modules from the start
- we should postpone the runtime composition root until `packages/core` exists enough to support it cleanly

## Key decision

Start `packages/server` as a contract and implementation package only.

Do not make it the runtime host yet.

Why:

- `packages/core` does not exist yet
- the current server host still lives in `packages/opencode`
- moving host ownership immediately would force a large package and runtime shuffle while Effect service extraction is still in flight
- if `packages/server` imports services from `packages/opencode` while `packages/opencode` imports `packages/server` to host routes, we create a package cycle immediately

Short version:

1. create `packages/server`
2. move pure `HttpApi` contracts there
3. move handler factories there
4. keep `packages/opencode` as the temporary Hono host
5. merge `packages/server` OpenAPI with the legacy Hono OpenAPI during the transition
6. move server hosting later, after `packages/core` exists enough

## Dependency rule

Phase 1 rule:

- `packages/server` must not import from `packages/opencode`

Allowed in phase 1:

- `packages/opencode` imports `packages/server`
- `packages/server` accepts host-provided services, layers, or callbacks as inputs
- `packages/server` may temporarily own transport-local placeholder schemas when a canonical shared schema does not exist yet

Future rule after `packages/core` exists:

- `packages/server` imports from `packages/core`
- `packages/cli` imports from `packages/server` and `packages/core`
- `packages/opencode` shrinks or disappears as package responsibilities are fully split

## HttpApi model

Use Effect v4 `HttpApi` as the source of truth for migrated HTTP routes.

Important properties from the current `effect` / `effect-smol` model:

- `HttpApi`, `HttpApiGroup`, and `HttpApiEndpoint` are pure contract definitions
- handlers are implemented separately with `HttpApiBuilder.group(...)`
- OpenAPI can be generated from the contract alone
- auth and middleware can later be modeled with `HttpApiMiddleware.Service`
- SSE and websocket routes are not good first-wave `HttpApi` targets

This package split should preserve that separation explicitly.

Default shape for migrated routes:

- contract lives in `packages/server/src/definition/*`
- implementation lives in `packages/server/src/api/*`
- host mounting stays outside for now

## OpenAPI rule

During the transition there is still one spec artifact.

Default rule:

- `packages/server` generates OpenAPI from `HttpApi` contract
- `packages/opencode` keeps generating legacy OpenAPI from Hono routes
- the temporary exported server spec is a merged document
- `packages/sdk` continues consuming one `openapi.json`

Merge safety rules:

- fail on duplicate `path + method`
- fail on duplicate `operationId`
- prefer explicit summary, description, and operation ids on all new `HttpApi` endpoints

Practical implication:

- do not make the SDK consume two specs
- do not switch SDK generation to `packages/server` only until enough of the route surface has moved

## Package shape

Minimum viable `packages/server`:

- `src/index.ts`
- `src/definition/index.ts`
- `src/definition/api.ts`
- `src/definition/question.ts`
- `src/api/index.ts`
- `src/api/question.ts`
- `src/openapi.ts`
- `src/bridge/hono.ts`
- `src/types.ts`

Later additions, once there is enough real contract surface:

- `src/api/client.ts`
- runtime composition in `src/index.ts`

Suggested initial exports:

- `api`
- `openapi`
- `questionApi`
- `makeQuestionHandler`

Phase 1 responsibilities:

- own pure API contracts
- own handler factories for migrated slices
- own contract-generated OpenAPI
- expose host adapters needed by `packages/opencode`

Phase 1 non-goals:

- do not own `listen()`
- do not own adapter selection
- do not own global server middleware
- do not own websocket or SSE transport
- do not own process bootstrapping for CLI entrypoints

## Current source inventory

These files matter for the first phase.

Current host and route composition:

- `src/server/server.ts`
- `src/server/control/index.ts`
- `src/server/routes/instance/index.ts`
- `src/server/middleware.ts`
- `src/server/adapter.bun.ts`
- `src/server/adapter.node.ts`

Current bridged `HttpApi` slices:

- `src/server/routes/instance/httpapi/question.ts`
- `src/server/routes/instance/httpapi/permission.ts`
- `src/server/routes/instance/httpapi/provider.ts`
- `src/server/routes/instance/httpapi/config.ts`
- `src/server/routes/instance/httpapi/project.ts`
- `src/server/routes/instance/httpapi/server.ts`

Current OpenAPI flow:

- `src/server/server.ts` via `Server.openapi()`
- `src/cli/cmd/generate.ts`
- `packages/sdk/js/script/build.ts`

Current runtime and service layer:

- `src/effect/app-runtime.ts`
- `src/effect/run-service.ts`

## Ownership rules

Move first into `packages/server`:

- the experimental `question` `HttpApi` slice
- future `provider` and `config` JSON read slices
- any new `HttpApi` route groups
- transport-local OpenAPI generation for migrated routes

Keep in `packages/opencode` for now:

- `src/server/server.ts`
- `src/server/control/index.ts`
- `src/server/routes/**/*.ts`
- `src/server/middleware.ts`
- `src/server/adapter.*.ts`
- `src/effect/app-runtime.ts`
- `src/effect/run-service.ts`
- all Effect services until they move to `packages/core`

## Placeholder schema rule

`packages/core` is allowed to lag behind.

Until shared canonical schemas move to `packages/core`:

- prefer importing existing Effect Schema DTOs from current locations when practical
- if a route only needs a transport-local type and moving the canonical schema would create unrelated churn, allow a temporary server-local placeholder schema
- if a placeholder is introduced, leave a short note so it does not become permanent

The default rule from `schema.md` still applies:

- Effect Schema owns the type
- `.zod` is compatibility only
- avoid parallel hand-written Zod and Effect definitions for the same migrated route shape

## Host boundary rule

Until host ownership moves:

- auth stays at the outer Hono app level
- compression stays at the outer Hono app level
- CORS stays at the outer Hono app level
- instance and workspace lookup stay at the current middleware layer
- `packages/server` handlers should assume the host already provided the right request context
- do not redesign host middleware just to land the package split

This matches the current guidance in `http-api.md`:

- keep auth outside the first parallel `HttpApi` slices
- keep instance lookup outside the first parallel `HttpApi` slices
- keep the first migrations transport-focused and semantics-preserving

## Route selection rules

Good early migration targets:

- `question`
- `provider` auth read endpoint
- `config` providers read endpoint
- small read-only instance routes

Bad early migration targets:

- `session`
- `event`
- `pty`
- most `global` streaming or process-heavy routes
- anything requiring websocket upgrade handling
- anything that mixes many mutations and streaming in one file

## First vertical slice

The first slice for the package split is still the existing `question` `HttpApi` group.

Why `question` first:

- it already exists as an experimental `HttpApi` slice
- it already follows the desired contract and implementation split in one file
- it is already mounted through the current Hono host
- it is JSON-only
- it has low blast radius

Use the first slice to prove:

- package boundary
- contract and implementation split
- host mounting from `packages/opencode`
- merged OpenAPI output
- test ergonomics for future slices

Do not broaden scope in the first slice.

## Incremental migration order

Use small PRs.

Each PR should be easy to review, easy to revert, and should not mix extraction work with unrelated service refactors.

### PR 1. Create `packages/server`

Scope:

- add the new workspace package
- add package manifest and tsconfig
- add empty `src/index.ts`, `src/definition/api.ts`, `src/definition/index.ts`, `src/api/index.ts`, `src/openapi.ts`, and supporting scaffolding

Rules:

- no production behavior changes
- no host server changes yet
- no imports from `packages/opencode` inside `packages/server`
- prefer `opentunnel`-style naming from the start: `definition` for contracts, `api` for implementations

Done means:

- `packages/server` typechecks
- the workspace can import it
- the package boundary is in place for follow-up PRs

### PR 2. Move the experimental question contract

Scope:

- extract the pure `HttpApi` contract from `src/server/routes/instance/httpapi/question.ts`
- place it in `packages/server/src/definition/question.ts`
- aggregate it in `packages/server/src/definition/api.ts`
- generate OpenAPI in `packages/server/src/openapi.ts`

Rules:

- contract only in this PR
- no handler movement yet if that keeps the diff simpler
- keep operation ids and docs metadata stable

Done means:

- question contract lives in `packages/server`
- OpenAPI can be generated from contract alone
- no runtime behavior changes yet

### PR 3. Move the experimental question handler factory

Scope:

- extract the question `HttpApiBuilder.group(...)` implementation into `packages/server/src/api/question.ts`
- expose it as a factory that accepts host-provided dependencies or wiring
- add a small Hono bridge in `packages/server/src/bridge/hono.ts` if needed

Rules:

- `packages/server` must still not import from `packages/opencode`
- handler code should stay thin and service-delegating
- do not redesign the question service itself in this PR

Done means:

- `packages/server` can produce the experimental question handler
- the package still stays cycle-free

### PR 4. Mount `packages/server` question from `packages/opencode`

Scope:

- replace local experimental question route wiring in `packages/opencode`
- keep the same mount path:
- `/question`
- `/question/:requestID/reply`
- `/question/:requestID/reject`

Rules:

- no behavior change
- preserve existing docs path
- preserve current request and response shapes

Done means:

- existing question `HttpApi` test still passes
- runtime behavior is unchanged
- the current host server is now consuming `packages/server`

### PR 5. Merge legacy and contract OpenAPI

Scope:

- keep `Server.openapi()` as the temporary spec entrypoint
- generate legacy Hono spec
- generate `packages/server` contract spec
- merge them into one document
- keep `cli/cmd/generate.ts` and `packages/sdk/js/script/build.ts` consuming one spec

Rules:

- fail loudly on duplicate `path + method`
- fail loudly on duplicate `operationId`
- do not silently overwrite one source with the other

Done means:

- one merged spec is produced
- migrated question paths can come from `packages/server`
- existing SDK generation path still works

### PR 6. Add merged OpenAPI coverage

Scope:

- add one test for merged OpenAPI
- assert both a legacy Hono route and a migrated `HttpApi` route exist

Rules:

- test the merged document, not just the `packages/server` contract spec in isolation
- pick one stable legacy route and one stable migrated route

Done means:

- the merged-spec path is covered
- future route migrations have a guardrail

### PR 7. Migrate `GET /provider/auth`

Scope:

- add `GET /provider/auth` as the next `HttpApi` slice in `packages/server`
- mount it in parallel from `packages/opencode`

Why this route:

- JSON-only
- simple service delegation
- small response shape
- already listed as the best next `provider` candidate in `http-api.md`

Done means:

- route works through the current host
- route appears in merged OpenAPI
- no semantic change to provider auth behavior

### PR 8. Migrate `GET /config/providers`

Scope:

- add `GET /config/providers` as a `HttpApi` slice in `packages/server`
- mount it in parallel from `packages/opencode`

Why this route:

- JSON-only
- read-only
- low transport complexity
- already listed as the best next `config` candidate in `http-api.md`

Done means:

- route works unchanged
- route appears in merged OpenAPI

### PR 9+. Migrate small read-only instance routes

Candidate order:

1. `GET /path`
2. `GET /vcs`
3. `GET /vcs/diff`
4. `GET /command`
5. `GET /agent`
6. `GET /skill`

Rules:

- one or two endpoints per PR
- prefer read-only routes first
- keep outer middleware unchanged
- keep business logic in the existing service layer

Done means for each PR:

- contract lives in `packages/server`
- handler lives in `packages/server`
- route is mounted from the current host
- route appears in merged OpenAPI
- behavior remains unchanged

### Later PR. Move host ownership into `packages/server`

Only start this after there is enough `packages/core` surface to depend on directly.

Scope:

- move server composition into `packages/server`
- add embeddable APIs such as `createServer(...)`, `listen(...)`, or `createApp(...)`
- move adapter selection and server startup out of `packages/opencode`

Rules:

- do not start this while `packages/server` still depends on `packages/opencode`
- do not mix this with route migration PRs

Done means:

- `packages/server` can be embedded in another Node app
- `packages/cli` can depend on `packages/server`
- host logic no longer lives in `packages/opencode`

## PR sizing rule

Every migration PR should satisfy all of these:

- one route group or one to two endpoints
- no unrelated service refactor
- no auth redesign
- no middleware redesign
- OpenAPI updated
- at least one route test or spec test added or updated

## Done means for a migrated route group

A route group migration is complete only when:

1. the `HttpApi` contract lives in `packages/server`
2. handler implementation lives in `packages/server`
3. the route is mounted from the current host in `packages/opencode`
4. the route appears in merged OpenAPI
5. request and response schemas are Effect Schema-first or clearly temporary placeholders
6. existing behavior remains unchanged
7. the route has straightforward test coverage

## Validation expectations

For package-split PRs, validate the smallest useful thing.

Typical validation for the first waves:

- `bun typecheck` in the touched package directory or directories
- the relevant server / route coverage for the migrated slice
- merged OpenAPI coverage if the PR touches spec generation

Do not run tests from repo root.

## Main risks

### Package cycle

This is the biggest risk.

Bad state:

- `packages/server` imports services or runtime from `packages/opencode`
- `packages/opencode` imports route definitions or handlers from `packages/server`

Avoid by:

- keeping phase-1 `packages/server` free of `packages/opencode` imports
- using factories and host-provided wiring instead of direct service imports

### Spec drift

During the transition there are two route-definition sources.

Avoid by:

- one merged spec
- collision checks
- explicit `operationId`s
- merged OpenAPI tests

### Middleware mismatch

Current auth, compression, CORS, and instance selection are Hono-centered.

Avoid by:

- leaving them where they are during the first wave
- not trying to solve `HttpApiMiddleware.Service` globally in the package-split PRs

### Core lag

`packages/core` will not be ready everywhere.

Avoid by:

- allowing small transport-local placeholder schemas where necessary
- keeping those placeholders clearly temporary
- not blocking the server extraction on full schema movement

### Scope creep

The first vertical slice is easy to overload.

Avoid by:

- proving the package boundary first
- not mixing package creation, route migration, host redesign, and core extraction in the same change

## Non-goals for the first wave

- do not replace all Hono routes at once
- do not migrate SSE or websocket routes first
- do not redesign auth
- do not redesign instance lookup
- do not wait for full `packages/core` before starting `packages/server`
- do not change SDK generation to consume multiple specs

## Checklist

- [x] create `packages/server`
- [x] add package-level exports for contract and OpenAPI
- [ ] extract `question` contract into `packages/server`
- [ ] extract `question` handler factory into `packages/server`
- [ ] mount `question` from `packages/opencode`
- [ ] merge legacy and contract OpenAPI into one document
- [ ] add merged-spec coverage
- [ ] migrate `GET /provider/auth`
- [ ] migrate `GET /config/providers`
- [ ] migrate small read-only instance routes one or two at a time
- [ ] move host ownership into `packages/server` only after `packages/core` is ready enough
- [ ] split `packages/cli` after server and core boundaries are stable

## Rule of thumb

The fastest correct path is:

1. establish `packages/server` as the contract-first boundary
2. keep `packages/opencode` as the temporary host
3. migrate a few safe JSON routes
4. keep one merged OpenAPI document
5. move actual host ownership only after `packages/core` can support it cleanly

If a proposed PR would make `packages/server` import from `packages/opencode`, stop and restructure the boundary first.
