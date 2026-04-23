
import { Server } from "./server/server"
import { Log } from "./util/log"

const log = Log.create({ service: "hosted" })

process.on("unhandledRejection", (error) => {
  log.error("rejection", {
    error: error instanceof Error ? error.message : error,
  })
})

process.on("uncaughtException", (error) => {
  log.error("exception", {
    error: error instanceof Error ? error.message : error,
  })
  process.exit(1)
})

process.on("SIGHUP", () => process.exit())

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: process.env.NODE_ENV === "development",
  level: process.env.NODE_ENV === "development" ? "DEBUG" : "INFO",
})

process.env.AGENT = "1"
process.env.OPENCODE = "1"
process.env.OPENCODE_PID = String(process.pid)

if (!process.env.DATABASE_URL?.startsWith("postgresql://")) {
  console.error("DATABASE_URL must be a postgresql:// connection string")
  process.exit(1)
}

log.info("using postgresql", { url: process.env.DATABASE_URL })
const { Database } = await import("./storage/db.pg")
await Database.initialize()
// Migrations are run manually via: bun run db:migrate

const hostname = process.env.OPENCODE_SERVER_HOSTNAME ?? "0.0.0.0"
const port = Number(process.env.PORT ?? "3000")
const cors = process.env.OPENCODE_SERVER_CORS?.split(",")
  .map((value) => value.trim())
  .filter(Boolean)

const server = Server.listen({
  hostname,
  port,
  cors,
})

console.log(`opencode server listening on http://${server.hostname}:${server.port}`)

await new Promise(() => {})
