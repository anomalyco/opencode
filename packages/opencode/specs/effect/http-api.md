# HttpApi migration

Plan for replacing instance Hono route implementations with Effect `HttpApi` while preserving behavior, OpenAPI, and SDK output during the transition.

## End State

- JSON route contracts and handlers live in `src/server/routes/instance/httpapi/*`.
- Route modules own their `HttpApiGroup`, schemas, handlers, and route-level middleware.
- `httpapi/server.ts` only composes groups, instance lookup, observability, and the web handler bridge.
- Hono route implementations are deleted once their `HttpApi` replacements are default, tested, and represented in the SDK/OpenAPI pipeline.
- Streaming, SSE, and websocket routes move later through Effect HTTP primitives or another explicit replacement plan; they do not need to fit `HttpApi` if `HttpApi` is the wrong abstraction.

## Current State

- `OPENCODE_EXPERIMENTAL_HTTPAPI` selects the backend at server startup. Default is still `hono`.
- `server/backend.ts` picks one of `effect-httpapi` or `hono`; `server.ts` builds either a pure Effect `HttpApi` web handler or the legacy Hono app accordingly. The earlier in-Hono "bridge" model has been replaced by this fork-at-startup.
- Legacy Hono routes remain mounted for the `hono` backend and remain the source for `hono-openapi` SDK generation.
- An Effect `HttpApi` OpenAPI surface exists (`OpenApi.fromApi(PublicApi)` in `cli/cmd/generate.ts --httpapi`, `OPENCODE_SDK_OPENAPI=httpapi` in `packages/sdk/js/script/build.ts`) but is opt-in. The default SDK generation is still Hono.
- `httpapi/public.ts` carries the Hono-compat normalization for the Effect-generated OpenAPI surface (auth scheme strip, request-body required flag, optional `null` arms, `BadRequestError` / `NotFoundError` remap, `$ref` self-cycle fix, `auth_token` query injection). Today's Effect-generated SDK is not byte-identical to the Hono-generated SDK — see Phase 4.
- Auth is centrally configured for the Effect backend via Effect `Config` (`refactor: use Effect config for HttpApi authorization`, `Fix HttpApi raw route authorization`) rather than re-attached in each route module.
- Auth supports Basic auth and the legacy `auth_token` query parameter through `HttpApiSecurity.apiKey`.
- Instance context is provided by `httpapi/server.ts` using `directory`, `workspace`, and `x-opencode-directory`.
- `Observability.layer` is provided in the Effect route layer and deduplicated through the shared `memoMap`.
- CORS middleware is wired into both backends (`feat(httpapi): add CORS middleware to instance routes`).

## Migration Rules

- Preserve runtime behavior first. Semantic changes, new error behavior, or route shape changes need separate PRs.
- Migrate one route group, or one coherent subset of a route group, at a time.
- Reuse existing services. Do not re-architect service logic during HTTP boundary migration.
- Effect Schema owns route DTOs. Keep `.zod` only as compatibility for remaining Hono/OpenAPI surfaces.
- Regenerate the SDK after schema or OpenAPI-affecting changes and verify the diff is expected.
- Do not delete a Hono route until the SDK/OpenAPI pipeline no longer depends on its Hono `describeRoute` entry.

## Route Slice Checklist

Use this checklist for each small HttpApi migration PR:

1. Read the legacy Hono route and copy behavior exactly, including default values, headers, operation IDs, response schemas, and status codes.
2. Put the new `HttpApiGroup`, route paths, DTO schemas, and handlers in `src/server/routes/instance/httpapi/*`.
3. Mount the new paths in `src/server/routes/instance/index.ts` only inside the `OPENCODE_EXPERIMENTAL_HTTPAPI` block.
4. Use `InstanceState.context` / `InstanceState.directory` inside HttpApi handlers instead of `Instance.directory`, `Instance.worktree`, or `Instance.project` ALS globals.
5. Reuse existing services directly. If a service returns plain objects, use `Schema.Struct`; use `Schema.Class` only when handlers return actual class instances.
6. Keep legacy Hono routes and `.zod` compatibility in place for SDK/OpenAPI generation.
7. Add tests that hit the Hono-mounted bridge via `InstanceRoutes`, not only the raw `HttpApi` web handler, when the route depends on auth or instance context.
8. Run `bun typecheck` from `packages/opencode`, relevant `bun run test:ci ...` tests from `packages/opencode`, and `./packages/sdk/js/script/build.ts` from the repo root.

