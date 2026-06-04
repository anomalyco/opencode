# Channel Architecture Recommendation for Opencode

## Overview

The recommended channel system for Opencode should combine the architectural strengths of OpenClaw with the user-facing features found in PicoClaw.

The goal is to create a scalable, maintainable, and extensible communication layer capable of supporting multiple messaging platforms such as Discord, Slack, Telegram, Microsoft Teams, WhatsApp, Email, SMS, and future integrations without requiring modifications to the agent core.

This architecture separates channel infrastructure from channel functionality through capability-based interfaces and plugin registration.

---

# Design Goals

The channel system should:

* Support multiple communication platforms.
* Allow channels to be added or removed independently.
* Expose capabilities dynamically.
* Minimize channel-specific logic inside the agent core.
* Support rich interactions such as media, voice, reactions, typing indicators, and message editing.
* Enable future channel integrations without architectural changes.
* Follow Opencode's Effect-based dependency injection architecture.

---

# High-Level Architecture

```text
┌─────────────────────┐
│     Agent Core      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Channel Service   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Capability Router  │
└──────────┬──────────┘
           │
 ┌─────────┼─────────┐
 ▼         ▼         ▼
Discord   Slack   Telegram
Plugin    Plugin   Plugin
```

The Agent Core should never communicate directly with Discord, Slack, or any specific platform.

Instead, it communicates with the Channel Service.

The Channel Service determines:

* Which channel is active.
* What capabilities are available.
* How messages should be delivered.

---

# Directory Structure

```text
src/
├── channels/
│
├── contracts/
│   ├── channel.ts
│   ├── sender.ts
│   ├── editor.ts
│   ├── media.ts
│   ├── typing.ts
│   ├── reactions.ts
│   ├── voice.ts
│   ├── streaming.ts
│   └── files.ts
│
├── runtime/
│   ├── registry.ts
│   ├── lifecycle.ts
│   ├── router.ts
│   ├── health.ts
│   └── capabilities.ts
│
├── plugins/
│   ├── discord/
│   ├── slack/
│   ├── telegram/
│   ├── teams/
│   ├── email/
│   └── whatsapp/
│
└── service/
    └── channels.ts
```

---

# Core Channel Contract

Every channel must implement a minimal base contract.

```ts
interface Channel {
    id: string
    type: string

    start(): Promise<void>
    stop(): Promise<void>

    send(message: OutboundMessage): Promise<void>

    health(): Promise<ChannelHealth>

    capabilities(): ChannelCapabilities
}
```

This ensures every channel can be managed uniformly.

---

# Capability System

Instead of forcing every platform to implement every feature, capabilities should be optional.

Example:

```ts
interface ChannelCapabilities {
    messaging: boolean
    editing: boolean
    typing: boolean
    reactions: boolean
    media: boolean
    voice: boolean
    streaming: boolean
    files: boolean
}
```

Example:

Discord:

```json
{
  "messaging": true,
  "editing": true,
  "typing": true,
  "reactions": true,
  "media": true,
  "voice": true,
  "streaming": true
}
```

Slack:

```json
{
  "messaging": true,
  "editing": true,
  "typing": false,
  "reactions": true,
  "media": true,
  "voice": false
}
```

---

# Capability Interfaces

## Message Sending

```ts
interface MessageSender {
    send(
        chatID: string,
        content: string
    ): Promise<string>
}
```

---

## Message Editing

```ts
interface MessageEditor {
    edit(
        chatID: string,
        messageID: string,
        content: string
    ): Promise<void>
}
```

Used for:

* Tool progress
* Streaming responses
* Message corrections

---

## Typing Indicators

```ts
interface TypingCapable {
    startTyping(
        chatID: string
    ): Promise<() => void>
}
```

Used for:

* Discord typing
* Teams typing
* Future integrations

---

## Media Uploads

```ts
interface MediaSender {
    sendMedia(
        chatID: string,
        media: MediaPart[]
    ): Promise<void>
}
```

Supports:

* Images
* PDFs
* Videos
* Audio

---

## Reactions

```ts
interface ReactionCapable {
    react(
        chatID: string,
        messageID: string,
        emoji: string
    ): Promise<void>
}
```

Used for:

* 👀 Processing
* ✅ Complete
* ❌ Failure

---

## Voice

```ts
interface VoiceCapable {
    joinVoice(
        roomID: string
    ): Promise<void>

    leaveVoice(
        roomID: string
    ): Promise<void>

    playAudio(
        audio: Buffer
    ): Promise<void>
}
```

Supports:

* Discord voice
* Teams meetings
* Future voice channels

---

## Streaming

```ts
interface StreamingCapable {
    stream(
        chatID: string,
        chunks: AsyncIterable<string>
    ): Promise<void>
}
```

Used for:

* Token-by-token output
* Live reasoning
* Progress updates

---

# Plugin Registry

Channels should self-register.

```ts
registry.register(
    "discord",
    DiscordPlugin
)

registry.register(
    "slack",
    SlackPlugin
)
```

The core system never imports channel implementations directly.

---

# Lifecycle Manager

Responsible for:

* Startup
* Shutdown
* Health checks
* Reconnection
* Crash recovery

```ts
channel.start()

channel.stop()

channel.health()
```

---

# Health Monitoring

Every channel should expose health status.

```ts
{
    connected: true,
    latency: 32,
    lastMessage: 1712345678,
    reconnectAttempts: 0
}
```

Used for:

* UI dashboards
* Diagnostics
* Automatic recovery

---

# Message Routing

The router decides where outbound messages go.

```ts
router.send({
    channel: "discord",
    chatID: "...",
    content: "Hello"
})
```

The agent should never know platform-specific details.

---

# Future Channel Targets

The architecture should support:

* Discord
* Slack
* Telegram
* Microsoft Teams
* WhatsApp
* Email
* SMS
* Matrix
* Signal
* IRC
* Web Chat
* Mobile Push Notifications

without modifying the core architecture.

---

# Recommended Development Order

Phase 1

* Channel contracts
* Registry
* Lifecycle manager
* Router

Phase 2

* Discord plugin
* Slack plugin

Phase 3

* Media support
* Typing support
* Message editing

Phase 4

* Voice support
* Streaming responses
* Tool progress updates

Phase 5

* Teams
* Telegram
* WhatsApp

---

# Final Recommendation

Opencode should adopt an OpenClaw-style plugin architecture as the foundation because it aligns naturally with Effect services, dependency injection, and long-term maintainability.

PicoClaw's channel features such as typing indicators, media handling, reactions, message editing, streaming output, and voice integration should be implemented as optional capabilities layered on top of the plugin system.

This combination provides:

* Clean architecture
* Easy extensibility
* Rich user experience
* Platform independence
* Long-term scalability

and creates a channel system capable of supporting both current and future communication platforms without architectural redesign.
