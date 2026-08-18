import { readFile } from "node:fs/promises"
import path from "node:path"
import { sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Credential } from "@opencode-ai/schema/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Global } from "@opencode-ai/util/global"
import type { DatabaseMigration } from "../migration.js"

const LegacyOAuth = Schema.Struct({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
})
const LegacyKey = Schema.Struct({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
const LegacyWellKnown = Schema.Struct({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
})
const LegacyValue = Schema.Union([LegacyOAuth, LegacyKey, LegacyWellKnown])
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeValue = Schema.decodeUnknownOption(LegacyValue)
const wellKnownSourcesKey = "wellknown:sources"

const migration: DatabaseMigration.Migration = {
  id: "20260805200742_import_legacy_credentials",
  up(tx) {
    return Effect.gen(function* () {
      const global = yield* Global.Service
      return yield* importLegacyCredentials(tx, path.join(global.data, "auth.json"))
    })
  },
}

export default migration

export function importLegacyCredentials(tx: Parameters<DatabaseMigration.Migration["up"]>[0], filepath: string) {
  return Effect.gen(function* () {
    const content = yield* Effect.promise(() => readFile(filepath, "utf8").catch(() => undefined))
    if (content === undefined) return
    const input = Option.getOrUndefined(decodeJson(content))
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return yield* Effect.fail(new Error("Legacy credential file must contain an object"))
    }

    const origins: string[] = []
    for (const [id, raw] of Object.entries(input)) {
      const value = Option.getOrUndefined(decodeValue(raw))
      if (!value) continue
      const integrationID = id.replace(/\/+$/, "")
      if (!integrationID) continue
      if (value.type === "wellknown") origins.push(integrationID)
      if (yield* tx.get(sql`SELECT id FROM credential WHERE integration_id = ${integrationID}`)) continue

      const credential =
        value.type === "api"
          ? Credential.Key.make({ type: "key", key: value.key, metadata: value.metadata })
          : value.type === "wellknown"
            ? Credential.Key.make({ type: "key", key: value.token })
            : Credential.OAuth.make({
                type: "oauth",
                methodID: Integration.MethodID.make(methodID(integrationID)),
                refresh: value.refresh,
                access: value.access,
                expires: value.expires,
                metadata:
                  value.accountId || value.enterpriseUrl
                    ? {
                        ...(value.accountId ? { accountID: value.accountId } : {}),
                        ...(value.enterpriseUrl ? { enterpriseUrl: value.enterpriseUrl } : {}),
                      }
                    : undefined,
              })
      const now = Date.now()
      yield* tx.run(sql`
        INSERT INTO credential (id, integration_id, label, value, time_created, time_updated)
        VALUES (${Credential.ID.create()}, ${integrationID}, 'default', ${JSON.stringify(credential)}, ${now}, ${now})
      `)
    }

    if (!origins.length) return
    const stored = yield* tx.get<{ value: string }>(sql`SELECT value FROM kv WHERE key = ${wellKnownSourcesKey}`)
    const decoded = stored ? Option.getOrUndefined(decodeJson(stored.value)) : undefined
    const current = Array.isArray(decoded) ? decoded.filter((item): item is string => typeof item === "string") : []
    const value = JSON.stringify(Array.from(new Set([...current, ...origins])))
    const now = Date.now()
    yield* tx.run(sql`
      INSERT INTO kv (key, value, time_created, time_updated)
      VALUES (${wellKnownSourcesKey}, ${value}, ${now}, ${now})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, time_updated = excluded.time_updated
    `)
  })
}

function methodID(integrationID: string) {
  if (integrationID === "openai") return "chatgpt-browser"
  if (["github-copilot", "opencode", "xai"].includes(integrationID)) return "device"
  return "oauth"
}
