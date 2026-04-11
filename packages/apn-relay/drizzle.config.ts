import { defineConfig } from "drizzle-kit"

export default defineConfig({
  out: "./migration",
  strict: true,
  schema: ["./src/**/*.sql.ts"],
  dialect: "mysql",
  dbCredentials: {
    host: process.env.DATABASE_HOST ?? "",
    user: process.env.DATABASE_USERNAME ?? "",
    password: process.env.DATABASE_PASSWORD ?? "",
    database: process.env.DATABASE_NAME ?? "main",
    ssl: {
      rejectUnauthorized: false,
    },
  },
})
