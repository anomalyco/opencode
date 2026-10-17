const fs = require("node:fs")
const readline = require("node:readline")

// Logs its pid on every spawn so tests can tell a reconnect spawned a new process.
fs.appendFileSync(process.argv[2], `${process.pid}\n`)

readline
  .createInterface({ input: process.stdin })
  .on("line", (line) => {
    const request = JSON.parse(line)
    if (request.id === undefined) return
    const result =
      request.method === "initialize"
        ? {
            protocolVersion: request.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "reconnect-test", version: "1" },
          }
        : { tools: [] }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n")
  })
  .on("close", () => process.exit(0))