## Hono Deletion Checklist

Use this checklist before deleting any Hono route implementation. A route being `bridged` is not enough.

1. `HttpApi` parity is complete for the route path, method, auth behavior, query parameters, request body, response status, response headers, and error status.
2. The route is mounted by default, not only behind `OPENCODE_EXPERIMENTAL_HTTPAPI`.
3. If a fallback flag exists, tests cover both the default `HttpApi` path and the fallback Hono path until the fallback is removed.
4. OpenAPI generation uses the Effect `HttpApi` route as the source for that path.
5. Generated SDK output is unchanged from the Hono-generated contract, or the SDK diff is intentionally reviewed and accepted.
6. The legacy Hono `describeRoute`, validator, and handler for that path are removed.
7. Any duplicate Zod-only DTOs are deleted or kept only as `.zod` compatibility on the canonical Effect Schema.
8. Bridge tests exist for auth, instance selection, success response, and route-specific side effects.
9. Mutation routes prove persisted side effects and cleanup behavior in tests. If the mutation disposes/reloads the active instance, disposal happens through an explicit post-response lifecycle hook rather than inline handler teardown.
10. Streaming, SSE, websocket, and UI bridge routes have a specific non-Hono replacement plan. Do not force them through `HttpApi` if raw Effect HTTP is a better fit.

Hono can be removed from the instance server only after all mounted Hono route groups meet this checklist and `server/routes/instance/index.ts` no longer depends on Hono routing for default behavior.

## Experimental Read Slice Guidance

For the experimental route group, port read-only JSON routes before mutations:

- Good first batch: `GET /console`, `GET /console/orgs`, `GET /tool/ids`, `GET /resource`.
- Consider `GET /worktree` only if the handler uses `InstanceState.context` instead of `Instance.project`.
- Defer `POST /console/switch`, worktree create/remove/reset, and `GET /session` to separate PRs because they mutate state or have broader pagination/session behavior.
- Preserve response headers such as pagination cursors if a route is ported.
- If SDK generation changes, explain whether it is a semantic contract change or a generator-equivalent type normalization.

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
- deferred JSON mutations: workspace/worktree create/remove/reset, file search, MCP auth flows

Keep large or stateful groups for later:

- `session`
- `sync`
- process-level experimental routes

### 4. Move OpenAPI And SDK Generation

Hono routes cannot be deleted while `hono-openapi` is the source of SDK generation.

Status: the Effect `HttpApi` OpenAPI surface is **implemented and opt-in** (`bun dev generate --httpapi`, `OPENCODE_SDK_OPENAPI=httpapi`). Default SDK generation still uses Hono. `httpapi/public.ts` applies the Hono-compat normalization layer to the Effect output. Diff against the Hono-generated spec still shows real gaps that must be closed before the SDK can flip:

- Branded-type `pattern` constraints on ID schemas are not propagated to the Effect output (~169 missing).
- Per-property `description` annotations are not propagated through `Schema.Struct` to the Effect output (~107 missing).
- `Event.*` and `SyncEvent.*` component names use dotted form in Hono and PascalCase in Effect (~50 differences, breaks SDK type names).
- Effect's component deduper emits numbered duplicates (`Session9`, `SyncEvent.session.updated.11`) that need a name-collision fix.
- Cosmetic-only diffs (`additionalProperties: false`, `const` vs `enum`, MAX_SAFE_INTEGER `maximum`, `propertyNames`) can be normalized in `public.ts` if they would otherwise change SDK output.

Required before route deletion:

- Close the diff above so Effect-generated SDK output matches the Hono-generated SDK output for every retained path.
- Keep operation IDs, schemas, status codes, and SDK type names stable unless the change is intentional.
- Flip `packages/sdk/js/script/build.ts` default to `httpapi` and regenerate.
- Compare generated SDK output against `dev` for every route group deletion.
- Remove Hono OpenAPI stubs only after Effect OpenAPI is the SDK source for those paths.

