import { drizzle } from "drizzle-orm/expo-sqlite"
import { migrate } from "drizzle-orm/expo-sqlite/migrator"
import { openDatabaseSync } from "expo-sqlite"
import migrations from "@/drizzle/migrations"

// Create a single database instance
const expo = openDatabaseSync("test.db")
const db = drizzle(expo)

// Run migrations on app start
try {
  migrate(db, migrations)
  console.log("✅ Local database migrations completed")
} catch (error) {
  console.error("❌ Local database migration failed:", error)
}

// Export the single instance
export default db

// Export types
export * from "./types"
