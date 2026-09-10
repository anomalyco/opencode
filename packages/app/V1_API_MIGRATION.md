# V1 API Migration Checklist

The app is currently hybrid. In this document, V1 refers to the legacy unprefixed server APIs used by `@opencode-ai/sdk/v2`, despite the SDK package name.

## Events

- [x] Replace `GET /global/event` with `GET /api/event`.
  - `src/context/server-sdk.tsx`
- [x] Reduce current granular session and message events into the existing app projections.
  - `src/context/server-session-v2-reducer.ts`
  - `src/context/server-session.ts`
- [ ] Remove transitional session event dependencies: `session.created`, `session.updated`, `session.diff`, `session.status`, `session.idle`, and `session.error`.
  - `src/context/global-sync/event-reducer.ts`
  - `src/context/server-session.ts`
  - `src/context/notification.tsx`
  - `src/pages/session/usage-exceeded-dialogs.tsx`
- [ ] Remove legacy message event compatibility: `message.updated`, `message.removed`, `message.part.updated`, `message.part.removed`, and `message.part.delta`.
  - `src/context/global-sync/event-reducer.ts`
  - `src/context/server-session.ts`
- [x] Adapt current permission and question events to the existing request model.
  - `src/context/global-sync/event-reducer.ts`
  - `src/context/permission.tsx`
- [x] Consume current file watcher events.
  - `src/context/file.tsx`
- [x] Consume current VCS events.
  - `src/context/global-sync/event-reducer.ts`
  - `src/pages/session.tsx`
- [x] Consume current `pty.exited` events.
  - `src/context/terminal.tsx`
- [ ] Migrate LSP and reference events.
  - `src/context/global-sync/event-reducer.ts`

## Sessions

- [x] Replace `GET /session/status` with one server-scoped `GET /api/session/active` snapshot plus V2 execution events.
  - `src/context/server-sync.tsx`
- [x] Migrate session listing from `GET /session`.
  - `src/context/server-sync.tsx`
  - `src/context/directory-sync.ts`
  - `src/pages/layout.tsx`
- [x] Migrate the remaining direct session read from `GET /session/:sessionID`.
  - `src/components/titlebar.tsx`
- [x] Migrate session updates from `PATCH /session/:sessionID`.
  - `src/context/directory-sync.ts`
  - `src/context/layout.tsx`
  - `src/pages/home.tsx`
  - `src/pages/layout.tsx`
  - `src/pages/session/timeline/message-timeline.tsx`
  - `src/components/titlebar-tab-nav.tsx`
  - Renames use `POST /api/session/:sessionID/rename`; archival uses `POST /api/session/:sessionID/archive`.
- [x] Migrate session deletion from `DELETE /session/:sessionID`.
  - `src/pages/session/timeline/message-timeline.tsx`
- [x] Remove session diff loading from `GET /session/:sessionID/diff`.
  - Historical Session diffs remain unavailable until the current API defines their snapshot semantics.
- [x] Migrate abort from `POST /session/:sessionID/abort`.
  - `src/components/prompt-input/submit.ts`
  - `src/pages/session/use-session-commands.tsx`
  - `src/pages/session.tsx`
- [x] Migrate revert and unrevert from `POST /session/:sessionID/revert` and `POST /session/:sessionID/unrevert`.
  - `src/pages/session/use-session-commands.tsx`
  - `src/pages/session.tsx`
- [x] Replace `POST /session/:sessionID/summarize` with the current compact API.
  - `src/pages/session/use-session-commands.tsx`
- [x] Migrate slash commands from `POST /session/:sessionID/command`.
  - `src/components/prompt-input/submit.ts`
- [x] Migrate shell execution from `POST /session/:sessionID/shell`.
  - `src/components/prompt-input/submit.ts`
- [x] Migrate session fork from `POST /session/:sessionID/fork`.
  - `src/components/dialog-fork.tsx`
