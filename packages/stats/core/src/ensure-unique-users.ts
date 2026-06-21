import { Client } from "@planetscale/database"
import { Resource } from "sst/resource"

const tables = ["geo_stat", "model_stat", "provider_stat"] as const
const checkOnly = process.argv.includes("--check")

const client = new Client({ url: databaseUrl() })

const missing = await tables.reduce<Promise<(typeof tables)[number][]>>(async (promise, table) => {
  const result = await promise
  if (await hasUniqueUsersColumn(table)) {
    console.log(`unique_users column already exists on ${table}`)
    return result
  }
  return [...result, table]
}, Promise.resolve([]))

if (missing.length === 0) {
  console.log("unique_users columns complete")
  process.exit(0)
}

if (checkOnly) {
  console.log(`unique_users columns missing on ${missing.join(", ")}`)
  process.exit(1)
}

await missing.reduce((promise, table) => promise.then(() => addUniqueUsersColumn(table)), Promise.resolve())

function databaseUrl() {
  if (
    process.env.PLANETSCALE_HOST &&
    process.env.PLANETSCALE_USERNAME &&
    process.env.PLANETSCALE_PASSWORD &&
    process.env.PLANETSCALE_DATABASE
  )
    return `mysql://${encodeURIComponent(process.env.PLANETSCALE_USERNAME)}:${encodeURIComponent(
      process.env.PLANETSCALE_PASSWORD,
    )}@${process.env.PLANETSCALE_HOST}/${process.env.PLANETSCALE_DATABASE}?ssl=${encodeURIComponent(
      JSON.stringify({ rejectUnauthorized: true }),
    )}`

  return process.env.DATABASE_URL ?? Resource.StatsDatabase.url
}

async function hasUniqueUsersColumn(table: (typeof tables)[number]) {
  const result = await client.execute<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = database() AND table_name = ? AND column_name = 'unique_users'",
    [table],
  )

  return result.rows.length > 0
}

async function addUniqueUsersColumn(table: (typeof tables)[number]) {
  await client.execute(`ALTER TABLE \`${table}\` ADD \`unique_users\` bigint NOT NULL DEFAULT 0`)
  console.log(`added unique_users column to ${table}`)
}
