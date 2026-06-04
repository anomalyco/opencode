# Channel System Recommendation for Opencode

## Executive Summary

Based on analysis of the current opencode channel implementation, picoclaw's feature-rich implementations, and openclaw's architectural sophistication, I recommend implementing a **hybrid approach** that combines:

1. **OpenClaw's plugin-based architecture** for extensibility, security, and maintainability
2. **Picoclaw's rich feature set** for user experience (typing indicators, reactions, media, streaming, etc.)
3. **Effect-based patterns** consistent with opencode's existing architecture

This approach will provide a scalable, maintainable channel system that can evolve with new platforms and features.

## Current State Analysis

### What Opencode Currently Has
- Basic Slack and Discord webhook implementations (`src/channels/transports/slack.ts`, `discord.ts`)
- Simple channel service with type-based dispatch (`src/channels/index.ts`)
- Minimal schema with only two channel types (`src/channels/schema.ts`)
- No plugin system, capability discovery, or advanced features

### What Picoclaw Demonstrates
- Rich, real-time implementations for multiple platforms:
  - **Slack**: Socket Mode, threads, reactions, media upload
  - **Teams**: Webhook-based with Adaptive Cards
  - **Discord**: Real-time WebSocket, threads, media, TTS, voice, typing indicators, tool feedback animations
  - **Telegram**: Long polling, MarkdownV2/HTML, threading, tool feedback, media, editing/deletion, typing actions, draft-based streaming
  - **WhatsApp**: WebSocket bridge, media, group detection
- Common patterns: capability interfaces (MessageEditor, TypingCapable, ReactionCapable, etc.), context handling, allowlist filtering

### What Openclaw Demonstrates
- Production-ready plugin architecture with:
  - Strongly typed configuration (Zod schemas)
  - Capability discovery and reporting system
  - Comprehensive security policies and secret management
  - Health monitoring and logging
  - Plugin lifecycle management
  - Message routing and extensibility
  - Well-defined contracts separating interface from implementation

## Recommended Architecture

### High-Level Structure
```
Agent Core
    ↓
Channel Service (Effect Layer)
    ↓
Capability-Based Router
    ↓
[Discord Plugin] [Slack Plugin] [Telegram Plugin] [Teams Plugin] [Email Plugin] [WhatsApp Plugin]
```

Each plugin:
- Self-registers with the system
- Reports its capabilities
- Manages its own lifecycle
- Handles platform-specific details
- Communicates through standardized interfaces

### Core Components to Implement

#### 1. Channel Contracts (src/channels/contracts/)
- `channel.ts` - Base Channel interface (start, stop, send, health, capabilities)
- `sender.ts` - MessageSender interface
- `editor.ts` - MessageEditor interface  
- `media.ts` - MediaSender interface
- `typing.ts` - TypingCapable interface
- `reactions.ts` - ReactionCapable interface
- `streaming.ts` - StreamingCapable interface
- `files.ts` - File handling interface (if needed)

#### 2. Runtime System (src/channels/runtime/)
- `registry.ts` - Plugin registration and discovery
- `lifecycle.ts` - Plugin lifecycle management (start/stop/health)
- `router.ts` - Capability-based message routing
- `health.ts` - Health monitoring and reporting
- `capabilities.ts` - Capability definition and validation

#### 3. Service Layer (src/channels/service/)
- `channels.ts` - Main Channel Service (Effect layer) coordinating plugins

#### 4. Platform Plugins (src/channels/plugins/{platform}/)
Each platform gets its own directory with:
- `plugin.ts` - Main plugin implementation
- `config.ts` - Platform-specific configuration
- Optional capability implementations as needed

## Implementation Plan

### Phase 1: Foundation (Weeks 1-2)
**Goal:** Establish the architectural foundation

**Files to Create/Modify:**
1. `src/channels/contracts/channel.ts` - Base Channel interface
2. `src/channels/contracts/sender.ts` - MessageSender interface
3. `src/channels/runtime/registry.ts` - Plugin registry
4. `src/channels/runtime/lifecycle.ts` - Lifecycle manager
5. `src/channels/runtime/router.ts` - Capability-based router
6. `src/channels/service/channels.ts` - Channel service layer
7. `src/channels/schema.ts` - Update to support plugin-based system
8. `src/channels/index.ts` - Update service layer implementation

**Key Deliverables:**
- Plugin registration system
- Basic channel service that can load plugins
- Capability reporting mechanism
- Effect-based integration

### Phase 2: Core Features (Weeks 3-4)
**Goal:** Implement essential messaging capabilities

