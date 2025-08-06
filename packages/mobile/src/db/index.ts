import { drizzle } from "drizzle-orm/expo-sqlite"
import { migrate } from "drizzle-orm/expo-sqlite/migrator"
import { openDatabaseSync } from "expo-sqlite"
import migrations from "@/drizzle/migrations"

// Create a single database instance
const expo = openDatabaseSync("opentest.db")
const db = drizzle(expo)

// Run migrations on app start
try {
  migrate(db, migrations)
} catch (error) {
  // Migration failed - handle silently or with proper error handling
}

// Export the single instance
export default db

// Export types
export * from "./types"
