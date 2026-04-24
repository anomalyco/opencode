import { Database } from "@/storage/db.pg"
import { Log } from "@/util/log"
import { Server } from "./server"

const args = process.argv.slice(2)

const pick = (key: string, fallback: string) => {
  const idx = args.indexOf(key)
  if (idx < 0) return fallback
  return args[idx + 1] ?? fallback
}

const host = pick("--hostname", process.env.DEV_BACKEND_HOST?.trim() || "127.0.0.1")
const port = Number(pick("--port", process.env.DEV_BACKEND_PORT?.trim() || "4096"))
const cors = process.env.OPENCODE_SERVER_CORS?.split(",")
  .map((x) => x.trim())
  .filter(Boolean)

await Log.init({
  print: true,
  dev: process.env.NODE_ENV === "development",
  level: process.env.NODE_ENV === "development" ? "DEBUG" : "INFO",
})

process.env.AGENT = "1"
process.env.OPENCODE = "1"
process.env.OPENCODE_PID = String(process.pid)

if (!process.env.DATABASE_URL?.startsWith("postgresql://")) {
  process.stderr.write("DATABASE_URL must be a postgresql:// connection string\n")
  process.exit(1)
}

await Database.initialize()

const server = Server.listen({
  hostname: host,
  port,
  cors,
})

Log.Default.info("server listening", {
  hostname: host,
  port: server.port,
})

const stop = async () => {
  await server.stop(true)
  process.exit(0)
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    void stop()
  })
}

await new Promise<void>(() => {})
