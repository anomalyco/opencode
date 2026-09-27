# V2 HTTP API audit checklist

**Source:** `packages/protocol/openapi.json`  
**Current endpoint count:** 139
**Last regenerated:** 2026-09-13

## How to use this checklist

Review endpoints in document order. For each endpoint, select one disposition and capture rationale or follow-up work in Notes. Mark **Reviewed** only after the disposition is agreed.

### Review criteria

- Resource and operation naming
- HTTP method and idempotency
- Request parameters and location scope
- Response shape and error taxonomy
- Authentication and authorization
- Current production consumers
- Stability level: public, experimental, or internal
- Whether the generated client API is intuitive

### Disposition legend

- **Keep:** ship unchanged as a supported V2 API
- **Change:** retain after a defined contract change
- **Remove:** exclude from the official V2 API
- **Experimental-only:** retain outside the stable API commitment

## Progress

- [x] Group 1: Foundation and placement (4)
- [x] Group 2: Configuration and capability catalogs (16)
- [x] Group 3: Credentials, integrations, MCP, and web search (22)
- [x] Group 4: Session lifecycle (12)
- [x] Group 5: Session execution and inputs (11)
- [x] Group 6: Session history and recovery (13)
- [x] Group 7: Inbox, permissions, and forms (19)
- [x] Group 8: Filesystem, worktrees, and VCS (12)
- [x] Group 9: PTYs, persistent terminals, and shells (24)
- [x] Group 10: Events, RPC, and experimental operations (6)

## Resolved during audit

### [x] `POST /api/plugin/await-activation`

- **Decision:** Remove
- **Notes:** Activation timing is an internal server concern. Catalog reads remain non-blocking.

### [x] Location response wrappers

- **Decision:** Reduce generic endpoint response locations to `{ directory }`.
- **Notes:** Full project metadata remains available from `GET /api/location`; no consumers used it from wrapped responses.

### [x] `GET /api/health` and `GET /api/server`

- **Decision:** Merge and rename
- **Replacement:** `GET /api/info` with operation ID `server.info`.
- **Notes:** Returns `version`, `pid`, and connection `urls`; readiness is conveyed by HTTP status.

### [x] `GET /api/project/current`

- **Decision:** Remove
- **Replacement:** `GET /api/location`, using `project` from the response.
- **Notes:** The endpoint duplicated `Location.Info.project`; production callers were migrated.

### [x] `POST /api/workspace` and `DELETE /api/workspace/{workspaceID}`

- **Decision:** Remove
- **Notes:** Provider-backed workspaces are not part of the V2 HTTP contract and can be introduced later. Core and the embedded SDK retain internal workspace support.

## Group 1: Foundation and placement

**Endpoints:** 4

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 001–002 | `GET` | `/api/info` | `server.info` | Keep | Replaces the former health and server endpoints. |
| [x] 003 | `GET` | `/api/location` | `location.get` | Keep | Workspace selectors and response fields removed until workspace support ships. |
| [x] 004 | `GET` | `/api/project` | `project.list` | Keep | Removed unused `time.initialized`; the database column remains for migration data. |
| [x] 005 | `PATCH` | `/api/project/{projectID}` | `project.update` | Keep | Request and response accepted as-is. |

## Group 2: Configuration and capability catalogs

