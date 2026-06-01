# Agent Messaging Target Architecture

## Goal

Turn opencode into an agent runtime that can be driven from messaging platforms while preserving the current CLI, TUI, desktop, SDK, and HTTP API behavior with reduced RAM  usage and startup time.

## Non-Goals

- Do not remove coding-assistant workflows.
- Do not fork or vendor OpenClaw as the core runtime before a security and architecture review.
- Do not put WhatsApp, Telegram, or Slack-specific logic into `packages/opencode/src/session`.
- Do not make channel adapters bypass opencode permissions, session state, or tool approval semantics.

## Proposed Package Layout

```text
packages/
  agent-runtime/
    src/
      channel.ts
      router.ts
      session-store.ts
      event-bridge.ts
      response-format.ts
      config.ts
      index.ts
  slack/
    src/index.ts
  telegram/
    src/index.ts
  whatsapp/
    src/index.ts
```

## Runtime Responsibilities

`packages/agent-runtime` should become the shared channel orchestration layer:

- normalize inbound platform events into a common `ChannelMessage`,
- resolve a platform conversation to an opencode session,
- create sessions with a channel-aware title and metadata,
- forward text and attachments to `client.session.prompt` or `client.session.promptAsync`,
- subscribe to opencode events and route assistant/tool updates back to the source channel,
- format responses per platform limits,
- persist channel-to-session bindings outside process memory,
- enforce channel-level authorization and workspace routing.

## Adapter Responsibilities

Each messaging adapter should stay thin:

- validate platform signatures or webhook tokens,
- translate platform payloads into `ChannelMessage`,
- call the shared runtime,
- send formatted responses through the platform SDK,
- expose minimal platform-specific configuration.

## Channel Model

```ts
type ChannelID = "slack" | "telegram" | "whatsapp" | "discord" | "wechat" | 

type ChannelMessage = {
  channel: ChannelID
  platformMessageID: string
  conversationID: string
  senderID: string
  text: string
  threadID?: string
  attachments?: ChannelAttachment[]
  metadata?: Record<string, string>
}
```

## Session Binding Model

The runtime should map platform conversations to opencode sessions:

```text
channel + conversation_id + thread_id? + workspace/directory -> session_id
```

The existing Slack adapter uses an in-memory `Map`. That is acceptable for a prototype but not for a multi-platform agent because restarts lose session continuity. A durable binding table or lightweight storage file is needed before production use.

## Event Bridge

The runtime should consume the SDK event stream and map opencode events to channel updates:

- assistant text deltas -> incremental or final channel replies,
- tool starts -> optional status messages,
- tool completions -> concise tool result notifications,
- permission requests -> interactive approve/deny messages where platform capabilities allow it,
- errors -> user-safe failure messages plus internal logs.

## Agent Behavior

Messaging-driven sessions should use configured opencode agents rather than a separate agent engine. Channel-specific defaults can be added later:

- default agent for direct messages,
- stricter permission profile for group channels,
- channel-specific system instructions,
- optional subagent routing for long-running research or implementation tasks.

## Security Requirements

- Verify inbound webhook signatures for every platform.
- Scope allowed senders, chats, workspaces, or phone numbers explicitly.
- Never expose raw tool output that may contain secrets without filtering.
- Require explicit permission gates for filesystem writes, shell commands, and external network actions when the channel user is remote.
- Store platform tokens only in environment variables or a secrets manager.
- Keep platform payloads out of logs unless redacted.

## OpenClaw Evaluation Path

Use OpenClaw as a reference implementation for agent-oriented channel behavior. A future evaluation should compare:

- channel adapter abstractions,
- skill/plugin registry boundaries,
- memory and identity design,
- permission and audit model,
- deployment/runtime assumptions,
- license compatibility,
- security posture.

Only import code or dependencies after that review shows a concrete advantage over extending the existing opencode runtime
