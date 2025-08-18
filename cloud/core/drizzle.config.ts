import { defineConfig } from "drizzle-kit"
import { Resource } from "sst"

export default defineConfig({
  out: "./migrations/",
  strict: true,
  schema: ["./src/**/*.sql.ts"],
  verbose: true,
  dialect: "postgresql",
  dbCredentials: {
    database: Resource.Database.database,
    host: Resource.Database.host,
    user: Resource.Database.username,
    password: Resource.Database.password,
    port: Resource.Database.port,
    ssl: {
      rejectUnauthorized: false,
    },
  },
})
