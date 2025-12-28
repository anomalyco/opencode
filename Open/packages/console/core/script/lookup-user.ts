import { Database, eq } from "../src/drizzle/index.js"
import { AuthTable } from "../src/schema/auth.sql"

// get input from command line
const email = process.argv[2]
if (!email) {
  console.error("Usage: bun lookup-user.ts <email>")
  process.exit(1)
}

const authData = await printTable("Auth", (tx) => tx.select().from(AuthTable).where(eq(AuthTable.subject, email)))
if (authData.length === 0) {
  console.error("User not found")
  process.exit(1)
}

await printTable("Auth", (tx) => tx.select().from(AuthTable).where(eq(AuthTable.accountID, authData[0].accountID)))

function printTable(title: string, callback: (tx: Database.TxOrDb) => Promise<any[]>): Promise<any[]> {
  return Database.use(async (tx) => {
    const data = await callback(tx)
    console.log(`== ${title} ==`)
    console.table(data)
    return data
  })
}
