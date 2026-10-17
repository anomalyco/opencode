import { readFile } from "node:fs/promises"
import path from "node:path"
import { sql } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
import { Global } from "@opencode/util/global"
import { mcpIntegrationID } from "../../mcp/integration-id.js"
import type { DatabaseMigration } from "../migration.js"

// V1 kept one entry per configured server name in `mcp-auth.json`: the tokens the authorization server handed
// back, the client dynamic registration issued them to, and the server URL they were authenticated against.
// Tokens are camelCase with a seconds-based expiry, so they cannot be copied into a credential as they are.
const LegacyTokens = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
})
const LegacyClientInfo = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
})
const LegacyEntry = Schema.Struct({
  tokens: Schema.optional(LegacyTokens),
  clientInfo: Schema.optional(LegacyClientInfo),
  serverUrl: Schema.optional(Schema.String),
})
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
const decodeEntry = Schema.decodeUnknownOption(LegacyEntry)

const migration: DatabaseMigration.Migration = {
  id: "20261013150000_import_legacy_mcp_credentials",
  up(tx) {
    return Effect.gen(function* () {
      const global = yield* Global.Service
      return yield* importLegacyMCPCredentials(tx, path.join(global.data, "mcp-auth.json"))
    })
  },
}

export default migration

export function importLegacyMCPCredentials(tx: Parameters<DatabaseMigration.Migration["up"]>[0], filepath: string) {
  return Effect.gen(function* () {
    const content = yield* Effect.promise(() => readFile(filepath, "utf8").catch(() => undefined))
    if (content === undefined) return
    const input = Option.getOrUndefined(decodeJson(content))
    // A leftover V1 file that is corrupt, or holds something other than an object, is skipped rather than fatal:
    // this migration runs on every startup, so failing here would leave the database unopenable until the user
    // found and repaired a file they cannot see. Re-running `opencode mcp auth` rewrites it.
    if (typeof input !== "object" || input === null || Array.isArray(input)) return

    for (const [name, raw] of Object.entries(input)) {
      const entry = Option.getOrUndefined(decodeEntry(raw))
      // V1 only ever read an entry back through a matching `serverUrl`, and a login in flight has no tokens
      // yet, so neither can be re-keyed onto the integration V2 derives from the server's name and url.
      if (!entry?.serverUrl || !entry.tokens) continue
      const integrationID = mcpIntegrationID(name, entry.serverUrl)
      if (yield* tx.get(sql`SELECT id FROM credential WHERE integration_id = ${integrationID}`)) continue
      const credential = Credential.OAuth.make({
        type: "oauth",
        methodID: Integration.MethodID.make(integrationID),
        access: entry.tokens.accessToken,
        refresh: entry.tokens.refreshToken ?? "",
        // V1 counted seconds, V2 counts milliseconds, and 0 marks a token that never expires.
        expires: entry.tokens.expiresAt ? Math.max(0, Math.round(entry.tokens.expiresAt * 1000)) : 0,
        metadata: {
          serverUrl: entry.serverUrl,
          tokenType: "Bearer",
          ...(entry.tokens.scope ? { scope: entry.tokens.scope } : {}),
          // Reuse the client registration the V1 tokens were issued to: refreshing against a different client
          // than the one the refresh token belongs to is rejected by the authorization server.
          ...(entry.clientInfo
            ? {
                client: {
                  client_id: entry.clientInfo.clientId,
                  ...(entry.clientInfo.clientSecret ? { client_secret: entry.clientInfo.clientSecret } : {}),
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
