import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "mysql",
  schema: "./src/**/*.sql.ts",
  out: "./migration-mysql",
})
