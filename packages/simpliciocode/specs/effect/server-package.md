# Server Package Extraction

Practical reference for a future `packages/server` split after the opencode
server moved to the Effect HttpApi backend.

## Current State

- The server still lives in `packages/opencode`.
- The runtime and app layer are centralized in `src/effect/app-runtime.ts` and
  `src/effect/run-service.ts`.
- The route tree lives under `src/server/routes/instance/httpapi` and is hosted
  from `src/server/server.ts`.
- OpenAPI generation is based on the HttpApi contract plus compatibility
  translation in `src/server/routes/instance/httpapi/public.ts`.
- There is no standalone `packages/server` workspace yet.

## Future State

Target package layout:

- `packages/core` - shared domain services and schemas
- `packages/server` - HTTP contracts, handlers, OpenAPI generation, and an
  embeddable server API
- `packages/cli` - TUI and CLI entrypoints
- `packages/sdk` - generated from the server OpenAPI spec
- `packages/plugin` - plugin authoring surface

## Extraction Rule

Do not create a package cycle.

Until enough shared service code lives outside `packages/opencode`, a future
`packages/server` should either:

- own pure HttpApi contracts only, or
- accept host-provided services/layers/callbacks from `packages/opencode`

It should not import `packages/opencode` services while `packages/opencode`
imports it to host routes.

## Suggested PR Sequence

1. Keep shrinking OpenAPI compatibility shims in `httpapi/public.ts`.
2. Move stable domain schemas into shared packages only when they no longer
   depend on opencode-local runtime modules.
3. Extract pure HttpApi contract modules into `packages/server` once the contract
   can compile without importing `packages/opencode` implementation details.
4. Extract handler factories after their service dependencies can be supplied by
   a host layer instead of imported directly.
5. Move server hosting last, after package ownership is clear.

## Non-Goals

- Do not revive the old dual-backend migration shape.
- Do not split server hosting before service dependencies have a clean package
  boundary.
- Do not switch SDK generation to a new package until generated output is known
  to remain compatible.
