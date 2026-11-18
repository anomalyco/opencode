import { Resource } from "./src/resource"
import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "mysql",
  schema: ["./src/database/schema.ts"],
  // schema: ["./src/**/*.sql.ts"],
  out: "./migrations/",
  verbose: true,
  dbCredentials: {
    database: Resource.DataDatabase.database,
    host: Resource.DataDatabase.host,
    user: Resource.DataDatabase.username,
    password: Resource.DataDatabase.password,
    port: Resource.DataDatabase.port,
    ssl: {
      rejectUnauthorized: false,
    },
  },
})
