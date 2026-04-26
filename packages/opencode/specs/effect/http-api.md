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

| Area                      | Status            | Notes                                                                                    |
| ------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `question`                | `bridged`         | `GET /question`, reply, reject                                                           |
| `permission`              | `bridged`         | list and reply                                                                           |
| `provider`                | `bridged`         | list, auth, OAuth authorize/callback                                                     |
| `config`                  | `bridged`         | read, providers, update                                                                  |
| `project`                 | `bridged`         | list, current, git init, update                                                          |
| `file`                    | `bridged` partial | find text/file/symbol, list/content/status                                               |
| `mcp`                     | `bridged`         | status, add, OAuth, connect/disconnect                                                   |
| `workspace`               | `bridged` partial | adaptor/list/status; create/remove/session-restore remain                                |
| top-level instance routes | `bridged`         | path, vcs, command, agent, skill, lsp, formatter, dispose                                |
| experimental JSON routes  | `bridged` partial | console, tool, worktree list/mutations, resource list; global session list remains later |
| `session`                 | `later/special`   | large stateful surface plus streaming                                                    |
| `sync`                    | `later`           | process/control side effects                                                             |
| `event`                   | `special`         | SSE                                                                                      |
| `pty`                     | `special`         | websocket                                                                                |
| `tui`                     | `special`         | UI bridge                                                                                |

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
- [ ] `GET /experimental/session` - global session list.
- [x] `GET /experimental/resource` - MCP resources.

### Workspace Routes

- [x] `GET /experimental/workspace/adaptor` - list workspace adaptors.
- [ ] `POST /experimental/workspace` - create workspace.
- [x] `GET /experimental/workspace` - list workspaces.
- [x] `GET /experimental/workspace/status` - workspace status.
- [ ] `DELETE /experimental/workspace/:id` - remove workspace.
- [ ] `POST /experimental/workspace/:id/session-restore` - restore session into workspace.

### Sync Routes

- [ ] `POST /sync/start` - start workspace sync.
- [ ] `POST /sync/replay` - replay sync events.
- [ ] `POST /sync/history` - list sync event history.

### Session Routes

- [ ] `GET /session` - list sessions.
- [ ] `GET /session/status` - session status map.
- [ ] `GET /session/:sessionID` - get session.
- [ ] `GET /session/:sessionID/children` - get child sessions.
- [ ] `GET /session/:sessionID/todo` - get session todos.
- [ ] `POST /session` - create session.
- [ ] `DELETE /session/:sessionID` - delete session.
- [ ] `PATCH /session/:sessionID` - update session metadata.
- [ ] `POST /session/:sessionID/init` - run project init command.
- [ ] `POST /session/:sessionID/fork` - fork session.
- [ ] `POST /session/:sessionID/abort` - abort session.
- [ ] `POST /session/:sessionID/share` - share session.
- [ ] `GET /session/:sessionID/diff` - session diff.
- [ ] `DELETE /session/:sessionID/share` - unshare session.
- [ ] `POST /session/:sessionID/summarize` - summarize session.
- [ ] `GET /session/:sessionID/message` - list session messages.
- [ ] `GET /session/:sessionID/message/:messageID` - get message.
- [ ] `DELETE /session/:sessionID/message/:messageID` - delete message.
- [ ] `DELETE /session/:sessionID/message/:messageID/part/:partID` - delete part.
- [ ] `PATCH /session/:sessionID/message/:messageID/part/:partID` - update part.
- [ ] `POST /session/:sessionID/message` - prompt with streaming response.
- [ ] `POST /session/:sessionID/prompt_async` - async prompt.
- [ ] `POST /session/:sessionID/command` - run command.
- [ ] `POST /session/:sessionID/shell` - run shell command.
- [ ] `POST /session/:sessionID/revert` - revert message.
- [ ] `POST /session/:sessionID/unrevert` - restore reverted messages.
- [ ] `POST /session/:sessionID/permissions/:permissionID` - deprecated permission response route.

### Event Routes

- [ ] `GET /event` - SSE event stream; replace with raw Effect HTTP, not `HttpApi`.

### PTY Routes

- [ ] `GET /pty` - list PTY sessions.
- [ ] `POST /pty` - create PTY session.
- [ ] `GET /pty/:ptyID` - get PTY session.
- [ ] `PUT /pty/:ptyID` - update PTY session.
- [ ] `DELETE /pty/:ptyID` - remove PTY session.
- [ ] `GET /pty/:ptyID/connect` - PTY websocket; replace with raw Effect HTTP/websocket support.

### TUI Routes

- [ ] `POST /tui/append-prompt` - append prompt.
- [ ] `POST /tui/open-help` - open help.
- [ ] `POST /tui/open-sessions` - open sessions.
- [ ] `POST /tui/open-themes` - open themes.
- [ ] `POST /tui/open-models` - open models.
- [ ] `POST /tui/submit-prompt` - submit prompt.
- [ ] `POST /tui/clear-prompt` - clear prompt.
- [ ] `POST /tui/execute-command` - execute command.
- [ ] `POST /tui/show-toast` - show toast.
- [ ] `POST /tui/publish` - publish TUI event.
- [ ] `POST /tui/select-session` - select session.
- [ ] `GET /tui/control/next` - get next TUI request.
- [ ] `POST /tui/control/response` - submit TUI control response.

## Remaining PR Plan

Prefer smaller PRs from here so route behavior and SDK/OpenAPI fallout stays reviewable.

1. [x] Bridge `PATCH /project/:projectID`.
2. [x] Bridge MCP add/connect/disconnect routes.
3. [x] Bridge MCP OAuth routes: start, callback, authenticate, remove.
4. [x] Bridge experimental console switch and tool list routes.
5. [ ] Bridge experimental global session list.
6. [ ] Bridge workspace create/remove/session-restore routes.
7. [ ] Bridge sync start/replay/history routes.
8. [ ] Bridge session read routes: list, status, get, children, todo, diff, messages.
9. [ ] Bridge session lifecycle mutation routes: create, delete, update, fork, abort.
10. [ ] Bridge session share/summary/message/part mutation routes.
11. [ ] Replace event SSE with non-Hono Effect HTTP.
12. [ ] Replace pty websocket/control routes with non-Hono Effect HTTP.
13. [ ] Replace tui bridge routes or explicitly isolate them behind a non-Hono compatibility layer.
14. [ ] Switch OpenAPI/SDK generation to Effect routes and compare SDK output.
15. [ ] Flip ported JSON routes default-on, keep a short fallback, then delete replaced Hono route files.

## Checklist

- [x] Add first `HttpApi` JSON route slices.
- [x] Bridge selected `HttpApi` routes into Hono behind `OPENCODE_EXPERIMENTAL_HTTPAPI`.
- [x] Reuse existing Effect services in handlers.
- [x] Provide auth, instance lookup, and observability in the Effect route layer.
- [x] Attach auth middleware in route modules.
- [x] Support `auth_token` as a query security scheme.
- [x] Add bridge-level auth and instance tests.
- [x] Complete exact Hono route inventory.
- [x] Resolve implemented-but-unmounted route groups.
- [x] Port remaining top-level JSON reads.
- [ ] Generate SDK/OpenAPI from Effect routes.
- [ ] Flip ported JSON routes to default-on with fallback.
- [ ] Delete replaced Hono route implementations.
- [ ] Replace SSE/websocket/streaming Hono routes with non-Hono implementations.