**Files to Create:**
1. `src/channels/contracts/editor.ts` - MessageEditor interface
2. `src/channels/contracts/typing.ts` - TypingCapable interface
3. `src/channels/contracts/media.ts` - MediaSender interface
4. `src/channels/contracts/reactions.ts` - ReactionCapable interface
5. `src/channels/plugins/discord/plugin.ts` - Discord plugin with core features
6. `src/channels/plugins/slack/plugin.ts` - Slack plugin with core features
7. Update contracts to export new interfaces
8. Update service to handle capability-based dispatch

**Key Deliverables:**
- Working Discord and Slack plugins with basic messaging
- Capability-based dispatch in channel service
- Plugin lifecycle management
- Basic health monitoring

### Phase 3: Advanced Features (Weeks 5-6)
**Goal:** Implement rich user experience features

**Files to Create/Modify:**
1. `src/channels/contracts/streaming.ts` - StreamingCapable interface
2. `src/channels/contracts/voice.ts` - VoiceCapable interface (optional)
3. Enhanced Discord plugin:
   - Typing indicators
   - Reactions (👀 processing indicator)
   - Media sending
   - Message editing/deletion
   - Tool feedback animations
   - Draft-based streaming responses
4. Enhanced Slack plugin:
   - Thread support
   - Reactions
   - Media uploads
   - Basic editing (where supported)
5. Update service to route capabilities appropriately

**Key Deliverables:**
- Discord plugin with full Picoclaw-equivalent features
- Slack plugin with enhanced capabilities
- Streaming support for progressive responses
- Tool feedback integration
- Rich media handling

### Phase 4: Additional Platforms (Weeks 7-8)
**Goal:** Expand to remaining requested platforms

**Files to Create:**
1. `src/channels/plugins/telegram/plugin.ts` - Telegram plugin
   - Long polling implementation
   - MarkdownV2/HTML formatting
   - Threading/forum support
   - Tool feedback animations
   - Media handling
   - Editing/deletion capabilities
   - Typing actions
2. `src/channels/plugins/teams/plugin.ts` - Microsoft Teams plugin
   - Webhook-based implementation
   - Adaptive Card support
   - Basic messaging
3. `src/channels/plugins/email/plugin.ts` - Email plugin
   - SMTP or API-based implementation
   - HTML email support
   - Attachment handling
4. `src/channels/plugins/whatsapp/plugin.ts` - WhatsApp plugin
   - WebSocket bridge implementation
   - Media handling
   - Group/individual detection

**Key Deliverables:**
- Telegram plugin matching picoclaw's feature set
- Teams plugin for output-only notifications
- Email plugin for notifications
- WhatsApp plugin for bidirectional communication
- All plugins reporting accurate capabilities

### Phase 5: Observability and Polish (Weeks 9-10)
**Goal:** Add monitoring, security, and final refinements

**Files to Create/Modify:**
1. `src/channels/runtime/health.ts` - Health monitoring system
2. `src/channels/runtime/capabilities.ts` - Capability validation
3. Secret management system for platform credentials
4. Allowlist/filtering system (like picoclaw)
5. Comprehensive logging and error handling
6. Configuration validation system
7. Health check endpoints
8. Plugin auto-discovery and loading

**Key Deliverables:**
- Production-ready security for credentials
- Health monitoring for all channels
- Allowlist filtering for security
- Comprehensive logging
- Configuration validation
- Graceful degradation when capabilities missing

## Specific File Modifications

### 1. Schema Updates (`src/channels/schema.ts`)
Replace simple type enum with plugin-supporting schema:
```typescript
// Add plugin metadata fields
export const ChannelInfo = Schema.Struct({
  id: ChannelID,
  type: ChannelID, // plugin identifier
  name: Schema.String,
  config: Schema.Unknown, // plugin-specific config (validated per-plugin)
  enabled: Schema.Boolean,
  capabilities: Schema.Array(Schema.String), // reported capabilities
  created_at: Schema.Number,
  updated_at: Schema.Number,
})
```

### 2. Channel Service Updates (`src/channels/index.ts`)
Transform from type-switch to capability-router:
```typescript
// Instead of:
// switch (row.type) {
//   case "slack": yield* sendSlack(...)
//   case "discord": yield* sendDiscord(...)
// }

// To:
yield* channelService.sendMessage(channelID, message)
// Service internally:
// 1. Loads plugin by type
// 2. Checks if plugin has MessageSender capability
// 3. Routes message through plugin's send method
// 4. Handles errors and lifecycle
```

