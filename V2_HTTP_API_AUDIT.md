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
- [ ] Group 2: Configuration and capability catalogs (16)
- [ ] Group 3: Credentials, integrations, MCP, and web search (22)
- [ ] Group 4: Session lifecycle (12)
- [ ] Group 5: Session execution and inputs (11)
- [ ] Group 6: Session history and recovery (13)
- [ ] Group 7: Inbox, permissions, and forms (19)
- [ ] Group 8: Filesystem, worktrees, and VCS (12)
- [ ] Group 9: PTYs, persistent terminals, and shells (24)
- [ ] Group 10: Events, RPC, and experimental operations (6)

## Resolved during audit

### [x] `POST /api/plugin/await-activation`

- **Decision:** Remove
- **Notes:** Activation timing is an internal server concern. Catalog reads remain non-blocking.

### [x] Location response wrappers

- **Decision:** Reduce generic endpoint response locations to `{ directory }`.
- **Notes:** Full project metadata remains available from `GET /api/location`; no consumers used it from wrapped responses.

### [x] `GET /api/health` and `GET /api/server`

- **Decision:** Merge and rename
- **Replacement:** `GET /api/status` with operation ID `server.status`.
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
| [x] 001–002 | `GET` | `/api/status` | `server.status` | Keep | Replaces the former health and server endpoints. |
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
| [ ] 024 | `GET` | `/api/config/shell` | `config.shells` |  |  |
| [x] 024a | `PATCH` | `/api/experimental/config` | `experimental.config.update` | Change | Experimental global config mutation; initially accepts only `shell`. |

## Group 3: Credentials, integrations, MCP, and web search

**Endpoints:** 22

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [x] 025 | `GET` | `/api/integration` | `integration.list` | Keep | Full integration inventory is consumed by authentication and integration-selection clients. |
| [x] 026 | `GET` | `/api/integration/{integrationID}` | `integration.get` | Change | Missing integration now returns typed `404` instead of optional data. |
| [ ] 027 | `POST` | `/api/experimental/integration/wellknown` | `experimental.integration.wellknown.add` |  |  |
| [ ] 028 | `POST` | `/api/integration/{integrationID}/connect/key` | `integration.connect.key` |  |  |
| [ ] 029 | `POST` | `/api/integration/{integrationID}/connect/oauth` | `integration.oauth.connect` |  |  |
| [ ] 030 | `GET` | `/api/integration/{integrationID}/connect/oauth/{attemptID}` | `integration.oauth.status` |  |  |
| [ ] 031 | `DELETE` | `/api/integration/{integrationID}/connect/oauth/{attemptID}` | `integration.oauth.cancel` |  |  |
| [ ] 032 | `POST` | `/api/integration/{integrationID}/connect/oauth/{attemptID}/complete` | `integration.oauth.complete` |  |  |
| [ ] 033 | `POST` | `/api/integration/{integrationID}/connect/command` | `integration.command.connect` |  |  |
| [ ] 034 | `GET` | `/api/integration/{integrationID}/connect/command/{attemptID}` | `integration.command.status` |  |  |
| [ ] 035 | `DELETE` | `/api/integration/{integrationID}/connect/command/{attemptID}` | `integration.command.cancel` |  |  |
| [x] 036 | `GET` | `/api/mcp` | `mcp.list` | Keep | MCP inventory and connection status retained. |
| [x] 037 | `PUT` | `/api/experimental/mcp/{server}` | `experimental.mcp.add` | Experimental-only | Runtime-only MCP override; does not persist configuration. |
| [x] 038 | `DELETE` | `/api/experimental/mcp/{server}` | `experimental.mcp.remove` | Experimental-only | Runtime removal override; missing server returns `404`. |
| [x] 039 | `POST` | `/api/experimental/mcp/{server}/connect` | `experimental.mcp.connect` | Experimental-only | Runtime connection override retained outside the stable API. |
| [x] 040 | `POST` | `/api/experimental/mcp/{server}/disconnect` | `experimental.mcp.disconnect` | Experimental-only | Runtime disconnection override retained outside the stable API. |
| [ ] 041 | `GET` | `/api/mcp/resource` | `mcp.resource.catalog` |  | Deferred for later review. |
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
| [ ] 054 | `POST` | `/api/session/{sessionID}/agent` | `session.switchAgent` |  |  |
| [ ] 055 | `POST` | `/api/session/{sessionID}/model` | `session.switchModel` |  |  |
| [ ] 056 | `POST` | `/api/session/{sessionID}/rename` | `session.rename` |  |  |
| [ ] 057 | `POST` | `/api/session/{sessionID}/move` | `session.move` |  |  |
| [ ] 058 | `POST` | `/api/session/{sessionID}/background` | `session.background` |  |  |

## Group 5: Session execution and inputs

