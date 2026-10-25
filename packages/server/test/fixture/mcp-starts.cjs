const fs = require("node:fs")
const readline = require("node:readline")

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
            serverInfo: { name: "filesystem-test", version: "1" },
          }
        : { tools: [] }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n")
  })
  .on("close", () => process.exit(0))
