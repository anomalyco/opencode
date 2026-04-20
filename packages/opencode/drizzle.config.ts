import { defineConfig } from "drizzle-kit"

const url = process.env.DATABASE_URL

if (!url) {
  throw new Error("DATABASE_URL environment variable is required")
}

const isPostgres = url.startsWith("postgresql://")

export default defineConfig({
  dialect: isPostgres ? "postgresql" : "sqlite",
  schema: "./src/storage/schema.pg.ts",
  out: "./migration",
  dbCredentials: { url },
})
