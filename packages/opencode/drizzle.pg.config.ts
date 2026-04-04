import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/**/*.sql.ts",
  out: "./migration-pg",
})