V2 cleanup once SDK compatibility no longer needs the legacy Hono contract:

- Remove `public.ts` compatibility transforms that hide honest `HttpApi` metadata, including auth `securitySchemes`, per-route `security`, and generated `401` responses.
- Stop remapping built-in `HttpApi` error schemas back to legacy Hono `BadRequestError` / `NotFoundError` components if V2 clients can consume the actual Effect error shape.
- Prefer the direct `HttpApi` OpenAPI output for request/response bodies and named component schemas instead of rewriting it to match Hono generator quirks.
- Keep schema fixes that describe the actual wire format, but delete transforms that only preserve legacy SDK type names or inline-vs-ref shape.
- Re-evaluate `auth_token` as an OpenAPI security scheme rather than a hand-injected query parameter once clients can consume the V2 spec.

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

| Area                      | Status            | Notes                                                                      |
| ------------------------- | ----------------- | -------------------------------------------------------------------------- |
| `question`                | `bridged`         | `GET /question`, reply, reject                                             |
| `permission`              | `bridged`         | list and reply                                                             |
| `provider`                | `bridged`         | list, auth, OAuth authorize/callback                                       |
| `config`                  | `bridged`         | read, providers, update                                                    |
| `project`                 | `bridged`         | list, current, git init, update                                            |
| `file`                    | `bridged` partial | find text/file/symbol, list/content/status                                 |
| `mcp`                     | `bridged`         | status, add, OAuth, connect/disconnect                                     |
| `workspace`               | `bridged`         | adapter/list/status/create/remove/session-restore                          |
| top-level instance routes | `bridged`         | path, vcs, command, agent, skill, lsp, formatter, dispose                  |
| experimental JSON routes  | `bridged`         | console, tool, worktree list/mutations, global session list, resource list |
| `session`                 | `bridged`         | read, lifecycle, prompt, message/part mutations, revert, permission reply  |
| `sync`                    | `bridged`         | start/replay/history                                                       |
| `event`                   | `bridged`         | SSE via raw Effect HTTP                                                    |
| `pty`                     | `special`         | websocket                                                                  |
| `tui`                     | `special`         | UI bridge                                                                  |

## Full Route Checklist

This checklist tracks bridge parity only. Checked routes are available through the experimental `HttpApi` bridge; Hono deletion is tracked separately by the deletion checklist above.

### Top-Level Instance Routes

- [x] `POST /instance/dispose` - dispose active instance after response.
- [x] `GET /path` - current directory and worktree paths.
- [x] `GET /vcs` - current VCS status.
- [x] `GET /vcs/diff` - VCS diff summary.
- [x] `GET /command` - command catalog.
- [x] `GET /agent` - agent catalog.
- [x] `GET /skill` - skill catalog.
- [x] `GET /lsp` - LSP status.
- [x] `GET /formatter` - formatter status.

### Config Routes

- [x] `GET /config` - read config.
- [x] `PATCH /config` - update config and dispose active instance after response.
- [x] `GET /config/providers` - config provider summary.

### Project Routes

- [x] `GET /project` - list projects.
- [x] `GET /project/current` - current project.
- [x] `POST /project/git/init` - initialize git and reload active instance after response.
- [x] `PATCH /project/:projectID` - update project metadata.

### Provider Routes

- [x] `GET /provider` - list providers.
- [x] `GET /provider/auth` - list provider auth methods.
- [x] `POST /provider/:providerID/oauth/authorize` - start provider OAuth.
- [x] `POST /provider/:providerID/oauth/callback` - finish provider OAuth.

### Question Routes

- [x] `GET /question` - list questions.
- [x] `POST /question/:requestID/reply` - reply to question.
- [x] `POST /question/:requestID/reject` - reject question.

### Permission Routes

- [x] `GET /permission` - list permission requests.
- [x] `POST /permission/:requestID/reply` - reply to permission request.

### File Routes

- [x] `GET /find` - text search.
- [x] `GET /find/file` - file search.
- [x] `GET /find/symbol` - symbol search.
- [x] `GET /file` - list directory entries.
- [x] `GET /file/content` - read file content.
- [x] `GET /file/status` - file status.

