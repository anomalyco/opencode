import { defineConfig } from "drizzle-kit"

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"],
  out: "./migration",
  dbCredentials: {
    url: `${process.env.XDG_DATA_HOME ?? `${process.env.HOME}/.local/share`}/kancode/storage.db`,
  },
})
