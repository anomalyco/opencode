# OpenCode API Reference Index

Generated from the OpenCode OpenAPI contract.
Requests to `opencode:///api/...` default `x-opencode-directory` to the current session directory unless overridden.

## Reference Files

### `skill://opencode/api/sessions.md` — Sessions, Messages & Forms (53)

Create, list, prompt, wait, interrupt, fork, revert, and inspect sessions, messages, inbox, and pending forms/permissions.

- `GET /api/session` — List sessions
- `POST /api/session` — Create session
- `GET /api/experimental/session/stats` — Get session statistics
- `POST /api/experimental/session/import` — Import session
- `GET /api/experimental/session/{sessionID}/export` — Export session
- `GET /api/session/active` — List active sessions
- `GET /api/session/{sessionID}` — Get session
- `PATCH /api/session/{sessionID}` — Update session
- `DELETE /api/session/{sessionID}` — Delete session
- `POST /api/session/{sessionID}/fork` — Fork session
- `POST /api/session/{sessionID}/agent` — Switch session agent
- `POST /api/session/{sessionID}/model` — Switch session model
- `POST /api/session/{sessionID}/move` — Move session
- `POST /api/session/{sessionID}/prompt` — Send message
- `POST /api/session/{sessionID}/command` — Run command
- `POST /api/experimental/session/{sessionID}/skill` — Activate skill
- `POST /api/session/{sessionID}/synthetic` — Add synthetic message
- `POST /api/session/{sessionID}/shell` — Run shell command
- `POST /api/session/{sessionID}/compact` — Compact session
- `POST /api/experimental/session/{sessionID}/wait` — Wait for session
- `POST /api/session/{sessionID}/revert/stage` — Stage session revert
- `DELETE /api/session/{sessionID}/revert` — Clear staged revert
- `POST /api/session/{sessionID}/revert/commit` — Commit staged revert
- `GET /api/session/{sessionID}/context` — Get session context
- `GET /api/session/{sessionID}/diff` — Diff session turns
- `GET /api/session/{sessionID}/inbox` — List session inbox
- `PATCH /api/session/{sessionID}/inbox/{inboxID}` — Update inbox item
- `DELETE /api/session/{sessionID}/inbox/{inboxID}` — Cancel inbox input
- `GET /api/experimental/session/{sessionID}/instructions/entries` — List instruction entries
- `PUT /api/experimental/session/{sessionID}/instructions/entries/{key}` — Put instruction entry
- `DELETE /api/experimental/session/{sessionID}/instructions/entries/{key}` — Remove instruction entry
- `POST /api/session/{sessionID}/generate` — Generate text from session context
- `GET /api/experimental/session/{sessionID}/log` — Read the session log
- `POST /api/session/{sessionID}/interrupt` — Interrupt session execution
- `POST /api/session/{sessionID}/background` — Background blocking session tools
- `GET /api/session/{sessionID}/message/{messageID}` — Get session message
- `GET /api/session/{sessionID}/form` — List session forms
- `POST /api/session/{sessionID}/form` — Create session form
- `GET /api/session/{sessionID}/form/{formID}` — Get session form
- `DELETE /api/session/{sessionID}/form/{formID}` — Cancel form
- `POST /api/session/{sessionID}/form/{formID}/reply` — Reply to form
- `PUT /api/session/{sessionID}/environment` — Set session environment
- `POST /api/session/{sessionID}/view` — View session
- `GET /api/session/{sessionID}/message` — Get session messages
- `GET /api/form` — List pending forms
- `GET /api/permission/request` — List pending permission requests
- `GET /api/permission/saved` — List saved permissions
- `PATCH /api/permission/saved/{id}` — Update saved permission
- `DELETE /api/permission/saved/{id}` — Remove saved permission
- `GET /api/session/{sessionID}/permission` — List session permission requests
- `POST /api/session/{sessionID}/permission` — Create permission request
- `GET /api/session/{sessionID}/permission/{requestID}` — Get permission request
- `POST /api/session/{sessionID}/permission/{requestID}/reply` — Reply to pending permission request

