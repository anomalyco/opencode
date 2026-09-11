import { Server } from "./server/server"

const hostname = process.env.ARGUS_HOSTNAME ?? "127.0.0.1"
const port = Number(process.env.ARGUS_PORT ?? process.env.PORT ?? 4096)

if (!process.env.ARGUS_SERVER_PASSWORD) {
  console.log("Warning: ARGUS_SERVER_PASSWORD is not set; server is unsecured.")
}

const listener = await Server.listen({ hostname, port, cors: [] })
console.log(`argus server listening on http://${listener.hostname}:${listener.port}`)

const shutdown = async () => {
  await listener.stop().catch(() => undefined)
  process.exit(0)
}
process.on("SIGINT", void shutdown)
process.on("SIGTERM", void shutdown)
