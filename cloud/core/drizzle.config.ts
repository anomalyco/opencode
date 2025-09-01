import { Resource } from "@opencode/cloud-resource"
import { defineConfig } from "drizzle-kit"

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
