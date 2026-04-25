# HttpApi migration

Plan for replacing instance Hono route implementations with Effect `HttpApi` while preserving behavior, OpenAPI, and SDK output during the transition.

## End State

- JSON route contracts and handlers live in `src/server/routes/instance/httpapi/*`.
- Route modules own their `HttpApiGroup`, schemas, handlers, and route-level middleware.
- `httpapi/server.ts` only composes groups, instance lookup, observability, and the web handler bridge.
- Hono route implementations are deleted once their `HttpApi` replacements are default, tested, and represented in the SDK/OpenAPI pipeline.
- Streaming, SSE, and websocket routes move later through Effect HTTP primitives or another explicit replacement plan; they do not need to fit `HttpApi` if `HttpApi` is the wrong abstraction.

## Current State

- `OPENCODE_EXPERIMENTAL_HTTPAPI` gates the bridge. Default behavior still uses Hono.
- The bridge mounts selected paths in `server/routes/instance/index.ts` before legacy Hono routes.
- Legacy Hono routes remain for default behavior and for `hono-openapi` SDK generation.
- `HttpApi` auth is independent of Hono auth.
- `Authorization` is attached in each route module, not centrally wrapped in `server.ts`.
- Auth supports Basic auth and the legacy `auth_token` query parameter through `HttpApiSecurity.apiKey`.
- Instance context is provided by `httpapi/server.ts` using `directory`, `workspace`, and `x-opencode-directory`.
- `Observability.layer` is provided in the Effect route layer and deduplicated through the shared `memoMap`.

## Migration Rules

- Preserve runtime behavior first. Semantic changes, new error behavior, or route shape changes need separate PRs.
- Migrate one route group, or one coherent subset of a route group, at a time.
- Reuse existing services. Do not re-architect service logic during HTTP boundary migration.
- Effect Schema owns route DTOs. Keep `.zod` only as compatibility for remaining Hono/OpenAPI surfaces.
- Regenerate the SDK after schema or OpenAPI-affecting changes and verify the diff is expected.
- Do not delete a Hono route until the SDK/OpenAPI pipeline no longer depends on its Hono `describeRoute` entry.

## Schema Notes

- Use `Schema.Struct(...).annotate({ identifier })` for named OpenAPI refs when handlers return plain objects.
- Use `Schema.Class` only when the handler returns real class instances or the constructor requirement is intentional.
- Keep nested anonymous shapes as `Schema.Struct` unless a named SDK type is useful.
- Avoid parallel hand-written Zod and Effect definitions for the same route boundary.

## Phases

### 1. Stabilize The Bridge

Before porting more routes, cover the bridge behavior that every route depends on.

- Add tests that hit the Hono-mounted `HttpApi` bridge, not just `HttpApiBuilder.layer` directly.
- Cover auth disabled, Basic auth success, `auth_token` success, missing credentials, and bad credentials.
- Cover `directory` and `x-opencode-directory` instance selection.
- Verify generated SDK output remains unchanged for non-SDK work.
- Fix or remove any implemented-but-unmounted `HttpApi` groups.

### 2. Complete The Inventory

Create a route inventory from the actual Hono registrations and classify each route.

Statuses:

- `bridged`: served through the `HttpApi` bridge when the flag is on.
- `implemented`: `HttpApi` group exists but is not mounted through Hono.
- `next`: good JSON candidate for near-term porting.
- `later`: portable, but needs schema/service cleanup first.
- `special`: SSE, websocket, streaming, or UI bridge behavior that likely needs raw Effect HTTP rather than `HttpApi`.

### 3. Finish JSON Route Parity

Port remaining JSON routes in small batches.

Good near-term candidates:

- top-level reads: `GET /path`, `GET /vcs`, `GET /vcs/diff`, `GET /command`, `GET /agent`, `GET /skill`, `GET /lsp`, `GET /formatter`
- simple mutations: `POST /instance/dispose`
- experimental JSON reads: console, tool, worktree list, resource list
- deferred JSON mutations: `PATCH /config`, project git init, workspace/worktree create/remove/reset, file search, MCP auth flows

Keep large or stateful groups for later:

- `session`
- `sync`
- process-level experimental routes

### 4. Move OpenAPI And SDK Generation