### MCP Routes

- [x] `GET /mcp` - MCP status.
- [x] `POST /mcp` - add MCP server at runtime.
- [x] `POST /mcp/:name/auth` - start MCP OAuth.
- [x] `POST /mcp/:name/auth/callback` - finish MCP OAuth callback.
- [x] `POST /mcp/:name/auth/authenticate` - run MCP OAuth authenticate flow.
- [x] `DELETE /mcp/:name/auth` - remove MCP OAuth credentials.
- [x] `POST /mcp/:name/connect` - connect MCP server.
- [x] `POST /mcp/:name/disconnect` - disconnect MCP server.

### Experimental Routes

- [x] `GET /experimental/console` - active Console provider metadata.
- [x] `GET /experimental/console/orgs` - switchable Console orgs.
- [x] `POST /experimental/console/switch` - switch active Console org.
- [x] `GET /experimental/tool/ids` - tool IDs.
- [x] `GET /experimental/tool` - tools for provider/model.
- [x] `GET /experimental/worktree` - list worktrees.
- [x] `POST /experimental/worktree` - create worktree.
- [x] `DELETE /experimental/worktree` - remove worktree.
- [x] `POST /experimental/worktree/reset` - reset worktree.
- [x] `GET /experimental/session` - global session list.
- [x] `GET /experimental/resource` - MCP resources.

### Workspace Routes

- [x] `GET /experimental/workspace/adapter` - list workspace adapters.
- [x] `POST /experimental/workspace` - create workspace.
- [x] `GET /experimental/workspace` - list workspaces.
- [x] `GET /experimental/workspace/status` - workspace status.
- [x] `DELETE /experimental/workspace/:id` - remove workspace.
- [x] `POST /experimental/workspace/:id/session-restore` - restore session into workspace.

### Sync Routes

- [x] `POST /sync/start` - start workspace sync.
- [x] `POST /sync/replay` - replay sync events.
- [x] `POST /sync/history` - list sync event history.

### Session Routes

- [x] `GET /session` - list sessions.
- [x] `GET /session/status` - session status map.
- [x] `GET /session/:sessionID` - get session.
- [x] `GET /session/:sessionID/children` - get child sessions.
- [x] `GET /session/:sessionID/todo` - get session todos.
- [x] `POST /session` - create session.
- [x] `DELETE /session/:sessionID` - delete session.
- [x] `PATCH /session/:sessionID` - update session metadata.
- [x] `POST /session/:sessionID/init` - run project init command.
- [x] `POST /session/:sessionID/fork` - fork session.
- [x] `POST /session/:sessionID/abort` - abort session.
- [x] `POST /session/:sessionID/share` - share session.
- [x] `GET /session/:sessionID/diff` - session diff.
- [x] `DELETE /session/:sessionID/share` - unshare session.
- [x] `POST /session/:sessionID/summarize` - summarize session.
- [x] `GET /session/:sessionID/message` - list session messages.
- [x] `GET /session/:sessionID/message/:messageID` - get message.
- [x] `DELETE /session/:sessionID/message/:messageID` - delete message.
- [x] `DELETE /session/:sessionID/message/:messageID/part/:partID` - delete part.
- [x] `PATCH /session/:sessionID/message/:messageID/part/:partID` - update part.
- [x] `POST /session/:sessionID/message` - prompt with streaming response.
- [x] `POST /session/:sessionID/prompt_async` - async prompt.
- [x] `POST /session/:sessionID/command` - run command.
- [x] `POST /session/:sessionID/shell` - run shell command.
- [x] `POST /session/:sessionID/revert` - revert message.
- [x] `POST /session/:sessionID/unrevert` - restore reverted messages.
- [x] `POST /session/:sessionID/permissions/:permissionID` - deprecated permission response route.

### Event Routes

- [x] `GET /event` - SSE event stream via raw Effect HTTP.

### PTY Routes

- [x] `GET /pty` - list PTY sessions.
- [x] `POST /pty` - create PTY session.
- [x] `GET /pty/:ptyID` - get PTY session.
- [x] `PUT /pty/:ptyID` - update PTY session.
- [x] `DELETE /pty/:ptyID` - remove PTY session.
- [x] `GET /pty/:ptyID/connect` - PTY websocket; replace with raw Effect HTTP/websocket support.

