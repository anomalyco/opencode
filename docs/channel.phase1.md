# Phase 1: Channel System Foundation - Specific File Modifications

## Goal
Establish the architectural foundation for a plugin-based channel system that separates channel infrastructure from channel functionality through capability-based interfaces and plugin registration.

## Files to Create

### 1. Channel Contracts
**Path:** `src/channels/contracts/channel.ts`
```typescript
import { Effect } from "effect"

export interface Channel {
  readonly id: string
  readonly type: string
  readonly name: string
  
  start(): Effect.Effect<void>
  stop(): Effect.Effect<void>
  health(): Effect.Effect<ChannelHealth>
  capabilities(): Effect.Effect<ChannelCapabilities>
}

export interface ChannelHealth {
  readonly connected: boolean
  readonly latency?: number
  readonly lastMessage?: number
  readonly reconnectAttempts?: number
  readonly status: string
}

export interface ChannelCapabilities {
  readonly messaging: boolean
  readonly editing: boolean
  readonly typing: boolean
  readonly reactions: boolean
  readonly media: boolean
  readonly voice: boolean
  readonly streaming: boolean
  readonly files: boolean
}
```

**Path:** `src/channels/contracts/sender.ts`
```typescript
import { Effect } from "effect"

export interface MessageSender {
  send(channelId: string, message: string): Effect.Effect<void>
}
```

**Path:** `src/channels/contracts/editor.ts`
```typescript
import { Effect } from "effect"

export interface MessageEditor {
  edit(channelId: string, messageId: string, content: string): Effect.Effect<void>
}
```

**Path:** `src/channels/contracts/typing.ts`
```typescript
import { Effect } from "effect"

export interface TypingCapable {
  startTyping(channelId: string): Effect.Effect<() => void>
}
```

**Path:** `src/channels/contracts/media.ts`
```typescript
import { Effect } from "effect"

export interface MediaPart {
  readonly type: "image" | "video" | "audio" | "document"
  readonly data: Uint8Array
  readonly filename?: string
  readonly mimeType?: string
}

export interface MediaSender {
  sendMedia(channelId: string, media: MediaPart[]): Effect.Effect<void>
}
```

**Path:** `src/channels/contracts/reactions.ts`
```typescript
import { Effect } from "effect"

export interface ReactionCapable {
  react(channelId: string, messageId: string, emoji: string): Effect.Effect<void>
}
```

**Path:** `src/channels/contracts/streaming.ts`
```typescript
import { Effect } from "effect"

export interface StreamingCapable {
  stream(channelId: string, chunks: AsyncIterable<string>): Effect.Effect<void>
}
```

### 2. Runtime System
**Path:** `src/channels/runtime/registry.ts`
```typescript
import { Effect } from "effect"
import { Channel } from "../contracts/channel"
import { Ref } from "effect"

interface Registry {
  readonly channels: Ref.Ref<Map<string, Channel>>
  
  register(type: string, channel: Channel): Effect.Effect<void>
  unregister(type: string): Effect.Effect<void>
  get(type: string): Effect.Effect<Channel | null>
  list(): Effect.Effect<ReadonlyArray<string>>
}

export const registry = Effect.gen(function* () {
  const channels = yield* Ref.make(Map<string, Channel>())
  
  return {
    channels,
    
    register: (type: string, channel: Channel) =>
      Ref.modify(channels, map => {
        map.set(type, channel)
        return map
      }),
      
    unregister: (type: string) =>
      Ref.modify(channels, map => {
        map.delete(type)
        return map
      }),
      
    get: (type: string) =>
      Ref.get(channels).map(map => map.get(type) ?? null),
      
    list: () =>
      Ref.get(channels).map(map => Array.from(map.keys()))
  }
})

export const Registry = {
  registry
}
```