### `skill://opencode/api/workspace.md` — Workspace, Projects & VCS (15)

Inspect the current location, projects, git worktrees, VCS status/diffs/branches, and references.

- `GET /api/location` — Get location
- `POST /api/location/reload` — Reload configuration
- `GET /api/project` — List projects
- `PATCH /api/project/{projectID}` — Update project
- `GET /api/reference` — List references
- `GET /api/worktree` — List worktrees
- `POST /api/worktree` — Create worktree
- `DELETE /api/worktree` — Remove worktree
- `POST /api/worktree/refresh` — Refresh worktrees
- `POST /api/vcs/init` — Initialize VCS repository
- `GET /api/vcs` — VCS info
- `GET /api/vcs/base` — VCS review base
- `GET /api/vcs/status` — VCS status
- `GET /api/vcs/branch` — VCS branches
- `GET /api/vcs/diff` — VCS diff

### `skill://opencode/api/models.md` — Models, Providers & Generation (13)

List models, providers, usage limits, and invoke text, image, video, decision, or voice generation endpoints.

- `GET /api/model` — List models
- `GET /api/model/default` — Get default model
- `POST /api/experimental/generate/text` — Generate text
- `POST /api/experimental/generate` — Generate text (deprecated path)
- `POST /api/experimental/generate/image` — Generate images
- `POST /api/experimental/generate/video` — Create a video generation
- `GET /api/experimental/generate/video/{id}` — Read a video generation
- `POST /api/experimental/generate/decisions` — Generate decisions
- `GET /api/experimental/voice/models` — List voice models
- `POST /api/experimental/voice/session` — Create voice session
- `GET /api/provider` — List providers
- `GET /api/provider/{providerID}` — Get provider
- `GET /api/experimental/usage/limits` — Get usage limits

### `skill://opencode/api/extensions.md` — Agents, Skills, Plugins & MCP (31)

Inspect agents, commands, skills, plugins, MCP servers/resources, integrations, RPC methods, and websearch providers.

- `GET /api/agent` — List agents
- `GET /api/agent/{agentID}` — Get agent
- `GET /api/plugin` — List plugins
- `GET /api/plugin/gui` — Read plugin GUI bundle
- `POST /api/plugin/check` — Check plugin updates
- `POST /api/plugin/update` — Update plugins
- `GET /api/integration` — List integrations
- `GET /api/integration/{integrationID}` — Get integration
- `POST /api/experimental/integration/wellknown` — Add wellknown integration
- `POST /api/integration/{integrationID}/connect/key` — Connect with key
- `POST /api/integration/{integrationID}/connect/external` — Connect with external credentials
- `POST /api/integration/{integrationID}/connect/oauth` — Begin OAuth connection
- `GET /api/integration/{integrationID}/connect/oauth/{attemptID}` — Get OAuth attempt status
- `DELETE /api/integration/{integrationID}/connect/oauth/{attemptID}` — Cancel OAuth connection
- `POST /api/integration/{integrationID}/connect/oauth/{attemptID}/complete` — Complete OAuth connection
- `POST /api/integration/{integrationID}/connect/command` — Begin command connection
- `GET /api/integration/{integrationID}/connect/command/{attemptID}` — Get command attempt status
- `DELETE /api/integration/{integrationID}/connect/command/{attemptID}` — Cancel command connection
- `GET /api/mcp` — List MCP servers
- `PUT /api/experimental/mcp/{server}` — Add MCP server
- `DELETE /api/experimental/mcp/{server}` — Remove MCP server
- `POST /api/experimental/mcp/{server}/connect` — Connect MCP server
- `POST /api/experimental/mcp/{server}/disconnect` — Disconnect MCP server
- `GET /api/mcp/resource` — List MCP resources
- `POST /api/experimental/client-mcp/token` — Create client MCP WebSocket token
- `GET /api/experimental/client-mcp` — Attach client MCP server
- `GET /api/command` — List commands
- `GET /api/skill` — List skills
- `POST /api/rpc/{rpcID}/{method}` — Call a plugin RPC
- `GET /api/websearch/provider` — List web search providers
- `POST /api/websearch` — Search the web

