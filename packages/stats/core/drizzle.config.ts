import { Resource } from "sst/resource"
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "mysql",
  schema: ["./src/database/schema.ts"],
  // schema: ["./src/**/*.sql.ts"],
  out: "./migrations/",
  strict: true,
  verbose: true,
  dbCredentials: {
    database: Resource.StatsDatabase.database,
    host: Resource.StatsDatabase.host,
    user: Resource.StatsDatabase.username,
    password: Resource.StatsDatabase.password,
    port: Resource.StatsDatabase.port,
    ssl: {
      rejectUnauthorized: false,
    },
  },
})
