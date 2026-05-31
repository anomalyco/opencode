# Agent Messaging Migration Plan

## Phase 0: Project Map and Design Artifacts

Status: started.

- Create `specs/agent-messaging/project-map.md`.
- Create `specs/agent-messaging/target-architecture.md`.
- Create `specs/agent-messaging/adapter-contract.md`.
- Keep OpenClaw as a reference until a specific integration value is proven.

## Phase 1: Extract Shared Runtime From Slack

Goal: turn the current Slack-only package into a thin adapter over a reusable runtime.

- Add `packages/agent-runtime`.
- Move thread/session mapping logic out of `packages/slack/src/index.ts`.
- Replace `any` session types with SDK-generated types or local inferred types.
- Add a durable session binding abstraction.
- Keep Slack behavior equivalent during extraction.

## Phase 2: Harden Slack

Goal: make the existing Slack path production-credible before adding more platforms.

- Redact raw event logging.
- Add explicit config validation for tokens and allowed workspaces/channels.
- Format tool events consistently.
- Decide whether Slack should use `session.prompt` or `session.promptAsync` plus event streaming.
- Add package-local typecheck and focused tests if a test harness exists nearby.

## Phase 3: Add Telegram Adapter

Goal: validate that the runtime abstraction supports a second platform with different threading and formatting.

- Add `packages/telegram`.
- Support local long polling first if simpler.
- Support webhook mode for deploys.
- Map Telegram chats/topics to runtime conversations.
- Implement sender allowlist.
- Validate message formatting and length splitting.

## Phase 4: Add WhatsApp Adapter

Goal: support WhatsApp Business messaging after the shared runtime has proven itself with Slack and Telegram.

- Add `packages/whatsapp`.
- Use WhatsApp Business Cloud API unless a concrete provider requirement changes this.
- Implement webhook verification.
- Map phone-number conversations to runtime sessions.
- Handle session-window constraints and user-safe error replies.
- Add media attachment normalization only after text flow is stable.

## Phase 4.1: Add Discord Adapter

Goal: add support for Discord communities using bot integration.

- Add `packages/discord`.
- Support WebSocket Gateway connection for message/reaction events.
- Implement webhook support for interaction callbacks.
- Map Discord server/channel/thread structure to runtime conversations.
- Handle rate-limiting gracefully with queues.

## Phase 4.2: Add WeChat Adapter

Goal: add support for enterprise and public WeChat communications.

- Add `packages/wechat`.
- Implement signature verification and XML payload decryption/parsing.
- Support active session acknowledgement constraints (5-second rule).
- Map user OpenID / Enterprise UserID to runtime sessions.

## Phase 5: Agent Capabilities

Goal: evolve from reactive chat replies to agent workflows.

- Add channel-specific default agent configuration.
- Add remote-safe permission profiles.
- Add long-running task status updates.
- Add identity and audit mapping from channel users to opencode actions.
- Add optional subagent routing for research, codebase exploration, or implementation tasks.

## Phase 6: OpenClaw Evaluation

Goal: decide whether to integrate, interoperate with, or simply learn from OpenClaw.

- Review license and dependency footprint.
- Compare adapter abstractions to the proposed `packages/agent-runtime`.
- Compare skill/plugin registry with opencode plugins and MCP support.
- Compare permission and audit models.
- Prototype only a narrow integration if it reduces implementation risk.

## Acceptance Criteria

- Slack still works through the extracted runtime.
- Telegram can create and resume opencode sessions by conversation.
- WhatsApp can create and resume opencode sessions by conversation.
- Discord can create and resume opencode sessions by server/channel/thread.
- WeChat can create and resume opencode sessions by user or enterprise chat.
- Session bindings survive process restart.
- Remote users cannot access arbitrary workspaces or tools without policy.
- Core opencode session, agent, and permission semantics remain intact.

## Open Questions

- Should messaging adapters run as separate packages/processes or inside one multi-channel daemon?
- Should channel session bindings live in opencode storage or adapter-owned storage?
- How should remote approval prompts map to existing permission APIs?
- What is the minimum audit record required for remote tool execution?
- Which deployment target matters first: local daemon, server, Docker, or hosted?