### `skill://opencode/api/runtime.md` — Runtime, Jobs, Automations & Artifacts (62)

Server info, read-only config, background shells/jobs, automations, artifacts, blobs/media, SSE events, debug, and migration status.

- `GET /api/info` — Get server info
- `POST /api/pair` — Create pairing code
- `GET /auth/connect/{code}` — Redeem pairing code
- `GET /api/credential` — List credentials
- `POST /api/credential` — Create credential
- `PATCH /api/credential/{credentialID}` — Update credential
- `DELETE /api/credential/{credentialID}` — Remove credential
- `POST /api/credential/{credentialID}/activate` — Activate credential
- `GET /api/fs/read/*` — Read file
- `GET /api/fs/list` — List directory
- `GET /api/fs/find` — Find files
- `POST /api/experimental/fs/write` — Write file
- `POST /api/experimental/fs/watch` — Watch file
- `DELETE /api/experimental/fs/watch` — Unwatch file
- `GET /api/event` — Subscribe to events
- `GET /api/pty` — List PTY sessions
- `POST /api/pty` — Create PTY session
- `GET /api/pty/{ptyID}` — Get PTY session
- `PUT /api/pty/{ptyID}` — Update PTY session
- `DELETE /api/pty/{ptyID}` — Remove PTY session
- `POST /api/pty/{ptyID}/connect-token` — Create PTY WebSocket token
- `GET /api/pty/{ptyID}/connect` — Connect to PTY session
- `GET /api/experimental/session/{sessionID}/terminal/read` — Read the session's most recently controlled terminal
- `GET /api/experimental/session/{sessionID}/terminal`
- `POST /api/experimental/session/{sessionID}/terminal`
- `POST /api/experimental/persistent-pty/shutdown`
- `POST /api/experimental/persistent-pty/handoff`
- `GET /api/experimental/persistent-pty/{ptyID}`
- `PUT /api/experimental/persistent-pty/{ptyID}`
- `DELETE /api/experimental/persistent-pty/{ptyID}`
- `GET /api/experimental/persistent-pty/{ptyID}/snapshot`
- `POST /api/experimental/persistent-pty/{ptyID}/connect-token`
- `GET /api/experimental/persistent-pty/{ptyID}/connect` — Connect to a persistent PTY
- `GET /api/experimental/media/{hash}` — Read media blob
- `GET /api/experimental/blob/{id}` — Read a blob
- `GET /api/experimental/automation` — List automations
- `POST /api/experimental/automation` — Create automation
- `GET /api/experimental/automation/{automationID}` — Get automation
- `DELETE /api/experimental/automation/{automationID}` — Delete automation
- `POST /api/experimental/automation/{automationID}/pause` — Pause automation
- `POST /api/experimental/automation/{automationID}/resume` — Resume automation
- `GET /api/experimental/artifacts/providers` — List artifact providers
- `GET /api/experimental/artifacts` — List artifacts
- `POST /api/experimental/artifacts` — Create artifact
- `GET /api/experimental/artifacts/{artifactID}` — Read artifact
- `PATCH /api/experimental/artifacts/{artifactID}` — Update artifact
- `DELETE /api/experimental/artifacts/{artifactID}` — Delete artifact
- `GET /api/experimental/artifacts/{artifactID}/view/*` — View local artifact
- `GET /api/experimental/job` — List background jobs
- `POST /api/experimental/job/{id}/cancel` — Cancel background job
- `GET /api/shell` — List running shell commands
- `POST /api/shell` — Run shell command
- `GET /api/shell/{id}` — Get shell command
- `DELETE /api/shell/{id}` — Remove shell command
- `GET /api/shell/{id}/output` — Read shell output
- `POST /api/debug/heap-dump` — Write a heap snapshot
- `GET /api/debug/location` — List loaded locations
- `DELETE /api/debug/location` — Evict a loaded location
- `GET /api/experimental/migration/v1` — Get V1 migration status
- `GET /api/config` — Get configuration
- `GET /api/config/shell` — List available shells
- `PATCH /api/experimental/config` — Update global configuration