**Path:** `src/channels/runtime/lifecycle.ts`
```typescript
import { Effect } from "effect"
import { Channel } from "../contracts/channel"
import { Schedule } from "effect"

export const lifecycle = {
  start: (channel: Channel): Effect.Effect<void> =>
    Effect.scopedEffect(channel.start()),
    
  stop: (channel: Channel): Effect.Effect<void> =>
    Effect.scopedEffect(channel.stop()),
    
  health: (channel: Channel): Effect.Effect<ChannelHealth> =>
    channel.health(),
    
  capabilities: (channel: Channel): Effect.Effect<ChannelCapabilities> =>
    channel.capabilities(),
    
  // Auto-reconnection with exponential backoff
  startWithRecovery: (channel: Channel): Effect.Effect<void> =>
    Effect.retry(
      channel.start(),
      Schedule.exponential("100 millis").whileInput(() => true)
    ).tapErrorCause(cause =>
      Effect.logError(`Channel ${channel.type} failed to start: ${cause}`)
    )
}
```

**Path:** `src/channels/runtime/router.ts`
```typescript
import { Effect } from "effect"
import { MessageSender, MessageEditor, TypingCapable, ReactionCapable, MediaSender, StreamingCapable } from "../contracts"
import { Channel } from "../contracts/channel"
import { registry } from "./registry"

export const router = {
  sendMessage: (channelId: string, message: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      // In a real implementation, we'd look up the channel by ID from a database
      // For now, we'll assume channelId maps to type for simplicity
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      // Check if channel implements MessageSender
      if ("send" in channel && typeof channel.send === "function") {
        return (channel as MessageSender).send(channelId, message)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support messaging`))
    }),
    
  editMessage: (channelId: string, messageId: string, content: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      if ("edit" in channel && typeof channel.edit === "function") {
        return (channel as MessageEditor).edit(channelId, messageId, content)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support message editing`))
    }),
    
  // Similar methods for other capabilities...
  
  sendTyping: (channelId: string): Effect.Effect<() => void> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      if ("startTyping" in channel && typeof channel.startTyping === "function") {
        return (channel as TypingCapable).startTyping(channelId)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support typing indicators`))
    }),
    
  react: (channelId: string, messageId: string, emoji: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      if ("react" in channel && typeof channel.react === "function") {
        return (channel as ReactionCapable).react(channelId, messageId, emoji)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support reactions`))
    }),
    
  sendMedia: (channelId: string, media: MediaPart[]): Effect.Effect<void> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      if ("sendMedia" in channel && typeof channel.sendMedia === "function") {
        return (channel as MediaSender).sendMedia(channelId, media)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support media sending`))
    }),
    
  stream: (channelId: string, chunks: AsyncIterable<string>): Effect.Effect<void> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      
      if ("stream" in channel && typeof channel.stream === "function") {
        return (channel as StreamingCapable).stream(channelId, chunks)
      }
      
      return Effect.fail(new Error(`Channel ${channelId} does not support streaming`))
    })
}
```

**Path:** `src/channels/runtime/health.ts`
```typescript
import { Effect } from "effect"
import { Channel } from "../contracts/channel"
import { registry } from "./registry"

export const health = {
  checkAll: (): Effect.Effect<Record<string, ChannelHealth>> =>
    Effect.gen(function* () {
      const types = yield* registry.list()
      const healthPromises = types.map(type =>
        Effect.gen(function* () {
          const channel = yield* registry.get(type)
          if (!channel) {
            return [type, { connected: false, status: "not_found" } as ChannelHealth]
          }
          
          const health = yield* channel.health()
          return [type, health]
        })
      )
      
      const results = yield* Effect.all(healthPromises)
      return Object.fromEntries(results)
    }),
    
  checkOne: (channelId: string): Effect.Effect<ChannelHealth> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      return channel.health()
    })
}
```

**Path:** `src/channels/runtime/capabilities.ts`
```typescript
import { Effect } from "effect"
import { ChannelCapabilities } from "../contracts/channel"
import { registry } from "./registry"