**Endpoints:** 16

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 008 | `GET` | `/api/agent` | `agent.list` | Keep | Request and response accepted as-is. |
| [x] 009 | `GET` | `/api/agent/{agentID}` | `agent.get` | Keep | Request, response, and not-found error accepted as-is. |
| [x] 010 | `GET` | `/api/plugin` | `plugin.list` | Keep | Request and response accepted as-is. |
| [x] 012 | `POST` | `/api/plugin/check` | `plugin.check` | Keep | Request and response accepted as-is. |
| [x] 013 | `POST` | `/api/plugin/update` | `plugin.update` | Keep | Request and errors accepted as-is. |
| [x] 014 | `GET` | `/api/model` | `model.list` | Keep | Request and response accepted as-is. |
| [x] 015 | `GET` | `/api/model/default` | `model.default` | Keep | Request and nullable response accepted as-is. |
| [x] 016 | `GET` | `/api/provider` | `provider.list` | Keep | Request and response accepted as-is. |
| [x] 017 | `GET` | `/api/provider/{providerID}` | `provider.get` | Keep | Request, response, and not-found error accepted as-is. |
| [x] 018 | `GET` | `/api/command` | `command.list` | Keep | Request and response accepted as-is. |
| [x] 019 | `GET` | `/api/skill` | `skill.list` | Keep | Renamed `location` to `path`; removed the skill-specific `slash` flag and slash-command behavior. |
| [x] 020 | `GET` | `/api/reference` | `reference.list` | Keep | Removed duplicate `description` and `hidden` fields from nested `source`. |
| [x] 021 | `GET` | `/api/config` | `config.get` | Keep | Compatibility entries removed; response now contains only documents and OpenCode directories. |
| [x] 022 | `GET` | `/api/config/preferences` | `config.preferences` | Remove | Redundant special projection of global config. |
| [x] 023 | `PATCH` | `/api/config/preferences` | `config.updatePreferences` | Remove | Redundant field-specific config mutation API. |
| [x] 024 | `GET` | `/api/config/shell` | `config.shells` | Keep | Required by the server Terminal shell setting. |
| [x] 024a | `PATCH` | `/api/experimental/config` | `experimental.config.update` | Change | Experimental global config mutation; initially accepts only `shell`. |

## Group 3: Credentials, integrations, MCP, and web search

**Endpoints:** 22

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 025 | `GET` | `/api/integration` | `integration.list` | Keep | Full integration inventory is consumed by authentication and integration-selection clients. |
| [x] 026 | `GET` | `/api/integration/{integrationID}` | `integration.get` | Change | Missing integration now returns typed `404` instead of optional data. |
| [x] 027 | `POST` | `/api/experimental/integration/wellknown` | `experimental.integration.wellknown.add` | Experimental-only | Retained outside the stable API commitment. |
| [x] 028 | `POST` | `/api/integration/{integrationID}/connect/key` | `integration.connect.key` | Change | Missing integration returns typed `404`; key form answers retained. |
| [x] 029 | `POST` | `/api/integration/{integrationID}/connect/oauth` | `integration.oauth.connect` | Keep | OAuth connection start contract retained. |
| [x] 030 | `GET` | `/api/integration/{integrationID}/connect/oauth/{attemptID}` | `integration.oauth.status` | Change | Missing integration or OAuth attempt returns typed `404`. |
| [x] 031 | `DELETE` | `/api/integration/{integrationID}/connect/oauth/{attemptID}` | `integration.oauth.cancel` | Keep | Idempotent cancellation remains a no-op for unavailable or terminal attempts. |
| [x] 032 | `POST` | `/api/integration/{integrationID}/connect/oauth/{attemptID}/complete` | `integration.oauth.complete` | Change | Missing integration or OAuth attempt returns typed `404`; code remains mode-dependent. |
| [x] 033 | `POST` | `/api/integration/{integrationID}/connect/command` | `integration.command.connect` | Change | Missing integration or command method returns typed `404`. |
| [x] 034 | `GET` | `/api/integration/{integrationID}/connect/command/{attemptID}` | `integration.command.status` | Change | Missing integration or command attempt returns typed `404`. |
| [x] 035 | `DELETE` | `/api/integration/{integrationID}/connect/command/{attemptID}` | `integration.command.cancel` | Keep | Idempotent cancellation remains a no-op for unavailable or terminal attempts. |
| [x] 036 | `GET` | `/api/mcp` | `mcp.list` | Keep | MCP inventory and connection status retained. |
| [x] 037 | `PUT` | `/api/experimental/mcp/{server}` | `experimental.mcp.add` | Experimental-only | Runtime-only MCP override; does not persist configuration. |
| [x] 038 | `DELETE` | `/api/experimental/mcp/{server}` | `experimental.mcp.remove` | Experimental-only | Runtime removal override; missing server returns `404`. |
| [x] 039 | `POST` | `/api/experimental/mcp/{server}/connect` | `experimental.mcp.connect` | Experimental-only | Runtime connection override retained outside the stable API. |
| [x] 040 | `POST` | `/api/experimental/mcp/{server}/disconnect` | `experimental.mcp.disconnect` | Experimental-only | Runtime disconnection override retained outside the stable API. |
| [x] 041 | `GET` | `/api/mcp/resource` | `mcp.resource.catalog` | Keep | Reviewed separately by coworker. |
| [x] 042 | `PATCH` | `/api/credential/{credentialID}` | `credential.update` | Change | Removed redundant location query; credentials and events are global. |
| [x] 043 | `DELETE` | `/api/credential/{credentialID}` | `credential.remove` | Change | Removed redundant location query; credentials and events are global. |
| [x] 044 | `POST` | `/api/credential/{credentialID}/activate` | `credential.activate` | Change | Removed redundant location query; credentials and events are global. |
| [x] 045 | `GET` | `/api/websearch/provider` | `websearch.providers` | Keep | Provider availability remains location-scoped; singular resource path retained. |
| [x] 046 | `POST` | `/api/websearch` | `websearch.query` | Keep | Unknown provider remains an invalid request; published time documented as Unix epoch milliseconds. |