**Endpoints:** 11

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 059 | `POST` | `/api/session/{sessionID}/prompt` | `session.prompt` |  |  |
| [ ] 060 | `POST` | `/api/session/{sessionID}/command` | `session.command` |  |  |
| [ ] 061 | `POST` | `/api/session/{sessionID}/skill` | `session.skill` |  |  |
| [ ] 062 | `POST` | `/api/session/{sessionID}/synthetic` | `session.synthetic` |  |  |
| [ ] 063 | `POST` | `/api/session/{sessionID}/shell` | `session.shell` |  |  |
| [ ] 064 | `POST` | `/api/session/{sessionID}/compact` | `session.compact` |  |  |
| [ ] 065 | `POST` | `/api/session/{sessionID}/wait` | `session.wait` |  |  |
| [ ] 066 | `POST` | `/api/session/{sessionID}/generate` | `session.generate` |  |  |
| [ ] 067 | `POST` | `/api/session/{sessionID}/interrupt` | `session.interrupt` |  |  |
| [ ] 068 | `PUT` | `/api/session/{sessionID}/environment` | `session.environment` |  |  |
| [ ] 069 | `POST` | `/api/session/{sessionID}/view` | `session.view` |  |  |

## Group 6: Session history and recovery

**Endpoints:** 13

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 070 | `POST` | `/api/session/import` | `session.import` |  |  |
| [ ] 071 | `GET` | `/api/session/{sessionID}/export` | `session.export` |  |  |
| [ ] 072 | `POST` | `/api/session/{sessionID}/revert/stage` | `session.revert.stage` |  |  |
| [ ] 073 | `POST` | `/api/session/{sessionID}/revert/clear` | `session.revert.clear` |  |  |
| [ ] 074 | `POST` | `/api/session/{sessionID}/revert/commit` | `session.revert.commit` |  |  |
| [ ] 075 | `GET` | `/api/session/{sessionID}/context` | `session.context` |  |  |
| [ ] 076 | `GET` | `/api/session/{sessionID}/diff` | `session.diff` |  |  |
| [ ] 077 | `GET` | `/api/session/{sessionID}/instructions/entries` | `session.instructions.entry.list` |  |  |
| [ ] 078 | `PUT` | `/api/session/{sessionID}/instructions/entries/{key}` | `session.instructions.entry.put` |  |  |
| [ ] 079 | `DELETE` | `/api/session/{sessionID}/instructions/entries/{key}` | `session.instructions.entry.remove` |  |  |
| [ ] 080 | `GET` | `/api/experimental/session/{sessionID}/log` | `session.log` |  |  |
| [ ] 081 | `GET` | `/api/session/{sessionID}/message/{messageID}` | `session.message` |  |  |
| [ ] 082 | `GET` | `/api/session/{sessionID}/message` | `message.list` |  |  |

## Group 7: Inbox, permissions, and forms

**Endpoints:** 19

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 083 | `GET` | `/api/session/{sessionID}/inbox` | `session.inbox.list` |  |  |
| [ ] 084 | `DELETE` | `/api/session/{sessionID}/inbox/{inboxID}` | `session.inbox.cancel` |  |  |
| [ ] 085 | `POST` | `/api/session/{sessionID}/inbox/{inboxID}/steer` | `session.inbox.steer` |  |  |
| [ ] 086 | `POST` | `/api/session/{sessionID}/inbox/{inboxID}/queue` | `session.inbox.queue` |  |  |
| [ ] 087 | `GET` | `/api/form/request` | `form.request.list` |  |  |
| [ ] 088 | `GET` | `/api/session/{sessionID}/form` | `session.form.list` |  |  |
| [ ] 089 | `POST` | `/api/session/{sessionID}/form` | `session.form.create` |  |  |
| [ ] 090 | `GET` | `/api/session/{sessionID}/form/{formID}` | `session.form.get` |  |  |
| [ ] 091 | `GET` | `/api/session/{sessionID}/form/{formID}/state` | `session.form.state` |  |  |
| [ ] 092 | `POST` | `/api/session/{sessionID}/form/{formID}/reply` | `session.form.reply` |  |  |
| [ ] 093 | `POST` | `/api/session/{sessionID}/form/{formID}/cancel` | `session.form.cancel` |  |  |
| [ ] 094 | `GET` | `/api/permission/request` | `permission.request.list` |  |  |
| [ ] 095 | `GET` | `/api/permission/saved` | `permission.saved.list` |  |  |
| [ ] 096 | `DELETE` | `/api/permission/saved/{id}` | `permission.saved.remove` |  |  |
| [ ] 097 | `POST` | `/api/session/{sessionID}/permission` | `session.permission.create` |  |  |
| [ ] 098 | `GET` | `/api/session/{sessionID}/permission` | `session.permission.list` |  |  |
| [ ] 099 | `GET` | `/api/session/{sessionID}/permission/{requestID}` | `session.permission.get` |  |  |
| [ ] 100 | `POST` | `/api/session/{sessionID}/permission/{requestID}/reply` | `session.permission.reply` |  |  |
| [ ] 101 | `PUT` | `/api/session/{sessionID}/permission/rules` | `session.permission.rules` |  |  |

## Group 8: Filesystem, worktrees, and VCS

