# Channel System Phase 1 - Implementation Plan

Based on `docs/channel.phase1.md`. Contracts and runtime files already created; remaining work focuses on fixes, barrel exports, service layer, and integration.

## Tasks

### Wave 1 (independent - disjoint files)

- [x] **Task 1: Fix runtime import bugs**
  - `runtime/lifecycle.ts` references `ChannelHealth`/`ChannelCapabilities` without imports
  - `runtime/router.ts` references `MediaPart` without importing it
  - Acceptance: all runtime files import what they use; `bun typecheck` in channels dir passes

- [x] **Task 2: Create contracts barrel export**
  - Create `contracts/index.ts` re-exporting all contract interfaces and types
  - Must re-export: Channel, ChannelHealth, ChannelCapabilities from `./channel`, MessageSender from `./sender`, MessageEditor from `./editor`, TypingCapable from `./typing`, MediaPart + MediaSender from `./media`, ReactionCapable from `./reactions`, StreamingCapable from `./streaming`
  - Acceptance: `import { Channel, MessageSender } from "../contracts"` works

- [x] **Task 3: Create runtime barrel export**
  - Create `runtime/index.ts` re-exporting all runtime modules
  - Must re-export: registry, lifecycle, router, health, capabilities
  - Acceptance: `import { registry, router } from "../runtime"` works

- [x] **Task 4: Update schema.ts for plugin-based system**
  - Make ChannelType support string types (not just `slack`|`discord`) to support plugins
  - Remove `webhook_url` from ChannelInfo (replaced by plugin-specific config)
  - Add optional `config: Schema.Unknown` for plugin-specific configuration
  - Keep backward compatibility where possible
  - Acceptance: schema compiles; ChannelType accepts any string

### Wave 2 (depends on Wave 1 - needs barrel exports to exist)