- [ ] Migrate sharing from `POST /session/:sessionID/share` and `DELETE /session/:sessionID/share`.
  - `src/pages/session/use-session-commands.tsx`
  - `src/pages/session/timeline/message-timeline.tsx`
  - Blocked: the current API has no sharing contract or implementation.

## Session Compatibility Fallbacks

These calls are retained as fallback adapters. The current production path supplies the current session and message APIs.

- [ ] Remove fallback `GET /session/:sessionID` after compatibility support is unnecessary.
  - `src/context/server-session.ts`
- [ ] Remove fallback `GET /session/:sessionID/message` after compatibility support is unnecessary.
  - `src/context/server-session.ts`
- [ ] Remove fallback `GET /session/:sessionID/message/:messageID` after compatibility support is unnecessary.
  - `src/context/server-session.ts`

## Filesystem

- [ ] Migrate file listing from `GET /file`.
  - `src/context/file.tsx`
- [ ] Migrate file reads from `GET /file/content`.
  - `src/context/file.tsx`
  - `src/pages/session/review-tab.tsx`
  - `src/pages/session/v2/review-panel-v2.tsx`
- [x] Migrate path discovery from `GET /path` to `GET /api/path`.
  - `src/context/global-sync/bootstrap.ts`
  - `src/components/dialog-select-directory.tsx`
  - `src/components/dialog-select-directory-v2.tsx`

## Projects And Worktrees

- [x] Migrate project listing from `GET /project` to `GET /api/project`.
  - `src/context/global-sync/bootstrap.ts`
- [x] Migrate the current project lookup from `GET /project/current` to `GET /api/project/current`.
  - `src/context/global-sync/bootstrap.ts`
- [ ] Migrate Git initialization from `POST /project/git/init`.
  - `src/pages/session.tsx`
- [x] Migrate project updates from `PATCH /project/:projectID` to `PATCH /api/project/:projectID`.
  - `src/context/layout.tsx`
  - `src/components/edit-project.ts`
  - `src/pages/layout.tsx`
- [ ] Migrate experimental worktree listing, creation, removal, and reset from `/experimental/worktree`.
  - `src/pages/layout.tsx`
  - `src/components/prompt-input/submit.ts`
  - Listing now uses `GET /api/project/:projectID/directories`; create, removal, and reset remain.
- [ ] Migrate instance disposal from `POST /instance/dispose`.
  - `src/pages/layout.tsx`

## VCS

- [x] Migrate repository information from `GET /vcs` to `GET /api/vcs`.
  - `src/context/global-sync/bootstrap.ts`
- [x] Migrate diffs from `GET /vcs/diff` to `GET /api/vcs/diff`.
  - `src/pages/session.tsx`
- [x] Migrate status from `GET /vcs/status` to `GET /api/vcs/status`.
  - `src/pages/layout.tsx`

## Configuration And Authentication

- [ ] Migrate global configuration reads from `GET /global/config`.
  - `src/context/global-sync/bootstrap.ts`
- [ ] Migrate directory configuration reads from `GET /config`.
  - `src/context/global-sync/bootstrap.ts`
- [ ] Migrate global configuration updates from `PATCH /global/config`.
  - `src/context/server-sync.tsx`
- [x] Migrate provider authentication method discovery from `GET /provider/auth` to `GET /api/integration/:integrationID`.
  - `src/components/dialog-connect-provider.tsx`
- [x] Migrate built-in provider OAuth authorization and callbacks to `/api/integration/:integrationID/connect/oauth/*`.
  - `src/components/dialog-connect-provider.tsx`
- [ ] Migrate remaining credentials from `PUT /auth/:providerID` and `DELETE /auth/:providerID`.
  - Built-in provider key connections now use `POST /api/integration/:integrationID/connect/key`.
  - `src/components/dialog-connect-provider.tsx`
  - `src/components/dialog-custom-provider.tsx`
  - `src/components/settings-providers.tsx`
  - `src/components/settings-v2/providers.tsx`