## Group 4: Session lifecycle

**Endpoints:** 12

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 047 | `GET` | `/api/session` | `session.list` | Keep | Existing filtering, ordering, and cursor contract retained for now. |
| [x] 048 | `POST` | `/api/session` | `session.create` | Keep | Existing creation contract retained; model reference includes optional variant. |
| [x] 049 | `GET` | `/api/experimental/session/stats` | `experimental.session.stats` | Experimental-only | Session analytics retained outside the stable API commitment. |
| [x] 050 | `GET` | `/api/session/active` | `session.active` | Keep | Status record retained for future active-state expansion. |
| [x] 051 | `GET` | `/api/session/{sessionID}` | `session.get` | Keep | Specific session read and typed `404` retained. |
| [x] 052 | `DELETE` | `/api/session/{sessionID}` | `session.remove` | Keep | Session and child deletion with typed `404` retained. |
| [x] 053 | `POST` | `/api/session/{sessionID}/fork` | `session.fork` | Change | Request now accepts optional branded `before` message ID; omission copies full history. |
| [x] 054 | `POST` | `/api/session/{sessionID}/agent` | `session.switchAgent` | Keep | Subsequent-execution agent selection retained. |
| [x] 055 | `POST` | `/api/session/{sessionID}/model` | `session.switchModel` | Keep | Subsequent-execution model and optional variant selection retained. |
| [x] 056 | `PATCH` | `/api/session/{sessionID}` | `session.update` | Change | General session patch updates title and permissions; rules emit `session.permissions`. |
| [x] 057 | `POST` | `/api/session/{sessionID}/move` | `session.move` | Change | Removed inaccurate local-change transfer claim; delivery behavior retained. |
| [x] 058 | `POST` | `/api/session/{sessionID}/background` | `session.background` | Keep | Backgroundable foreground tools transition to background observation; idle requests remain no-ops. |

## Group 5: Session execution and inputs

**Endpoints:** 11

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 059 | `POST` | `/api/session/{sessionID}/prompt` | `session.prompt` | Keep | Durable admission, delivery mode, and admit-only resume control retained. |
| [x] 060 | `POST` | `/api/session/{sessionID}/command` | `session.command` | Change | Renamed request field from `command` to `name`; `204` retained. |
| [x] 061 | `POST` | `/api/experimental/session/{sessionID}/skill` | `experimental.session.skill` | Experimental-only | Skill ID is now the `id` field; standalone activation remains experimental. |
| [x] 062 | `POST` | `/api/session/{sessionID}/synthetic` | `session.synthetic` | Keep | Durable synthetic admission and delivery controls retained. |
| [x] 063 | `POST` | `/api/session/{sessionID}/shell` | `session.shell` | Change | Caller ID is now the optimistic shell message ID; server derives its event ID. |
| [x] 064 | `POST` | `/api/session/{sessionID}/compact` | `session.compact` | Keep | Durable compaction admission and delivery controls retained. |
| [x] 065 | `POST` | `/api/experimental/session/{sessionID}/wait` | `experimental.session.wait` | Experimental-only | Race-free idle barrier retained outside the stable API. |
| [x] 066 | `POST` | `/api/session/{sessionID}/generate` | `session.generate` | Keep | Transient generation from session context retained. |
| [x] 067 | `POST` | `/api/session/{sessionID}/interrupt` | `session.interrupt` | Change | Renamed `continue` to `resume` across public and internal interruption APIs. |
| [x] 068 | `PUT` | `/api/session/{sessionID}/environment` | `session.environment` | Keep | Process-local environment replacement retained in the stable API. |
| [x] 069 | `POST` | `/api/session/{sessionID}/view` | `session.view` | Change | Idle watermark now uses the standard epoch-millisecond timestamp schema. |