### 3. New Contract Files
Create interface files that plugins can implement selectively:
```typescript
// src/channels/contracts/editor.ts
export interface MessageEditor {
  edit(channelID: string, messageID: string, content: string): Effect.Effect<void>
}

// src/channels/contracts/typing.ts  
export interface TypingCapable {
  startTyping(channelID: string): Effect.Effect<() => void>
}

// src/channels/contracts/media.ts
export interface MediaSender {
  sendMedia(channelID: string, media: Array<MediaPart>): Effect.Effect<void>
}
```

### 4. Plugin Structure Example (`src/channels/plugins/discord/plugin.ts`)
```typescript
import { Channel, MessageSender, MessageEditor, TypingCapable, ReactionCapable, MediaSender, StreamingCapable } from "@/channels/contracts"
import { registry } from "@/channels/runtime/registry"
import * as Effect from "effect"
import * as Log from "@opencode-ai/core/util/log"

export class DiscordPlugin 
  implements Channel, 
             MessageSender, 
             MessageEditor, 
             TypingCapable, 
             ReactionCapable, 
             MediaSender, 
             StreamingCapable {
  
  private readonly botToken: string
  private readonly logger = Log.create({ service: "channels.discord" })
  
  constructor(config: { botToken: string }) {
    this.botToken = config.botToken
    // Auto-register
    registry.register("discord", this)
  }
  
  // Channel interface
  start = Effect.gen(function* () { /* WebSocket connection */ })
  stop = Effect.gen(function* () { /* Graceful disconnect */ })
  health = Effect.gen(function* () { /* Return connection status */ })
  capabilities = Effect.gen(function* () => ({
    messaging: true,
    editing: true,
    typing: true,
    reactions: true,
    media: true,
    voice: false, // Discord has voice but in separate API
    streaming: true
  }))
  
  // MessageSender
  send = Effect.gen(function* (channelID: string, message: string) { /* API call */ })
  
  // MessageEditor  
  edit = Effect.gen(function* (channelID: string, messageID: string, content: string) { /* API call */ })
  
  // TypingCapable
  startTyping = Effect.gen(function* (channelID: string) => { /* API call returning cleanup */ })
  
  // ReactionCapable
  react = Effect.gen(function* (channelID: string, messageID: string, emoji: string) { /* API call */ })
  
  // MediaSender
  sendMedia = Effect.gen(function* (channelID: string, media: Array<MediaPart>) { /* API call */ })
  
  // StreamingCapable
  stream = Effect.gen(function* (channelID: string, chunks: AsyncIterable<string>) { /* Process chunks */ })
}
```

## Benefits of This Approach

1. **Extensibility**: Adding new platforms requires only creating a new plugin that implements the needed interfaces
2. **Maintainability**: Platform-specific code is isolated; core agent logic remains unchanged
3. **Feature Granularity**: Platforms only implement capabilities they truly support
4. **Runtime Flexibility**: System can adapt based on what capabilities are actually available
5. **Security**: Credentials and secrets managed through centralized secret handling
6. **Observability**: Health monitoring, logging, and metrics built-in
7. **Effect Consistency**: Uses opencode's existing Effect patterns for dependency injection and error handling
8. **User Experience**: Delivers the rich features users expect (typing indicators, reactions, media, etc.)

## Risk Mitigation

1. **Migration Risk**: Current Slack/Discord webhook implementations can be wrapped as plugins during transition
2. **Complexity Risk**: Start with minimal interfaces and expand as needed
3. **Performance Risk**: Plugins handle their own optimization; core system adds minimal overhead
4. **Security Risk**: Follow secret management best practices; validate all inputs
5. **Compatibility Risk**: Capability system allows graceful degradation when features unavailable

## Success Metrics

1. **Feature Parity**: Discord and Telegram plugins match or exceed picoclaw capabilities
2. **Architectural Cleanliness**: Core agent code has zero platform-specific dependencies
3. **Extensibility**: New platforms can be added in <2 hours by following plugin template
4. **Reliability**: Health monitoring detects and recovers from connection issues
5. **Security**: No credential leaks; all secrets properly managed
6. **Performance**: Message latency comparable to direct platform SDKs
7. **Developer Experience**: Clear documentation and examples for plugin creation

## Immediate Next Steps

1. Create the contracts directory and base interfaces
2. Implement the plugin registry and lifecycle manager
3. Create a minimal Discord plugin as proof of concept
4. Update the channel service to use the new architecture
5. Migrate existing Slack/Discord webhook implementations to plugin wrappers
6. Begin implementing advanced features (typing, reactions, media) for Discord
7. Expand to additional platforms following the established pattern

This architecture provides the foundation for a robust, extensible channel system that can serve opencode's needs for years to come while delivering the rich user experience demonstrated in picoclaw.