- [x] **Task 5: Create service layer service/channels.ts**
  - Implement `Interface`, `Service` class, and `layer` per phase1.md spec (lines 372-505)
  - Must follow existing Effect patterns: `Effect.fn`, `Context.Service`, `Layer.effect`
  - Import from existing `channel.sql.ts` (channelTable), `Database`, `Identifier`, `Log`
  - Import router from `../runtime/router`, health from `../runtime/health`, capabilities from `../runtime/capabilities`
  - Do NOT use `Layer.Effected` (doesn't exist) - use `Context.Service` pattern as in existing `index.ts`
  - Do NOT re-define ChannelInfo/CreateChannelInput - import from `../schema`
  - Use self-export pattern at file bottom: `export * as Channels from "."`
  - Acceptance: service layer compiles; provides create/list/remove/send/edit/typing/react/sendMedia/stream/health/capabilities

- [x] **Task 6: Update channels/index.ts to use new service**
  - Replace current webhook-based implementation with re-exports from new service layer
  - Import `Service` and `layer` from `./service/channels`
  - Re-export using `export * as Channels from "./service/channels"` pattern
  - Keep `defaultLayer` export
  - Acceptance: `bun typecheck` passes; all existing imports from channels/index still work

### Wave 3 (integration)

- [x] **Task 7: Run typecheck and fix all issues**
  - Run `bun typecheck` from `packages/opencode`
  - Fix any remaining type errors, import issues, or missing exports
  - Acceptance: `bun typecheck` passes with zero errors in channels files

### Wave 4 (plugin implementations - independent, parallel)

- [x] **Task 8: Rewrite discord-plugin.ts with real Discord REST + Gateway API**
  - Replace stub with full implementation using native fetch
  - Implement Channel, MessageSender, MessageEditor, TypingCapable, ReactionCapable, MediaSender
  - REST API at `https://discord.com/api/v10`, optional WebSocket gateway via `ws` package
  - Rate-limit retry (429), tagged error class, reconnect logic
  - Acceptance: typechecks clean; all 6 interfaces implemented with real API calls

- [x] **Task 9: Rewrite slack-plugin.ts with real Slack Web API**
  - Replace stub with full implementation using native fetch
  - Implement Channel, MessageSender, MessageEditor, TypingCapable, ReactionCapable, MediaSender
  - `auth.test` validation, `chat.postMessage`, `chat.update`, `typing.start`, `reactions.add`, `files.upload`
  - Acceptance: typechecks clean; all 6 interfaces implemented with real API calls

- [x] **Task 10: Rewrite telegram-plugin.ts with real Telegram Bot API**
  - Replace stub with full implementation using native fetch (NOT grammy)
  - Implement Channel, MessageSender, MessageEditor, TypingCapable, ReactionCapable, MediaSender
  - `getMe` validation, `sendMessage`, `editMessageText`, `setMessageReaction`, FormData media uploads
  - Optional long polling for receiving messages
  - Acceptance: typechecks clean; all 6 interfaces implemented with real API calls

- [x] **Task 11: Rewrite teams-plugin.ts with real Teams Incoming Webhook**
  - Replace stub with full implementation using native fetch
  - Implement Channel, MessageSender (webhook-only: no editing/typing/reactions/media)
  - Adaptive Card formatting via Incoming Webhook URL
  - Acceptance: typechecks clean; send delivers real Adaptive Cards

- [x] **Task 12: Rewrite email-plugin.ts with real SMTP via nodemailer**
  - Replace stub with full implementation using nodemailer (already installed)
  - Implement Channel, MessageSender, MediaSender
  - `transporter.verify()` validation, `sendMail()` for sending, attachments for media
  - Acceptance: typechecks clean; sends real emails via SMTP

- [x] **Task 13: Rewrite whatsapp-plugin.ts with real WhatsApp Cloud API**
  - Replace stub with full implementation using native fetch
  - Implement Channel, MessageSender, TypingCapable, ReactionCapable, MediaSender
  - Cloud API text/image/video/document messages, media upload, reactions
  - Acceptance: typechecks clean; all 5 interfaces implemented with real API calls

- [x] **Task 14: Run typecheck on all rewritten plugins**
  - Verify all 6 plugin files typecheck with zero errors
  - Acceptance: `bun typecheck` shows no errors in any `*-plugin.ts` files

### Wave 5 (plugin registration + service integration)

- [x] **Task 15: Create channel.config.ts — plugin registration map**
  - Create `channel.config.ts` mapping type strings → Channel constructors
  - Each entry defines a `create(id, name, config)` function that instantiates the right plugin
  - Export `getChannelPlugin(type)` and `getRegisteredTypes()` helpers
  - Includes all 6 plugins: discord, slack, telegram, teams, email, whatsapp
  - Acceptance: typechecks; `getChannelPlugin("slack")` returns SlackChannel constructor

- [x] **Task 16: Update service/channels.ts to use plugin config on create/remove**
  - On `create`: look up plugin by type, instantiate channel, register in registry, call `start()`
  - On `remove`: stop and unregister channel from registry before DB delete
  - Import `getChannelPlugin` from `../channel.config` and `RegistryService` from `../runtime/registry`
  - Pass `input.config` through to plugin constructor
  - Acceptance: typechecks; creating a channel with known type auto-registers the plugin

### Wave 6 (Phase 2A — Inbound Abstraction Foundation)

- [x] **Task 17: Create contracts/inbound.ts — shared inbound message types**
  - Define `ChatType` ("private" | "group" | "supergroup" | "channel")
  - Define `SenderInfo` (platform, platformId, canonicalId, username, displayName)
  - Define `InboundContext` (channel, chatId, chatType, senderId, messageId, mentioned, replyToMessageId, spaceId, spaceType, raw)
  - Define `InboundMessage` (context, sender, content, media, sessionKey, convenience mirrors)
  - Acceptance: typechecks; all inbound types are platform-agnostic

- [x] **Task 18: Create contracts/identity.ts — canonical ID system**
  - `buildCanonicalId(platform, platformId)` → `"platform:platformId"`
  - `parseCanonicalId(canonical)` → `[platform, platformId] | null`
  - `matchAllowed(sender, allowed)` — matches against platformId, @username, or canonical format
  - Acceptance: typechecks; identity helpers work for all platforms

- [x] **Task 19: Create runtime/bus.ts — MessageBus pub/sub**
  - `Interface` with `publish(InboundMessage)`, `take()`, `peek()`, `size()`
  - `Service` extends `Context.Service` with `@opencode/MessageBus`
  - `layer` using `Queue.sliding<InboundMessage>(64)` for backpressure
  - Acceptance: typechecks; bus provides publish/take semantics

- [x] **Task 20: Update barrel exports for inbound contracts and bus**
  - Add `contracts/index.ts` exports for InboundContext, InboundMessage, SenderInfo, ChatType, identity helpers
  - Add `runtime/index.ts` exports for MessageBusService, messageBusLayer
  - Acceptance: typechecks; `import { InboundMessage } from "../contracts"` works

- [x] **Task 21: Add inbound processing to Telegram plugin**
  - Add `setBus(bus)` method, `processInboundMessage(msg)` handler
  - Build InboundContext: chat type detection (private/group/supergroup/channel)
  - Detect @bot mentions via entity types (mention, text_mention, bot_command)
  - Handle reply context from `reply_to_message`
  - Extract inbound media (photo, voice, audio, video, document, sticker)
  - Publish to bus via `Effect.runFork` (fire-and-forget)
  - Acceptance: pollOnce processes updates into InboundMessage and publishes to bus

- [x] **Task 22: Add inbound processing to Discord plugin**
  - Add `setBus(bus)` method, enhance `handleDispatch` for MESSAGE_CREATE
  - Build InboundContext: DM vs guild detection, mention detection, reply context
  - Convert attachments to MediaPart entries
  - Publish to bus via `Effect.runFork`
  - Acceptance: gateway events produce InboundMessage published to bus

- [x] **Task 23: Add inbound processing to Slack, WhatsApp, Teams, Email plugins**
  - Slack: `handleEvent(event)` method, chat type detection, mention stripping, thread replies
  - WhatsApp: `handleWebhook(body)` method, Cloud API payload parsing, reply context
  - Teams: stub `handleTeamsEvent()` (webhook-only, no inbound)
  - Email: `handleInboundEmail(email)` hook for future IMAP integration
  - Acceptance: all plugins have inbound plumbing; typechecks clean

### Wave 7 (Phase 2A — Bus Wiring)

- [x] **Task 24: Wire MessageBus into service layer**
  - Add `import { Service as MessageBusService } from "../runtime/bus"` to service/channels.ts
  - In `create()`, yield MessageBusService after plugin instantiation
  - Call `channelInstance.setBus(bus)` if the plugin has the method (duck-typing check)
  - Add `MessageBusService.layer` to `defaultLayer` Layer.provide chain
  - Acceptance: typechecks; creating a channel auto-injects the bus for inbound processing

### Wave 8 (Phase 2C — Typing Keepalive)

- [x] **Task 25: Create runtime/keepalive.ts — typing keepalive utility**
  - `typingKeepalive(channelId, intervalMs?)` — scoped Effect that repeats `startTyping` every 4.5s
  - Uses `Effect.forkScoped` for the repeating fiber; auto-interrupts on scope release
  - `sendTypingOnce(channelId)` — non-scoped single-shot version
  - Add to runtime barrel export
  - Acceptance: typechecks; keepalive repeats until scope closes

- [x] **Task 26: Add typingKeepalive to service layer**
  - Add `typingKeepalive(channelId, intervalMs?)` to Interface
  - Implement via `Effect.fn("Channels.typingKeepalive")` wrapping keepalive utility
  - Acceptance: typechecks; `channels.typingKeepalive(id)` works