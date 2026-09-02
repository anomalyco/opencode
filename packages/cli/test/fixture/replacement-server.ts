const url = new URL(process.argv[2])
const server = Bun.serve({
  hostname: url.hostname,
  port: Number(url.port),
  fetch: () => Response.json({ process: "replacement", pid: process.pid }),
})

process.on("SIGTERM", () => {
  server.stop(true)
  process.exit()
})
