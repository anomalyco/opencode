import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { UserProfileTable } from "./sql"
import { eq } from "drizzle-orm"

export interface UserProfile {
  id: string
  name: string
  email: string
  timezone: string
  preferences: Record<string, any>
  bio: string
  facts: string[]
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly get: () => Effect.Effect<UserProfile>
  readonly update: (data: Partial<Omit<UserProfile, "id" | "time_created" | "time_updated">>) => Effect.Effect<UserProfile>
  readonly addFact: (fact: string) => Effect.Effect<UserProfile>
  readonly getFacts: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/UserProfile") {}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const { db } = yield* Database.Service

  const get = Effect.gen(function* () {
    let rows = yield* db.select().from(UserProfileTable).all().pipe(Effect.orDie)
    if (rows.length === 0) {
      const now = Date.now()
      yield* db
        .insert(UserProfileTable)
        .values({
          id: "default",
          name: "",
          email: "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          preferences: "{}",
          bio: "",
          facts: "[]",
          time_created: now,
          time_updated: now,
        })
        .run()
        .pipe(Effect.orDie)
      rows = yield* db.select().from(UserProfileTable).all().pipe(Effect.orDie)
    }
    const row = rows[0]
    return {
      id: row.id,
      name: row.name ?? "",
      email: row.email ?? "",
      timezone: row.timezone ?? "UTC",
      preferences: JSON.parse(row.preferences ?? "{}"),
      bio: row.bio ?? "",
      facts: JSON.parse(row.facts ?? "[]"),
      time_created: row.time_created,
      time_updated: row.time_updated,
    }
  })

  const update = (data: Partial<Omit<UserProfile, "id" | "time_created" | "time_updated">>) =>
    Effect.gen(function* () {
      const now = Date.now()
      const existing = yield* db
        .select()
        .from(UserProfileTable)
        .where(eq(UserProfileTable.id, "default"))
        .all()
        .pipe(Effect.orDie)
      const prefs = data.preferences ? JSON.stringify(data.preferences) : undefined
      const facts = data.facts ? JSON.stringify(data.facts) : undefined

      if (existing.length === 0) {
        yield* db
          .insert(UserProfileTable)
          .values({
            id: "default",
            name: data.name ?? "",
            email: data.email ?? "",
            timezone: data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
            preferences: prefs ?? "{}",
            bio: data.bio ?? "",
            facts: facts ?? "[]",
            time_created: now,
            time_updated: now,
          })
          .run()
          .pipe(Effect.orDie)
      } else {
        const updates: Record<string, any> = { time_updated: now }
        if (data.name !== undefined) updates.name = data.name
        if (data.email !== undefined) updates.email = data.email
        if (data.timezone !== undefined) updates.timezone = data.timezone
        if (prefs !== undefined) updates.preferences = prefs
        if (data.bio !== undefined) updates.bio = data.bio
        if (facts !== undefined) updates.facts = facts
        yield* db
          .update(UserProfileTable)
          .set(updates)
          .where(eq(UserProfileTable.id, "default"))
          .run()
          .pipe(Effect.orDie)
      }

      return yield* get
    })

  return Service.of({
    get,
    update,
    addFact: (fact: string) =>
      Effect.gen(function* () {
        const profile = yield* get
        const facts = [...(profile.facts ?? []), fact]
        return yield* update({ facts })
      }),
    getFacts: Effect.gen(function* () {
      const profile = yield* get
      return profile.facts ?? []
    }),
  })
}))

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export { Service as UserProfile }