Hono routes cannot be deleted while `hono-openapi` is the source of SDK generation.

Required before route deletion:

- Generate the public OpenAPI surface from Effect `HttpApi` for ported routes.
- Keep operation IDs, schemas, status codes, and SDK type names stable unless the change is intentional.
- Compare generated SDK output against `dev` for every route group deletion.
- Remove Hono OpenAPI stubs only after Effect OpenAPI is the SDK source for those paths.

### 5. Make HttpApi Default For JSON Routes

After JSON parity and SDK generation are covered:

- Flip the bridge default for ported JSON routes.
- Keep a short-lived fallback flag for the old Hono implementation.
- Run the same tests against both the default and fallback path during rollout.
- Stop adding new Hono handlers for JSON routes once the default flips.

### 6. Delete Hono Route Implementations

Delete Hono routes group-by-group after each group meets the deletion criteria.

Deletion criteria:

- `HttpApi` route is mounted by default.
- Behavior is covered by bridge-level tests.
- OpenAPI/SDK generation comes from Effect for that path.
- SDK diff is zero or explicitly accepted.
- Legacy Hono route is no longer needed as a fallback.

After deleting a group:

- Remove its Hono route file or dead endpoints.
- Remove its `.route(...)` registration from `instance/index.ts`.
- Remove duplicate Zod-only route DTOs if Effect Schema now owns the type.
- Regenerate SDK and verify output.

### 7. Replace Special Routes

Special routes need explicit designs before Hono can disappear completely.

- `event`: SSE
- `pty`: websocket
- `tui`: UI/control bridge behavior
- streaming `session` endpoints

Use raw Effect HTTP routes where `HttpApi` does not fit. The goal is deleting Hono implementations, not forcing every transport shape through `HttpApi`.

## Current Route Status

| Area                     | Status            | Notes                                                          |
| ------------------------ | ----------------- | -------------------------------------------------------------- |
| `question`               | `bridged`         | `GET /question`, reply, reject                                 |
| `permission`             | `bridged`         | list and reply                                                 |
| `provider`               | `bridged`         | list, auth, OAuth authorize/callback                           |
| `config`                 | `bridged` partial | reads only; mutation remains Hono                              |
| `project`                | `bridged` partial | reads only; git-init remains Hono                              |
| `file`                   | `bridged` partial | list/content/status only                                       |
| `mcp`                    | `bridged` partial | status only                                                    |
| `workspace`              | `implemented`     | `HttpApi` group exists, but bridge mounting needs verification |
| top-level instance reads | `next`            | path, vcs, command, agent, skill, lsp, formatter               |
| experimental JSON routes | `next/later`      | console, tool, worktree, resource, global session list         |
| `session`                | `later/special`   | large stateful surface plus streaming                          |
| `sync`                   | `later`           | process/control side effects                                   |
| `event`                  | `special`         | SSE                                                            |
| `pty`                    | `special`         | websocket                                                      |
| `tui`                    | `special`         | UI bridge                                                      |

## Next PRs

1. Add bridge-level auth and instance-context tests for the current `HttpApi` bridge.
2. Produce a generated route inventory from Hono registrations and update `Current Route Status` with exact paths.
3. Fix the `workspace` status: mount it if it should be reachable, or remove it from the composed `HttpApi` layer.
4. Port the top-level JSON reads.
5. Start the Effect OpenAPI/SDK generation path for already-bridged routes.

## Checklist

- [x] Add first `HttpApi` JSON route slices.
- [x] Bridge selected `HttpApi` routes into Hono behind `OPENCODE_EXPERIMENTAL_HTTPAPI`.
- [x] Reuse existing Effect services in handlers.
- [x] Provide auth, instance lookup, and observability in the Effect route layer.
- [x] Attach auth middleware in route modules.
- [x] Support `auth_token` as a query security scheme.
- [ ] Add bridge-level auth and instance tests.
- [ ] Complete exact Hono route inventory.
- [ ] Resolve implemented-but-unmounted route groups.
- [ ] Port remaining JSON routes.
- [ ] Generate SDK/OpenAPI from Effect routes.
- [ ] Flip ported JSON routes to default-on with fallback.
- [ ] Delete replaced Hono route implementations.
- [ ] Replace SSE/websocket/streaming Hono routes with non-Hono implementations.