- [ ] Migrate global disposal from `POST /global/dispose`.
  - `src/components/dialog-connect-provider.tsx`
  - `src/components/settings-providers.tsx`
  - `src/components/settings-v2/providers.tsx`

## Permissions And Questions

- [x] Migrate permission listing from `GET /permission` to `GET /api/permission/request`.
  - `src/context/global-sync/bootstrap.ts`
  - `src/context/permission.tsx`
- [x] Migrate permission responses from `/session/:sessionID/permissions/:permissionID`.
  - `src/context/permission.tsx`
  - `src/pages/session/composer/session-composer-state.ts`
- [x] Migrate question listing from `GET /question` to `GET /api/question/request`.
  - `src/context/global-sync/bootstrap.ts`
- [x] Migrate question replies and rejections from `/question/:requestID/*` to `/api/session/:sessionID/question/:requestID/*`.
  - `src/pages/session/composer/session-question-dock.tsx`

## Commands, MCP, LSP, And References

- [x] Migrate command listing from `GET /command` to `GET /api/command`.
  - `src/context/global-sync/bootstrap.ts`
  - `src/context/server-sync.tsx`
- [x] Migrate MCP listing, connection, and disconnection from `/mcp` to `/api/mcp`.
  - `src/context/server-sync.tsx`
- [ ] Replace legacy MCP authentication with the Integration OAuth workflow.
  - `src/context/server-sync.tsx`
- [x] Migrate experimental resource listing from `GET /experimental/resource` to `GET /api/mcp/resource`.
  - `src/context/server-sync.tsx`
- [ ] Migrate LSP status from `GET /lsp`.
  - `src/context/server-sync.tsx`
- [x] Move `GET /api/reference` off the legacy generated SDK transport.
  - `src/context/global-sync/bootstrap.ts`

## Search

- [x] Migrate global session search from `GET /experimental/session` to `GET /api/session`.
  - `src/components/command-palette.ts`
  - `src/components/dialog-command-palette-v2.tsx`

## PTY And Terminal

- [x] Migrate PTY creation, reads, updates, and deletion from `/pty` to `/api/pty`.
  - `src/context/terminal.tsx`
  - `src/components/terminal.tsx`
- [x] Migrate shell listing from `GET /pty/shells` to `GET /api/pty/shells`.
  - `src/components/settings-general.tsx`
  - `src/components/settings-v2/general.tsx`
- [x] Migrate connection tokens from `POST /pty/:ptyID/connect-token` to `POST /api/pty/:ptyID/connect-token`.
  - `src/components/terminal.tsx`
- [x] Migrate the direct WebSocket connection from `/pty/:ptyID/connect` to `/api/pty/:ptyID/connect`.
  - `src/components/terminal.tsx`

## Legacy Types And Adapters

These are not V1 network requests, but they keep the UI coupled to V1 data contracts.

- [ ] Replace the current-session-to-legacy-session adapter.
  - `src/utils/session.ts`
- [ ] Replace the current-message-to-legacy-message-and-part adapter.
  - `src/utils/session-message.ts`
- [ ] Replace current agent, provider, and model adapters to legacy SDK structures.
  - `src/context/global-sync/utils.ts`
- [ ] Replace legacy `Session`, `Message`, `Part`, `PermissionRequest`, `QuestionRequest`, `Project`, `FileNode`, `FileDiffInfo`, and `Event` types throughout app state and rendering.
- [ ] Remove the `@opencode-ai/sdk` runtime dependency after all legacy calls and types are gone.
  - `package.json`

## Test Infrastructure

- [ ] Replace V1 endpoint mocks with current API mocks.
  - `e2e/utils/mock-server.ts`
- [x] Replace `/global/event` and `/event` interception with current event transport handling.
  - `e2e/utils/sse-transport.ts`
- [ ] Replace `SessionV1` and legacy SDK fixtures in timeline performance tests.
  - `e2e/performance/timeline-stability/fixture.ts`
- [ ] Remove remaining legacy SDK type fixtures from unit and browser tests.