## Group 6: Session history and recovery

**Endpoints:** 13

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 070 | `POST` | `/api/experimental/session/import` | `experimental.session.import` | Experimental-only | Existing projected transcript import contract retained outside the stable API. |
| [x] 071 | `GET` | `/api/experimental/session/{sessionID}/export` | `experimental.session.export` | Experimental-only | Existing projected transcript export contract retained outside the stable API. |
| [x] 072 | `POST` | `/api/session/{sessionID}/revert/stage` | `session.revert.stage` | Keep | Existing staged history and optional file restoration behavior retained. |
| [x] 073 | `DELETE` | `/api/session/{sessionID}/revert` | `session.revert.clear` | Change | Clearing staged revert now deletes the session revert resource. |
| [x] 074 | `POST` | `/api/session/{sessionID}/revert/commit` | `session.revert.commit` | Keep | Explicit staged-revert commit action retained. |
| [x] 075 | `GET` | `/api/session/{sessionID}/context` | `session.context` | Keep | Active model-context projection retained. |
| [x] 076 | `GET` | `/api/session/{sessionID}/diff` | `session.diff` | Keep | Turn-range structured diff contract retained. |
| [x] 077 | `GET` | `/api/experimental/session/{sessionID}/instructions/entries` | `experimental.session.instructions.entry.list` | Experimental-only | API-managed durable context entries retained outside the stable API. |
| [x] 078 | `PUT` | `/api/experimental/session/{sessionID}/instructions/entries/{key}` | `experimental.session.instructions.entry.put` | Experimental-only | API-managed durable context entries retained outside the stable API. |
| [x] 079 | `DELETE` | `/api/experimental/session/{sessionID}/instructions/entries/{key}` | `experimental.session.instructions.entry.remove` | Experimental-only | API-managed durable context entries retained outside the stable API. |
| [x] 080 | `GET` | `/api/experimental/session/{sessionID}/log` | `session.log` | Experimental-only | Retained outside the stable API commitment. |
| [x] 081 | `GET` | `/api/session/{sessionID}/message/{messageID}` | `session.message.get` | Change | Normalized specific-message operation ID. |
| [x] 082 | `GET` | `/api/session/{sessionID}/message` | `session.message.list` | Change | Normalized session-scoped message-list operation ID. |

## Group 7: Inbox, permissions, and forms