export const capabilities = {
  getAll: (): Effect.Effect<Record<string, ChannelCapabilities>> =>
    Effect.gen(function* () {
      const types = yield* registry.list()
      const capabilityPromises = types.map(type =>
        Effect.gen(function* () {
          const channel = yield* registry.get(type)
          if (!channel) {
            return [type, {
              messaging: false,
              editing: false,
              typing: false,
              reactions: false,
              media: false,
              voice: false,
              streaming: false,
              files: false
            } as ChannelCapabilities]
          }
          
          const capabilities = yield* channel.capabilities()
          return [type, capabilities]
        })
      )
      
      const results = yield* Effect.all(capabilityPromises)
      return Object.fromEntries(results)
    }),
    
  getOne: (channelId: string): Effect.Effect<ChannelCapabilities> =>
    Effect.gen(function* () {
      const channel = yield* registry.get(channelId)
      if (!channel) {
        return Effect.fail(new Error(`Channel not found: ${channelId}`))
      }
      return channel.capabilities()
    })
}
```

### 3. Service Layer
**Path:** `src/channels/service/channels.ts`
```typescript
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Identifier } from "@/id/id"
import { channelTable } from "./channel.sql"
import { eq } from "drizzle-orm"
import { router } from "../runtime/router"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "channels" })

export interface Interface {
  readonly create: (input: CreateChannelInput) => Effect.Effect<ChannelInfo>
  readonly list: () => Effect.Effect<ChannelInfo[]>
  readonly remove: (id: string) => Effect.Effect<void>
  readonly send: (channelId: string, message: string) => Effect.Effect<void>
  readonly edit: (channelId: string, messageId: string, content: string) => Effect.Effect<void>
  readonly typing: (channelId: string) => Effect.Effect<() => void>
  readonly react: (channelId: string, messageId: string, emoji: string) => Effect.Effect<void>
  readonly sendMedia: (channelId: string, media: MediaPart[]) => Effect.Effect<void>
  readonly stream: (channelId: string, chunks: AsyncIterable<string>) => Effect.Effect<void>
  readonly health: () => Effect.Effect<Record<string, ChannelHealth>>
  readonly capabilities: () => Effect.Effect<Record<string, ChannelCapabilities>>
}

export class Service extends Layer.Effected<Service, Interface>()("@opencode/Channels") {}

export const CreateChannelInput = ChannelInfo.omit(["id", "created_at", "updated_at"])

export const ChannelInfo = ChannelInfoSchema.extend({
  id: ChannelIdSchema,
  created_at: Schema.Number,
  updated_at: Schema.Number
})

