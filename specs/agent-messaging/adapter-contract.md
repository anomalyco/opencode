# Messaging Adapter Contract

This contract defines the boundary between platform-specific messaging packages and the shared agent runtime.

## Adapter Interface

```ts
type MessagingAdapter = {
  id: string
  start(input: AdapterStartInput): Promise<void>
  stop(): Promise<void>
  send(input: ChannelSendInput): Promise<void>
}
```

Adapters own platform connections. The shared runtime owns opencode session orchestration.

## Inbound Message

```ts
type ChannelMessage = {
  channel: "slack" | "telegram" | "whatsapp" | "discord" | "wechat"
  platformMessageID: string
  conversationID: string
  senderID: string
  text: string
  threadID?: string
  attachments?: ChannelAttachment[]
  metadata?: Record<string, string>
}
```

## Outbound Message

```ts
type ChannelSendInput = {
  conversationID: string
  threadID?: string
  text: string
  blocks?: ChannelBlock[]
  replyToMessageID?: string
}
```

## Runtime Flow

1. Adapter receives and verifies a platform event.
2. Adapter creates a `ChannelMessage`.
3. Runtime resolves the channel conversation to an opencode session.
4. Runtime sends the message to opencode.
5. Runtime maps opencode responses and events to `ChannelSendInput`.
6. Adapter sends the response through the platform SDK.

## Platform Notes

### Slack

- Existing package: `packages/slack`.
- Existing SDK: `@slack/bolt`.
- Current mode: Socket Mode.
- Thread identity: Slack `channel` plus `thread_ts` or message `ts`.
- Main gap: shared runtime extraction and durable session binding.

### Telegram

- Recommended first mode: webhook for deploys, long polling for local development.
- Conversation identity: chat ID, optionally topic/thread ID for forum groups.
- Important constraints: message length limits, Markdown/HTML formatting differences, bot privacy mode in groups.

### WhatsApp

- Recommended provider: WhatsApp Business Cloud API unless a project-specific provider is selected.
- Conversation identity: business phone number plus user phone number.
- Important constraints: webhook verification, template-message policy, session windows, media handling, stricter privacy expectations.

### Discord

- Recommended mode: Bot client using WebSocket gateway connection or HTTP webhooks.
- Conversation identity: Guild ID, Channel ID, and User ID. Supports thread-based conversations via Discord thread channels.
- Important constraints: rate limits (especially for message sends/edits), rich embeds usage, markdown formatting, bot gateway intent permissions.

### WeChat

- Recommended provider: WeChat Work (Enterprise) API or Official Accounts Platform.
- Conversation identity: Enterprise ID, User ID (OpenID/UnionID), or public account user identifier.
- Important constraints: strict IP white-lists for webhooks, response timeout limits (must reply or acknowledge within 5 seconds), encryption of message packages, media hosting restrictions.

## Permission Handling

Messaging platforms are remote control surfaces. The runtime should require explicit policy for:

- which users can invoke the agent,
- which workspaces they can target,
- which tools can run without approval,
- how approval requests are represented in the channel,
- how audit logs map platform identity to opencode actions.

## Persistence Requirements

Session binding persistence should store:

- channel ID,
- platform workspace/account ID where applicable,
- conversation ID,
- thread ID where applicable,
- opencode session ID,
- opencode workspace/directory,
- created timestamp,
- last activity timestamp,
- archived/deleted state.