**Endpoints:** 19

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 083 | `GET` | `/api/session/{sessionID}/inbox` | `session.inbox.list` | Change | Inbox timestamps now use the standard nested `time.created` shape. |
| [x] 084 | `DELETE` | `/api/session/{sessionID}/inbox/{inboxID}` | `session.inbox.cancel` | Change | Cancellation is idempotent and returns `204` when the session exists. |
| [x] 085 | `PATCH` | `/api/session/{sessionID}/inbox/{inboxID}` | `session.inbox.update` | Change | Consolidated delivery mutation with `delivery: "steer" | "queue"`. |
| [x] 086 | — | — | — | Remove | Replaced by `session.inbox.update`. |
| [x] 087 | `GET` | `/api/form` | `form.list` | Change | Removed redundant `request` path and operation namespace. |
| [x] 088 | `GET` | `/api/session/{sessionID}/form` | `session.form.list` | Keep | Pending session form list retained with temporary MCP sentinel compatibility. |
| [x] 089 | `POST` | `/api/session/{sessionID}/form` | `session.form.create` | Keep | External form creation and temporary MCP sentinel ownership retained. |
| [x] 090 | `GET` | `/api/session/{sessionID}/form/{formID}` | `session.form.get` | Change | Form definition and lifecycle state are now returned together. |
| [x] 091 | — | — | — | Remove | State is included by `session.form.get`. |
| [x] 092 | `POST` | `/api/session/{sessionID}/form/{formID}/reply` | `session.form.reply` | Keep | One-shot validated form reply retained. |
| [x] 093 | `DELETE` | `/api/session/{sessionID}/form/{formID}` | `session.form.cancel` | Change | Form cancellation now deletes the pending form resource. |
| [x] 094 | `GET` | `/api/permission/request` | `permission.request.list` | Keep | Pending-request namespace retained alongside saved permissions. |
| [x] 095 | `GET` | `/api/permission/saved` | `permission.saved.list` | Change | Added persisted creation and update timestamps under `time`. |
| [x] 096 | `DELETE` | `/api/permission/saved/{id}` | `permission.saved.remove` | Keep | Idempotent saved-permission deletion retained. |
| [x] 097 | `POST` | `/api/session/{sessionID}/permission` | `session.permission.create` | Keep | Non-blocking permission evaluation and pending-request creation retained. |
| [x] 098 | `GET` | `/api/session/{sessionID}/permission` | `session.permission.list` | Keep | Pending session permission list retained. |
| [x] 099 | `GET` | `/api/session/{sessionID}/permission/{requestID}` | `session.permission.get` | Keep | Specific pending permission read with ownership validation retained. |
| [x] 100 | `POST` | `/api/session/{sessionID}/permission/{requestID}/reply` | `session.permission.reply` | Change | Renamed request field from `reply` to `decision`. |
| [x] 101 | — | — | — | Remove | Permission rules are updated through `session.update`. |

## Group 8: Filesystem, worktrees, and VCS

**Endpoints:** 12

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 102 | `GET` | `/api/fs/read/*` | `fs.read` | Keep | Relative wildcard file reads and raw byte responses retained. |
| [x] 103 | `GET` | `/api/fs/list` | `fs.list` | Keep | Existing path scope and minimal entry metadata retained. |
| [x] 104 | `GET` | `/api/fs/find` | `fs.find` | Keep | Existing ranked filesystem search retained. |
| [x] 105 | `GET` | `/api/worktree` | `worktree.list` | Keep | Reviewed separately by coworker. |
| [x] 106 | `POST` | `/api/worktree` | `worktree.create` | Keep | Reviewed separately by coworker. |
| [x] 107 | `DELETE` | `/api/worktree` | `worktree.remove` | Keep | Reviewed separately by coworker. |
| [x] 108 | `POST` | `/api/worktree/refresh` | `worktree.refresh` | Keep | Reviewed separately by coworker. |
| [x] 109 | `GET` | `/api/vcs` | `vcs.get` | Change | Preserved branch nesting and added selected VCS provider ID. |
| [x] 110 | `GET` | `/api/vcs/base` | `vcs.base` | Keep | Review-base inference and nullable unavailable state retained. |
| [x] 111 | `GET` | `/api/vcs/status` | `vcs.status` | Keep | Existing working-copy status shape retained for now. |
| [x] 112 | `GET` | `/api/vcs/branch` | `vcs.branch.list` | Change | Singular collection path and normalized operation ID. |
| [x] 113 | `GET` | `/api/vcs/diff` | `vcs.diff` | Keep | Existing working, branch, and committed comparison modes retained. |

## Group 9: PTYs, persistent terminals, and shells

