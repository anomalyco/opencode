import { readFile } from "node:fs/promises"
import path from "node:path"
import { sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
import { Global } from "@opencode/util/global"
import { McpIdentity } from "../../mcp/identity.js"
import type { DatabaseMigration } from "../migration.js"

// V1 kept one entry per configured server name. Expiry times are in seconds; V2 credentials use milliseconds.
const LegacyEntry = Schema.Struct({
  tokens: Schema.optional(
    Schema.Struct({
      accessToken: Schema.String,
      refreshToken: Schema.optional(Schema.String),
      expiresAt: Schema.optional(Schema.Number),
      scope: Schema.optional(Schema.String),
    }),
  ),
  clientInfo: Schema.optional(
    Schema.Struct({
      clientId: Schema.String,
      clientSecret: Schema.optional(Schema.String),
      clientIdIssuedAt: Schema.optional(Schema.Number),
      clientSecretExpiresAt: Schema.optional(Schema.Number),
    }),
  ),
  serverUrl: Schema.optional(Schema.String),
})
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeEntry = Schema.decodeUnknownOption(LegacyEntry)

const migration: DatabaseMigration.Migration = {
  id: "20261016120000_import_legacy_mcp_credentials",
  up(tx) {
    return Effect.gen(function* () {
      const global = yield* Global.Service
      return yield* importLegacyMcpCredentials(tx, path.join(global.data, "mcp-auth.json"))
    })
  },
}

export default migration

export function importLegacyMcpCredentials(tx: Parameters<DatabaseMigration.Migration["up"]>[0], filepath: string) {
  return Effect.gen(function* () {
    const content = yield* Effect.promise(() => readFile(filepath, "utf8").catch(() => undefined))
    if (content === undefined) return
    const input = Option.getOrUndefined(decodeJson(content))
    // A failed migration keeps the database from opening, and V1 itself treated an unreadable file as empty.
    if (typeof input !== "object" || input === null || Array.isArray(input)) return

    for (const [name, raw] of Object.entries(input)) {
      const entry = Option.getOrUndefined(decodeEntry(raw))
      // V1 only used an entry whose serverUrl matched the configured URL; entries without tokens are unfinished logins.
      if (!entry?.serverUrl || !entry.tokens) continue
      const integrationID = McpIdentity.integrationID(name, entry.serverUrl)
      if (yield* tx.get(sql`SELECT id FROM credential WHERE integration_id = ${integrationID}`)) continue
      const client = entry.clientInfo
      const credential = Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make(integrationID),
        access: entry.tokens.accessToken,
        refresh: entry.tokens.refreshToken ?? "",
        expires: entry.tokens.expiresAt ? Math.max(0, Math.round(entry.tokens.expiresAt * 1000)) : 0,
        metadata: {
          serverUrl: entry.serverUrl,
          tokenType: "Bearer",
          ...(entry.tokens.scope ? { scope: entry.tokens.scope } : {}),
          // Refresh tokens are bound to the client that obtained them, so keep V1's registration.
          ...(client
            ? {
                client: {
                  client_id: client.clientId,
                  ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
                  ...(client.clientIdIssuedAt ? { client_id_issued_at: client.clientIdIssuedAt } : {}),
                  ...(client.clientSecretExpiresAt ? { client_secret_expires_at: client.clientSecretExpiresAt } : {}),
                },
              }
            : {}),
        },
      })
      const now = Date.now()
      yield* tx.run(sql`
        INSERT INTO credential (id, integration_id, label, value, time_created, time_updated)
        VALUES (${Credential.ID.create()}, ${integrationID}, 'OAuth', ${JSON.stringify(credential)}, ${now}, ${now})
      `)
    }
  })
}