// Import schemas from existing location or redefine here
// For now, assuming these exist or will be created

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    
    const create = Effect.fn("Channels.create")(function* (input: ChannelInfo) {
      const now = Date.now()
      const id = Identifier.ascending("channel") as string
      
      yield* db.insert(channelTable).values({
        id,
        type: input.type,
        name: input.name,
        // In a real implementation, we'd store plugin-specific config here
        // config: JSON.stringify(input.config),
        enabled: input.enabled ?? true,
        created_at: now,
        updated_at: now,
      }).run().pipe(Effect.orDie)
      
      log.info("channel created", { id, type: input.type, name: input.name })
      
      return { ...input, id, created_at: now, updated_at: now }
    })
    
    const list = Effect.fn("Channels.list")(function* () {
      const rows = yield* db.select().from(channelTable).all().pipe(Effect.orDie)
      return rows.map(row => ({
        id: row.id,
        type: row.type,
        name: row.name,
        // config: row.config ? JSON.parse(row.config) : undefined,
        enabled: row.enabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
    })
    
    const remove = Effect.fn("Channels.remove")(function* (id: string) {
      yield* db.delete(channelTable).eq(channelTable.id, id).run().pipe(Effect.orDie)
      log.info("channel removed", { id })
    })
    
    // Delegate to router for actual operations
    const send = Effect.fn("Channels.send")(function* (channelId: string, message: string) {
      yield* router.sendMessage(channelId, message)
    })
    
    const edit = Effect.fn("Channels.edit")(function* (channelId: string, messageId: string, content: string) {
      yield* router.editMessage(channelId, messageId, content)
    })
    
    const typing = Effect.fn("Channels.typing")(function* (channelId: string) {
      return yield* router.sendTyping(channelId)
    })
    
    const react = Effect.fn("Channels.react")(function* (channelId: string, messageId: string, emoji: string) {
      yield* router.react(channelId, messageId, emoji)
    })
    
    const sendMedia = Effect.fn("Channels.sendMedia")(function* (channelId: string, media: MediaPart[]) {
      yield* router.sendMedia(channelId, media)
    })
    
    const stream = Effect.fn("Channels.stream")(function* (channelId: string, chunks: AsyncIterable<string>) {
      yield* router.stream(channelId, chunks)
    })
    
    const health = Effect.fn("Channels.health")(function* () {
      return yield* health.checkAll()
    })
    
    const capabilities = Effect.fn("Channels.capabilities")(function* () {
      return yield* capabilities.getAll()
    })
    
    return Service.of({
      create,
      list,
      remove,
      send,
      edit,
      typing,
      react,
      sendMedia,
      stream,
      health,
      capabilities
    })
  })
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export * as Channels from "."
```

**Path:** `src/channels/index.ts` (update to use new service)
```typescript
import { Service as ChannelsService } from "./service/channels"

export * as Channels from "./service/channels"
```

## Files to Modify

### 1. Update Schema (`src/channels/schema.ts`)
Modify to support the new plugin-based system:
```typescript
import { Schema } from "effect"

export const ChannelId = Schema.String.pipe(Schema.brand("ChannelId"))

export const ChannelType = ChannelId // In this system, type is the plugin identifier

export const ChannelInfo = Schema.Struct({
  id: ChannelId,
  type: ChannelType,
  name: Schema.String,
  // config: Schema.Unknown, // Plugin-specific configuration
  enabled: Schema.Boolean,
  created_at: Schema.Number,
  updated_at: Schema.Number
})

export const CreateChannel = ChannelInfo.omit(["id", "created_at", "updated_at"])

export * as ChannelSchema from "./schema"
```

### 2. Update Database Migration
Create a new migration file: `src/channels/migrations/002_update_channel_schema.sql`
```sql
-- Add new columns for plugin-based system
ALTER TABLE channel 
ADD COLUMN IF NOT EXISTS config TEXT;

-- Rename type column if needed to match new usage
-- ALTER TABLE channel RENAME COLUMN type TO plugin_type;

-- Update any constraints
-- ALTER TABLE channel 
-- DROP CONSTRAINT IF EXISTS channel_type_check,
-- ADD CONSTRAINT channel_plugin_type_check 
-- CHECK (plugin_type IN ('discord', 'slack', 'telegram', 'teams', 'email', 'whatsapp'));

-- Or make it more flexible for future plugins:
-- ALTER TABLE channel 
-- DROP CONSTRAINT IF EXISTS channel_type_check;
```

## Implementation Notes

### 1. Effect Patterns
- All functions use `Effect.fn` for traceability
- Error handling follows Effect patterns with `Effect.fail`
- Logging uses the standard opencode logger
- Database operations use `Effect.orDie` for unrecoverable errors

### 2. Plugin Registration
- Plugins will self-register with the registry on initialization
- The registry uses Effect's Ref for thread-safe state management
- Plugins can be registered/unregistered dynamically

### 3. Capability System
- Each channel reports its capabilities through the `capabilities()` method
- The router checks capabilities before attempting operations
- Graceful degradation when capabilities are missing

### 4. Lifecycle Management
- Standardized start/stop/health interface
- Recovery mechanisms built into lifecycle utilities
- Health monitoring for all registered channels

### 5. Backward Compatibility
- Existing channel configurations can be migrated
- The service layer maintains the same external interface
- Internal implementation is completely replaced

## Next Steps After Phase 1

Once Phase 1 is complete:
1. Create the first plugin (Discord) implementing the basic Channel and MessageSender interfaces
2. Test the registration, lifecycle, and routing system
3. Move to Phase 2 to add advanced capabilities like editing, typing, and media