**Endpoints:** 24

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 114 | `GET` | `/api/pty` | `pty.list` | Keep | PTY endpoints reviewed together and retained. |
| [x] 115 | `POST` | `/api/pty` | `pty.create` | Keep | PTY endpoints reviewed together and retained. |
| [x] 116 | `GET` | `/api/pty/{ptyID}` | `pty.get` | Keep | PTY endpoints reviewed together and retained. |
| [x] 117 | `PUT` | `/api/pty/{ptyID}` | `pty.update` | Keep | PTY endpoints reviewed together and retained. |
| [x] 118 | `DELETE` | `/api/pty/{ptyID}` | `pty.remove` | Keep | PTY endpoints reviewed together and retained. |
| [x] 119 | `POST` | `/api/pty/{ptyID}/connect-token` | `pty.connect.token` | Keep | PTY endpoints reviewed together and retained. |
| [x] 120 | `GET` | `/api/pty/{ptyID}/connect` | `pty.connect` | Keep | PTY endpoints reviewed together and retained. |
| [x] 121 | `GET` | `/api/experimental/session/{sessionID}/terminal/read` | `server.experimental.persistentPty.read` | Experimental-only | Retained outside the stable API commitment. |
| [x] 122 | `GET` | `/api/experimental/session/{sessionID}/terminal` | `server.experimental.persistentPty.list` | Experimental-only | Retained outside the stable API commitment. |
| [x] 123 | `POST` | `/api/experimental/session/{sessionID}/terminal` | `server.experimental.persistentPty.create` | Experimental-only | Retained outside the stable API commitment. |
| [x] 124 | `POST` | `/api/experimental/persistent-pty/shutdown` | `server.experimental.persistentPty.shutdown` | Experimental-only | Retained outside the stable API commitment. |
| [x] 125 | `POST` | `/api/experimental/persistent-pty/handoff` | `server.experimental.persistentPty.handoff` | Experimental-only | Retained outside the stable API commitment. |
| [x] 126 | `GET` | `/api/experimental/persistent-pty/{ptyID}` | `server.experimental.persistentPty.get` | Experimental-only | Retained outside the stable API commitment. |
| [x] 127 | `PUT` | `/api/experimental/persistent-pty/{ptyID}` | `server.experimental.persistentPty.update` | Experimental-only | Retained outside the stable API commitment. |
| [x] 128 | `DELETE` | `/api/experimental/persistent-pty/{ptyID}` | `server.experimental.persistentPty.remove` | Experimental-only | Retained outside the stable API commitment. |
| [x] 129 | `GET` | `/api/experimental/persistent-pty/{ptyID}/snapshot` | `server.experimental.persistentPty.snapshot` | Experimental-only | Retained outside the stable API commitment. |
| [x] 130 | `POST` | `/api/experimental/persistent-pty/{ptyID}/connect-token` | `server.experimental.persistentPty.connectToken` | Experimental-only | Retained outside the stable API commitment. |
| [x] 131 | `GET` | `/api/experimental/persistent-pty/{ptyID}/connect` | `persistentPty.connect` | Experimental-only | Retained outside the stable API commitment. |
| [x] 132 | `GET` | `/api/shell` | `shell.list` | Change | Stable shell inventory retained; numeric timestamps documented as epoch milliseconds. |
| [x] 133 | `POST` | `/api/shell` | `shell.create` | Change | Timeout is optional and defaults to zero; caller metadata retained. |
| [x] 134 | `GET` | `/api/shell/{id}` | `shell.get` | Keep | Specific running or retained shell read retained. |
| [x] 135 | `DELETE` | `/api/shell/{id}` | `shell.remove` | Change | Shell deletion is idempotent and returns `204` when already absent. |
| [x] 136 | — | — | — | Remove | Timeout mutation remains an internal Core shell operation. |
| [x] 137 | `GET` | `/api/shell/{id}/output` | `shell.output` | Keep | Existing byte-cursor text output paging retained. |

## Group 10: Events, RPC, and experimental operations

**Endpoints:** 6

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 138 | `POST` | `/api/experimental/generate` | `experimental.generate.text` | Experimental-only | Stateless generation retained alongside session generation. |
| [x] 139 | `POST` | `/api/rpc/{rpcID}/{method}` | `rpc.call` | Keep | Generic typed-error plugin RPC transport retained. |
| [x] 140 | `GET` | `/api/event` | `event.subscribe` | Keep | Unified native and dynamic plugin event stream retained. |
| [x] 141 | `GET` | `/api/debug/location` | `debug.location.list` | Keep | Loaded-location debug inventory retained. |
| [x] 142 | `DELETE` | `/api/debug/location` | `debug.location.evict` | Keep | Idempotent loaded-location eviction retained. |
| [x] 143 | `GET` | `/api/experimental/migration/v1` | `experimental.migration.v1.status` | Experimental-only | Retained outside the stable API commitment. |
