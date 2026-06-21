import { Client } from "@planetscale/database"
import { Resource } from "sst/resource"

const tables = ["geo_stat", "model_stat", "provider_stat"] as const

const client = new Client({ url: Resource.StatsDatabase.url })

await tables.reduce((promise, table) => promise.then(() => ensureUniqueUsersColumn(table)), Promise.resolve())

async function ensureUniqueUsersColumn(table: (typeof tables)[number]) {
  const result = await client.execute<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = database() AND table_name = ? AND column_name = 'unique_users'",
    [table],
  )

  if (result.rows.length > 0) {
    console.log(`unique_users column already exists on ${table}`)
    return
  }

  await client.execute(`ALTER TABLE \`${table}\` ADD \`unique_users\` bigint NOT NULL DEFAULT 0`)
  console.log(`added unique_users column to ${table}`)
}
