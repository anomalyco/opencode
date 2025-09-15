import { Database, eq } from "@opencode/cloud-core/drizzle/index.js"
import { UsageTable } from "@opencode/cloud-core/schema/billing.sql.js"

await Database.use(async (tx) => {
  await tx
    .update(UsageTable)
    .set({ model: "grok-code" })
    .where(eq(UsageTable.model, "x-ai/grok-code-fast-1"))
    .limit(90000)
})