### TUI Routes

- [x] `POST /tui/append-prompt` - append prompt.
- [x] `POST /tui/open-help` - open help.
- [x] `POST /tui/open-sessions` - open sessions.
- [x] `POST /tui/open-themes` - open themes.
- [x] `POST /tui/open-models` - open models.
- [x] `POST /tui/submit-prompt` - submit prompt.
- [x] `POST /tui/clear-prompt` - clear prompt.
- [x] `POST /tui/execute-command` - execute command.
- [x] `POST /tui/show-toast` - show toast.
- [x] `POST /tui/publish` - publish TUI event.
- [x] `POST /tui/select-session` - select session.
- [x] `GET /tui/control/next` - get next TUI request.
- [x] `POST /tui/control/response` - submit TUI control response.

## Remaining PR Plan

Prefer smaller PRs from here so route behavior and SDK/OpenAPI fallout stays reviewable.

1. [x] Bridge `PATCH /project/:projectID`.
2. [x] Bridge MCP add/connect/disconnect routes.
3. [x] Bridge MCP OAuth routes: start, callback, authenticate, remove.
4. [x] Bridge experimental console switch and tool list routes.
5. [x] Bridge experimental global session list.
6. [x] Bridge workspace create/remove/session-restore routes.
7. [x] Bridge sync start/replay/history routes.
8. [x] Bridge session read routes: list, status, get, children, todo, diff, messages.
9. [x] Bridge session lifecycle mutation routes: create, delete, update, fork, abort.
10. [x] Bridge remaining session mutation and prompt routes.
11. [ ] Replace event SSE with non-Hono Effect HTTP. The Effect backend has a raw Effect HTTP `httpapi/event.ts`; the Hono backend still uses `hono/streaming` `streamSSE`. Either port Hono `/event` to raw Effect HTTP for the fallback window, or skip and delete it together with Hono in step 15.
12. [x] Replace pty websocket/control routes with non-Hono Effect HTTP for the Effect backend. Hono `pty.ts` remains in the Hono backend.
13. [x] Replace tui bridge routes or explicitly isolate them behind a non-Hono compatibility layer for the Effect backend. Hono `tui.ts` remains in the Hono backend.
14. [ ] Switch OpenAPI/SDK generation to Effect routes and compare SDK output. Effect path is implemented and opt-in via `--httpapi` / `OPENCODE_SDK_OPENAPI=httpapi`. Close the schema-shape gaps in `public.ts` (branded `pattern`, per-property `description`, `Event.*` / `SyncEvent.*` naming, dedup collisions), then flip `packages/sdk/js/script/build.ts` default.
15. [ ] Flip `backend.ts` default from `hono` to `effect-httpapi`, keep `OPENCODE_EXPERIMENTAL_HTTPAPI` (or its inverse) as a short fallback flag, then delete replaced Hono route files.

## Checklist

- [x] Add first `HttpApi` JSON route slices.
- [x] Bridge selected `HttpApi` routes behind `OPENCODE_EXPERIMENTAL_HTTPAPI`. (Now backend-fork-at-startup rather than in-Hono path mounting.)
- [x] Reuse existing Effect services in handlers.
- [x] Provide auth, instance lookup, and observability in the Effect route layer.
- [x] Centralize auth via Effect `Config` for the Effect backend.
- [x] Support `auth_token` as a query security scheme.
- [x] Add bridge-level auth and instance tests.
- [x] Complete exact Hono route inventory.
- [x] Resolve implemented-but-unmounted route groups.
- [x] Port remaining top-level JSON reads.
- [x] Implement Effect `HttpApi` OpenAPI generation behind `--httpapi` / `OPENCODE_SDK_OPENAPI=httpapi`.
- [ ] Close Effect-vs-Hono OpenAPI schema-shape gaps and flip the SDK generator default.
- [ ] Flip the runtime backend default from `hono` to `effect-httpapi`, with a short fallback flag.
- [ ] Delete replaced Hono route implementations.
- [ ] Replace SSE/websocket/streaming Hono routes with non-Hono implementations (or remove with the rest of Hono).
