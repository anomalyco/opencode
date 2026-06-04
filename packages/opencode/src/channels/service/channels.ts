import { Context, Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { ChannelID, ChannelInfo, ChannelType, CreateChannel } from "../schema"
import { channelTable } from "../channel.sql"
import { router } from "../runtime/router"
import { health } from "../runtime/health"
import { capabilities } from "../runtime/capabilities"
import { getChannelPlugin } from "../channel.config"
import { Service as RegistryService } from "../runtime/registry"
import { Service as MessageBusService, layer as messageBusLayer } from "../runtime/bus"
import { typingKeepalive as keepaliveTyping } from "../runtime/keepalive"
import * as Log from "@opencode-ai/core/util/log"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "channels" })

export interface Interface {
  readonly create: (input: Schema.Schema.Type<typeof CreateChannel>) => Effect.Effect<Schema.Schema.Type<typeof ChannelInfo>>
  readonly list: () => Effect.Effect<Schema.Schema.Type<typeof ChannelInfo>[]>
  readonly remove: (id: Schema.Schema.Type<typeof ChannelID>) => Effect.Effect<void>
  readonly send: (channelId: string, message: string) => Effect.Effect<void>
  readonly edit: (channelId: string, messageId: string, content: string) => Effect.Effect<void>
  readonly typing: (channelId: string) => Effect.Effect<() => void>
  readonly react: (channelId: string, messageId: string, emoji: string) => Effect.Effect<void>
  readonly sendMedia: (channelId: string, media: any) => Effect.Effect<void>
  readonly stream: (channelId: string, chunks: AsyncIterable<string>) => Effect.Effect<void>
  readonly health: () => Effect.Effect<Record<string, any>>
  readonly capabilities: () => Effect.Effect<Record<string, any>>
  /** Start a typing keepalive that repeats until the scope closes */
  readonly typingKeepalive: (channelId: string, intervalMs?: number) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Channels") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const create = Effect.fn("Channels.create")(function* (input: Schema.Schema.Type<typeof CreateChannel>) {
      const now = Date.now()
      const id = Identifier.ascending("channel") as Schema.Schema.Type<typeof ChannelID>

      // Persist to DB
      yield* db.insert(channelTable).values({
        id,
        type: input.type,
        name: input.name,
        webhook_url: "",
        enabled: input.enabled ?? true,
        config: input.config ? JSON.stringify(input.config) : null,
        created_at: now,
        updated_at: now,
      }).run().pipe(Effect.orDie)

      // Instantiate and register plugin if type is known
      const plugin = getChannelPlugin(input.type)
      if (plugin) {
        const registry = yield* RegistryService
        const bus = yield* MessageBusService
        const channelConfig = (input.config ?? {}) as Record<string, unknown>
        const channelInstance = plugin.create(id, input.name, channelConfig)

        // Inject the message bus for inbound processing (if plugin supports it)
        if ("setBus" in channelInstance && typeof channelInstance.setBus === "function") {
          channelInstance.setBus(bus)
          log.debug("message bus injected into channel plugin", { id, type: input.type })
        }

        yield* registry.register(id, channelInstance)
        yield* channelInstance.start()
        log.info("channel plugin registered and started", { id, type: input.type, name: input.name })
      } else {
        log.info("channel created (no plugin registered)", { id, type: input.type, name: input.name })
      }

      return {
        id,
        type: input.type,
        name: input.name,
        enabled: input.enabled ?? true,
        created_at: now,
        updated_at: now,
      } as Schema.Schema.Type<typeof ChannelInfo>
    })

    const list = Effect.fn("Channels.list")(function* () {
      const rows = yield* db.select().from(channelTable).all().pipe(Effect.orDie)
      return rows.map((row: typeof channelTable.$inferSelect) => ({
        id: row.id as Schema.Schema.Type<typeof ChannelID>,
        type: row.type as Schema.Schema.Type<typeof ChannelType>,
        name: row.name,
        enabled: row.enabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })) as Schema.Schema.Type<typeof ChannelInfo>[]
    })

    const remove = Effect.fn("Channels.remove")(function* (id: Schema.Schema.Type<typeof ChannelID>) {
      // Stop and unregister plugin if running
      const registry = yield* RegistryService
      const channel = yield* registry.get(id)
      if (channel) {
        yield* channel.stop()
        yield* registry.unregister(id)
        log.info("channel plugin stopped and unregistered", { id })
      }

      yield* db.delete(channelTable).where(eq(channelTable.id, id)).run().pipe(Effect.orDie)
      log.info("channel removed", { id })
    })

    const send = Effect.fn("Channels.send")(function* (channelId: string, message: string) {
      const row = yield* db.select().from(channelTable).where(eq(channelTable.id, channelId)).get().pipe(Effect.orDie)
      if (!row) {
        log.warn("channel not found", { channelId })
        return
      }
      if (!row.enabled) {
        log.debug("channel disabled, skipping", { channelId })
        return
      }
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

    const sendMedia = Effect.fn("Channels.sendMedia")(function* (channelId: string, media: any) {
      yield* router.sendMedia(channelId, media)
    })

    const streamEffect = Effect.fn("Channels.stream")(function* (channelId: string, chunks: AsyncIterable<string>) {
      yield* router.stream(channelId, chunks)
    })

    const healthCheck = Effect.fn("Channels.health")(function* () {
      return yield* health.checkAll()
    })

    const capabilitiesCheck = Effect.fn("Channels.capabilities")(function* () {
      return yield* capabilities.getAll()
    })

    const typingKeepaliveEffect = Effect.fn("Channels.typingKeepalive")(function* (
      channelId: string,
      intervalMs?: number
    ) {
      return yield* keepaliveTyping(channelId, intervalMs)
    })

    return Service.of({
      create: create as Interface["create"],
      list: list as Interface["list"],
      remove: remove as Interface["remove"],
      send: send as Interface["send"],
      edit: edit as Interface["edit"],
      typing: typing as Interface["typing"],
      react: react as Interface["react"],
      sendMedia: sendMedia as Interface["sendMedia"],
      stream: streamEffect as Interface["stream"],
      health: healthCheck as Interface["health"],
      capabilities: capabilitiesCheck as Interface["capabilities"],
      typingKeepalive: typingKeepaliveEffect as Interface["typingKeepalive"],
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Database.defaultLayer),
  Layer.provide(messageBusLayer),
)
