import { sql } from "drizzle-orm"
import { db } from "./db"
import { env } from "./env"
import { delivery_log, device_registration } from "./schema.sql"
import { setup } from "./setup"

async function run() {
  console.log(`[apn-relay] DB host: ${env.DATABASE_HOST}`)

  await db.execute(sql`SELECT 1`)
  console.log("[apn-relay] DB connection OK")

  await setup()
  console.log("[apn-relay] Setup migration OK")

  const [a] = await db.select({ value: sql<number>`count(*)` }).from(device_registration)
  const [b] = await db.select({ value: sql<number>`count(*)` }).from(delivery_log)

  console.log(`[apn-relay] device_registration rows: ${Number(a?.value ?? 0)}`)
  console.log(`[apn-relay] delivery_log rows: ${Number(b?.value ?? 0)}`)
  console.log("[apn-relay] DB check passed")
}

run().catch((err) => {
  console.error("[apn-relay] DB check failed")
  console.error(err)
  process.exit(1)
})
