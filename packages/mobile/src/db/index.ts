import { drizzle } from "drizzle-orm/expo-sqlite"
import { migrate } from "drizzle-orm/expo-sqlite/migrator"
import { openDatabaseSync } from "expo-sqlite"
import migrations from "@/drizzle/migrations"

// Create a single database instance
const expo = openDatabaseSync("test-1.db")
const db = drizzle(expo)

// Run migrations on app start
try {
  migrate(db, migrations)
  console.log("migrations complete")
} catch (error) {
  console.log("failed to mgrate db")
}

// Export the single instance
export default db

// Export types
export * from "./types"
