# OpenCode HTTP API

Call any endpoint below from Code Mode with `fetch("opencode:///api/...")`. Each group's file lists its parameters, bodies and responses.

- `current` in place of a session ID names the calling session, as in `opencode:///api/session/current`.
- Requests use the session's directory unless the `location[directory]` query or `x-opencode-directory` header sets one.
- Failed requests return a non-2xx status with `{ _tag, message }`.

## api/agent.md

- GET /api/agent: List agents
- GET /api/agent/{agentID}: Get agent

## api/automation.md

- GET /api/experimental/automation (experimental): List automations
- POST /api/experimental/automation (experimental): Create automation
- GET /api/experimental/automation/{automationID} (experimental): Get automation
- DELETE /api/experimental/automation/{automationID} (experimental): Delete automation
- POST /api/experimental/automation/{automationID}/pause (experimental): Pause automation
- POST /api/experimental/automation/{automationID}/resume (experimental): Resume automation

## api/blob.md

- GET /api/experimental/blob/{id} (experimental): Read a blob

## api/command.md

- GET /api/command: List commands

## api/form.md

- GET /api/form: List pending forms

## api/generate.md

- POST /api/experimental/generate/text (experimental): Generate text
- POST /api/experimental/generate/image (experimental): Generate images
- POST /api/experimental/generate/video (experimental): Create a video generation
- GET /api/experimental/generate/video/{id} (experimental): Read a video generation
- POST /api/experimental/generate/decisions (experimental): Generate decisions

## api/info.md

- GET /api/info: Get server info

## api/location.md

- GET /api/location: Get location
- POST /api/location/reload: Reload configuration

## api/model.md

- GET /api/model: List models
- GET /api/model/default: Get default model

## api/permission.md

- GET /api/permission/request: List pending permission requests

## api/project.md

- GET /api/project: List projects
- PATCH /api/project/{projectID}: Update project

## api/provider.md

- GET /api/provider: List providers
- GET /api/provider/{providerID}: Get provider

## api/session/index.md

- GET /api/session: List sessions
- POST /api/session: Create session
- GET /api/session/{sessionID}: Get session
- PATCH /api/session/{sessionID}: Update session

## api/session/active.md

- GET /api/session/active: List active sessions

## api/session/agent.md

- POST /api/session/{sessionID}/agent: Switch session agent

## api/session/command.md

- POST /api/session/{sessionID}/command: Run command

## api/session/compact.md

- POST /api/session/{sessionID}/compact: Compact session

## api/session/context.md

- GET /api/session/{sessionID}/context: Get session context

## api/session/diff.md

- GET /api/session/{sessionID}/diff: Diff session turns

## api/session/fork.md

- POST /api/session/{sessionID}/fork: Fork session

## api/session/form.md

- GET /api/session/{sessionID}/form: List session forms
- GET /api/session/{sessionID}/form/{formID}: Get session form
- POST /api/session/{sessionID}/form/{formID}/reply: Reply to form

## api/session/generate.md

- POST /api/session/{sessionID}/generate: Generate text from session context

## api/session/inbox.md

- GET /api/session/{sessionID}/inbox: List session inbox
- PATCH /api/session/{sessionID}/inbox/{inboxID}: Update inbox item
- DELETE /api/session/{sessionID}/inbox/{inboxID}: Cancel inbox input

## api/session/interrupt.md

- POST /api/session/{sessionID}/interrupt: Interrupt session execution

## api/session/message.md

- GET /api/session/{sessionID}/message/{messageID}: Get session message
- GET /api/session/{sessionID}/message: Get session messages

## api/session/model.md

- POST /api/session/{sessionID}/model: Switch session model

## api/session/permission.md

- GET /api/session/{sessionID}/permission: List session permission requests
- GET /api/session/{sessionID}/permission/{requestID}: Get permission request

## api/session/prompt.md

- POST /api/session/{sessionID}/prompt: Send message

## api/session/synthetic.md

- POST /api/session/{sessionID}/synthetic: Add synthetic message

## api/session/wait.md

- POST /api/experimental/session/{sessionID}/wait (experimental): Wait for session

## api/skill.md

- GET /api/skill: List skills

## api/vcs.md

- POST /api/vcs/init: Initialize VCS repository
- GET /api/vcs: VCS info
- GET /api/vcs/base: VCS review base
- GET /api/vcs/status: VCS status
- GET /api/vcs/branch: VCS branches
- GET /api/vcs/diff: VCS diff

## api/worktree.md

- GET /api/worktree: List worktrees
- POST /api/worktree: Create worktree
- DELETE /api/worktree: Remove worktree
- POST /api/worktree/refresh: Refresh worktrees
