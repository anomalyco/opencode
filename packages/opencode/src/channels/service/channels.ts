import { Context, Effect, Layer, Schema } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { ChannelID, ChannelInfo, CreateChannel } from "../schema"
import { channelTable } from "../channel.sql"
import { sendSlack } from "../transports/slack"
import { sendDiscord } from "../transports/discord"
import * as Log from "@opencode-ai/core/util/log"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "channels" })

export interface Interface {
  readonly create: (input: Schema.Schema.Type<typeof CreateChannel>) => Effect.Effect<Schema.Schema.Type<typeof ChannelInfo>>
  readonly list: () => Effect.Effect<Schema.Schema.Type<typeof ChannelInfo>[]>
  readonly remove: (id: Schema.Schema.Type<typeof ChannelID>) => Effect.Effect<void>
  readonly send: (channelID: Schema.Schema.Type<typeof ChannelID>, message: string) => Effect.Effect<void>
  readonly broadcast: (message: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Channels") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const create = Effect.fn("Channels.create")(function* (input: Schema.Schema.Type<typeof CreateChannel>) {
      const now = Date.now()
      const id = Identifier.ascending("channel") as Schema.Schema.Type<typeof ChannelID>
      yield* db.insert(channelTable).values({
        id,
        type: input.type,
        name: input.name,
        webhook_url: input.webhook_url,
        enabled: input.enabled ?? true,
        created_at: now,
        updated_at: now,
      }).run().pipe(Effect.orDie)
      log.info("channel created", { id, type: input.type, name: input.name })
      return { id, type: input.type, name: input.name, webhook_url: input.webhook_url, enabled: input.enabled ?? true, created_at: now, updated_at: now }
    })

    const list = Effect.fn("Channels.list")(function* () {
      const rows = yield* db.select().from(channelTable).all().pipe(Effect.orDie)
      return rows.map((row: typeof channelTable.$inferSelect) => ({
        id: row.id as Schema.Schema.Type<typeof ChannelID>,
        type: row.type as "slack" | "discord",
        name: row.name,
        webhook_url: row.webhook_url,
        enabled: row.enabled,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }))
    })

    const remove = Effect.fn("Channels.remove")(function* (id: Schema.Schema.Type<typeof ChannelID>) {
      yield* db.delete(channelTable).where(eq(channelTable.id, id)).run().pipe(Effect.orDie)
      log.info("channel removed", { id })
    })

    const send = Effect.fn("Channels.send")(function* (channelID: Schema.Schema.Type<typeof ChannelID>, message: string) {
      const row = yield* db.select().from(channelTable).where(eq(channelTable.id, channelID)).get().pipe(Effect.orDie)
      if (!row) {
        log.warn("channel not found", { channelID })
        return
      }
      if (!row.enabled) {
        log.debug("channel disabled, skipping", { channelID })
        return
      }
      if (row.type === "slack") {
        yield* sendSlack(row.webhook_url, message)
      } else if (row.type === "discord") {
        yield* sendDiscord(row.webhook_url, message)
      }
    })

    const broadcast = Effect.fn("Channels.broadcast")(function* (message: string) {
      const channels = yield* list()
      const enabled = channels.filter((c: Schema.Schema.Type<typeof ChannelInfo>) => c.enabled)
      for (const channel of enabled) {
        yield* send(channel.id, message).pipe(Effect.ignore)
      }
      log.info("broadcast sent", { channelCount: enabled.length })
    })

    return Service.of({
      create: create as Interface["create"],
      list: list as Interface["list"],
      remove: remove as Interface["remove"],
      send: send as Interface["send"],
      broadcast: broadcast as Interface["broadcast"],
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