**Endpoints:** 12

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 102 | `GET` | `/api/fs/read/*` | `fs.read` |  |  |
| [ ] 103 | `GET` | `/api/fs/list` | `fs.list` |  |  |
| [ ] 104 | `GET` | `/api/fs/find` | `fs.find` |  |  |
| [ ] 105 | `GET` | `/api/worktree` | `worktree.list` |  |  |
| [ ] 106 | `POST` | `/api/worktree` | `worktree.create` |  |  |
| [ ] 107 | `DELETE` | `/api/worktree` | `worktree.remove` |  |  |
| [ ] 108 | `POST` | `/api/worktree/refresh` | `worktree.refresh` |  |  |
| [ ] 109 | `GET` | `/api/vcs` | `vcs.get` |  |  |
| [ ] 110 | `GET` | `/api/vcs/base` | `vcs.base` |  |  |
| [ ] 111 | `GET` | `/api/vcs/status` | `vcs.status` |  |  |
| [ ] 112 | `GET` | `/api/vcs/branches` | `vcs.branches` |  |  |
| [ ] 113 | `GET` | `/api/vcs/diff` | `vcs.diff` |  |  |

## Group 9: PTYs, persistent terminals, and shells

**Endpoints:** 24

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 114 | `GET` | `/api/pty` | `pty.list` |  |  |
| [ ] 115 | `POST` | `/api/pty` | `pty.create` |  |  |
| [ ] 116 | `GET` | `/api/pty/{ptyID}` | `pty.get` |  |  |
| [ ] 117 | `PUT` | `/api/pty/{ptyID}` | `pty.update` |  |  |
| [ ] 118 | `DELETE` | `/api/pty/{ptyID}` | `pty.remove` |  |  |
| [ ] 119 | `POST` | `/api/pty/{ptyID}/connect-token` | `pty.connect.token` |  |  |
| [ ] 120 | `GET` | `/api/pty/{ptyID}/connect` | `pty.connect` |  |  |
| [ ] 121 | `GET` | `/api/experimental/session/{sessionID}/terminal/read` | `server.experimental.persistentPty.read` |  |  |
| [ ] 122 | `GET` | `/api/experimental/session/{sessionID}/terminal` | `server.experimental.persistentPty.list` |  |  |
| [ ] 123 | `POST` | `/api/experimental/session/{sessionID}/terminal` | `server.experimental.persistentPty.create` |  |  |
| [ ] 124 | `POST` | `/api/experimental/persistent-pty/shutdown` | `server.experimental.persistentPty.shutdown` |  |  |
| [ ] 125 | `POST` | `/api/experimental/persistent-pty/handoff` | `server.experimental.persistentPty.handoff` |  |  |
| [ ] 126 | `GET` | `/api/experimental/persistent-pty/{ptyID}` | `server.experimental.persistentPty.get` |  |  |
| [ ] 127 | `PUT` | `/api/experimental/persistent-pty/{ptyID}` | `server.experimental.persistentPty.update` |  |  |
| [ ] 128 | `DELETE` | `/api/experimental/persistent-pty/{ptyID}` | `server.experimental.persistentPty.remove` |  |  |
| [ ] 129 | `GET` | `/api/experimental/persistent-pty/{ptyID}/snapshot` | `server.experimental.persistentPty.snapshot` |  |  |
| [ ] 130 | `POST` | `/api/experimental/persistent-pty/{ptyID}/connect-token` | `server.experimental.persistentPty.connectToken` |  |  |
| [ ] 131 | `GET` | `/api/experimental/persistent-pty/{ptyID}/connect` | `persistentPty.connect` |  |  |
| [ ] 132 | `GET` | `/api/shell` | `shell.list` |  |  |
| [ ] 133 | `POST` | `/api/shell` | `shell.create` |  |  |
| [ ] 134 | `GET` | `/api/shell/{id}` | `shell.get` |  |  |
| [ ] 135 | `DELETE` | `/api/shell/{id}` | `shell.remove` |  |  |
| [ ] 136 | `PATCH` | `/api/shell/{id}/timeout` | `shell.timeout` |  |  |
| [ ] 137 | `GET` | `/api/shell/{id}/output` | `shell.output` |  |  |

## Group 10: Events, RPC, and experimental operations

**Endpoints:** 6

| Done | Method | Path | Operation ID | Decision | Notes |
|---|---|---|---|---|---|
| [ ] 138 | `POST` | `/api/generate` | `generate.text` |  |  |
| [ ] 139 | `POST` | `/api/rpc/{rpcID}/{method}` | `rpc.call` |  |  |
| [ ] 140 | `GET` | `/api/event` | `event.subscribe` |  |  |
| [ ] 141 | `GET` | `/api/debug/location` | `debug.location.list` |  |  |
| [ ] 142 | `DELETE` | `/api/debug/location` | `debug.location.evict` |  |  |
| [ ] 143 | `GET` | `/api/experimental/migration/v1` | `experimental.migration.v1.status` |  |  |
