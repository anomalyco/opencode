# OpenCode HTTP API

Call any endpoint below from Code Mode with `fetch("opencode:///api/...")`. Each group's file lists its parameters, bodies and responses.

- `current` in place of a session ID names the calling session, as in `opencode:///api/session/current`.
- Requests use the session's directory unless the `location[directory]` query or `x-opencode-directory` header sets one.
- Failed requests return a non-2xx status with `{ _tag, message }`.

## api/agent.md

- GET /api/agent: List agents
- GET /api/agent/{agentID}: Get agent

## api/artifacts.md

- GET /api/experimental/artifacts/providers (experimental): List artifact providers
- GET /api/experimental/artifacts (experimental): List artifacts
- POST /api/experimental/artifacts (experimental): Create artifact
- GET /api/experimental/artifacts/{artifactID} (experimental): Read artifact
- PATCH /api/experimental/artifacts/{artifactID} (experimental): Update artifact
- DELETE /api/experimental/artifacts/{artifactID} (experimental): Delete artifact
- GET /api/experimental/artifacts/{artifactID}/view/* (experimental): View local artifact

## api/automation.md

- GET /api/experimental/automation (experimental): List automations
- POST /api/experimental/automation (experimental): Create automation
- GET /api/experimental/automation/{automationID} (experimental): Get automation
- DELETE /api/experimental/automation/{automationID} (experimental): Delete automation
- POST /api/experimental/automation/{automationID}/pause (experimental): Pause automation
- POST /api/experimental/automation/{automationID}/resume (experimental): Resume automation

## api/blob.md

- GET /api/experimental/blob/{id} (experimental): Read a blob

## api/client-mcp.md

- GET /api/experimental/client-mcp (experimental): Attach client MCP server

## api/command.md

- GET /api/command: List commands

## api/config.md

- GET /api/config: Get configuration
- GET /api/config/shell: List available shells

## api/credential.md

- GET /api/credential: List credentials

## api/form.md

- GET /api/form: List pending forms

## api/generate.md

- POST /api/experimental/generate/text (experimental): Generate text
- POST /api/experimental/generate (experimental): Generate text (deprecated path)
- POST /api/experimental/generate/image (experimental): Generate images
- POST /api/experimental/generate/video (experimental): Create a video generation
- GET /api/experimental/generate/video/{id} (experimental): Read a video generation
- POST /api/experimental/generate/decisions (experimental): Generate decisions

## api/info.md

- GET /api/info: Get server info

## api/integration.md

- GET /api/integration: List integrations
- GET /api/integration/{integrationID}: Get integration
- POST /api/experimental/integration/wellknown (experimental): Add wellknown integration
- POST /api/integration/{integrationID}/connect/key: Connect with key
- POST /api/integration/{integrationID}/connect/external: Connect with external credentials
- POST /api/integration/{integrationID}/connect/oauth: Begin OAuth connection
- GET /api/integration/{integrationID}/connect/oauth/{attemptID}: Get OAuth attempt status
- DELETE /api/integration/{integrationID}/connect/oauth/{attemptID}: Cancel OAuth connection
- POST /api/integration/{integrationID}/connect/oauth/{attemptID}/complete: Complete OAuth connection
- POST /api/integration/{integrationID}/connect/command: Begin command connection
- GET /api/integration/{integrationID}/connect/command/{attemptID}: Get command attempt status
- DELETE /api/integration/{integrationID}/connect/command/{attemptID}: Cancel command connection

## api/job.md

- GET /api/experimental/job (experimental): List background jobs
- POST /api/experimental/job/{id}/cancel (experimental): Cancel background job

## api/location.md

- GET /api/location: Get location
- POST /api/location/reload: Reload configuration

## api/machine.md

- GET /api/experimental/machine (experimental): List machines
- POST /api/experimental/machine (experimental): Add or invite a machine
- DELETE /api/experimental/machine/{name} (experimental): Remove a machine

## api/mcp.md

- GET /api/mcp: List MCP servers
- PUT /api/experimental/mcp/{server} (experimental): Add MCP server
- DELETE /api/experimental/mcp/{server} (experimental): Remove MCP server
- POST /api/experimental/mcp/{server}/connect (experimental): Connect MCP server
- POST /api/experimental/mcp/{server}/disconnect (experimental): Disconnect MCP server
- GET /api/mcp/resource: List MCP resources

## api/media.md

- GET /api/experimental/media/{hash} (experimental): Read media blob

## api/model.md

- GET /api/model: List models
- GET /api/model/default: Get default model

## api/permission.md

- GET /api/permission/request: List pending permission requests
- GET /api/permission/saved: List saved permissions

## api/plugin.md

- GET /api/plugin: List plugins
- GET /api/plugin/gui: Read plugin GUI bundle

## api/project.md

- GET /api/project: List projects
- PATCH /api/project/{projectID}: Update project

## api/provider.md

- GET /api/provider: List providers
- GET /api/provider/{providerID}: Get provider

## api/reference.md

- GET /api/reference: List references

## api/rpc.md

- POST /api/rpc/{rpcID}/{method}: Call a plugin RPC

## api/session.md

- GET /api/session: List sessions
- POST /api/session: Create session
- GET /api/experimental/session/stats (experimental): Get session statistics
- POST /api/experimental/session/import (experimental): Import session
- GET /api/experimental/session/{sessionID}/export (experimental): Export session
- GET /api/session/active: List active sessions
- GET /api/session/{sessionID}: Get session
- PATCH /api/session/{sessionID}: Update session
- DELETE /api/session/{sessionID}: Delete session
- POST /api/session/{sessionID}/fork: Fork session
- POST /api/session/{sessionID}/agent: Switch session agent
- POST /api/session/{sessionID}/model: Switch session model
- POST /api/session/{sessionID}/move: Move session
- POST /api/session/{sessionID}/prompt: Send message
- POST /api/session/{sessionID}/command: Run command
- POST /api/experimental/session/{sessionID}/skill (experimental): Activate skill
- POST /api/session/{sessionID}/synthetic: Add synthetic message
- POST /api/session/{sessionID}/shell: Run shell command
- POST /api/session/{sessionID}/compact: Compact session
- POST /api/experimental/session/{sessionID}/wait (experimental): Wait for session
- POST /api/session/{sessionID}/revert/stage: Stage session revert
- DELETE /api/session/{sessionID}/revert: Clear staged revert
- POST /api/session/{sessionID}/revert/commit: Commit staged revert
- GET /api/session/{sessionID}/context: Get session context
- GET /api/session/{sessionID}/diff: Diff session turns
- GET /api/session/{sessionID}/inbox: List session inbox
- PATCH /api/session/{sessionID}/inbox/{inboxID}: Update inbox item
- DELETE /api/session/{sessionID}/inbox/{inboxID}: Cancel inbox input
- GET /api/experimental/session/{sessionID}/instructions/entries (experimental): List instruction entries
- PUT /api/experimental/session/{sessionID}/instructions/entries/{key} (experimental): Put instruction entry
- DELETE /api/experimental/session/{sessionID}/instructions/entries/{key} (experimental): Remove instruction entry
- POST /api/session/{sessionID}/generate: Generate text from session context
- GET /api/experimental/session/{sessionID}/log (experimental): Read the session log
- POST /api/session/{sessionID}/interrupt: Interrupt session execution
- POST /api/session/{sessionID}/background: Background blocking session tools
- GET /api/session/{sessionID}/message/{messageID}: Get session message
- GET /api/session/{sessionID}/form: List session forms
- POST /api/session/{sessionID}/form: Create session form
- GET /api/session/{sessionID}/form/{formID}: Get session form
- DELETE /api/session/{sessionID}/form/{formID}: Cancel form
- POST /api/session/{sessionID}/form/{formID}/reply: Reply to form
- PUT /api/session/{sessionID}/environment: Set session environment
- POST /api/session/{sessionID}/view: View session
- GET /api/session/{sessionID}/message: Get session messages
- GET /api/session/{sessionID}/permission: List session permission requests
- POST /api/session/{sessionID}/permission: Create permission request
- GET /api/session/{sessionID}/permission/{requestID}: Get permission request
- GET /api/experimental/session/{sessionID}/terminal/read (experimental): Read the session's most recently controlled terminal
- GET /api/experimental/session/{sessionID}/terminal (experimental):
- POST /api/experimental/session/{sessionID}/terminal (experimental):

## api/skill.md

- GET /api/skill: List skills

## api/usage.md

- GET /api/experimental/usage/limits (experimental): Get usage limits

## api/vcs.md

- POST /api/vcs/init: Initialize VCS repository
- GET /api/vcs: VCS info
- GET /api/vcs/base: VCS review base
- GET /api/vcs/status: VCS status
- GET /api/vcs/branch: VCS branches
- GET /api/vcs/diff: VCS diff

## api/voice.md

- GET /api/experimental/voice/models (experimental): List voice models
- POST /api/experimental/voice/session (experimental): Create voice session

## api/websearch.md

- GET /api/websearch/provider: List web search providers
- POST /api/websearch: Search the web

## api/worktree.md

- GET /api/worktree: List worktrees
- POST /api/worktree: Create worktree
- DELETE /api/worktree: Remove worktree
- POST /api/worktree/refresh: Refresh worktrees
